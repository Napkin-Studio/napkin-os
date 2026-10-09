// Jobs: submit to the relay, write the document entry at submit (state
// queued), poll no faster than nextPollS, fetch outputs into the blob store,
// then hand the result to whoever asked for it. Pending jobs resume after a
// reload because the document and the job purposes are both snapshotted.

import type {
  ContractError, DocAsset, DocJob, Job, JobInput, JobRequest, JobState, LogEntry, ModelChoice, Op, Region, StageName,
} from '../contracts/types'
import { TERMINAL_STATES } from '../contracts/types'
import { systemUpdate, type DocumentStore } from '../doc/store'
import type { JobCtx, JobPurpose } from '../doc/ui'
import type { UiStore } from '../projects/uiStore'
import { idbLocation, putBlobAs } from '../lib/blobs'
import { newId } from '../lib/ulid'
import { asContractError, RelayError, type Relay } from '../relay'

export interface LiveInfo {
  state: JobState
  queuePosition?: number
}

export type CompletionHandler = (job: Job, ctx: JobCtx) => void
export type Purpose = JobPurpose['for']

function collectHashes(v: unknown, out: Set<string>) {
  if (typeof v === 'string') {
    if (/^sha256:[0-9a-f]{64}$/.test(v)) out.add(v)
  } else if (Array.isArray(v)) v.forEach((x) => collectHashes(x, out))
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => collectHashes(x, out))
}

export function isActive(state: JobState): boolean {
  return !TERMINAL_STATES.includes(state)
}

export class JobRunner {
  private readonly live = new Map<string, LiveInfo>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly handlers = new Map<Purpose, CompletionHandler>()
  private readonly waiting = new Map<Purpose, { job: Job; ctx: JobCtx }[]>()
  private readonly listeners = new Set<() => void>()
  private version = 0
  private readonly relay: Relay
  private readonly doc: DocumentStore
  private readonly ui: UiStore
  /** Set by stop(): the project was closed. Its jobs carry on at the relay and land when it is opened again. */
  private stopped = false
  /** The stage the user is on, for log entries. */
  stage: () => StageName = () => 'character'

  constructor(relay: Relay, doc: DocumentStore, ui: UiStore) {
    this.relay = relay
    this.doc = doc
    this.ui = ui
  }

  // ── observation (for the job chip and pending nodes) ──

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getVersion = () => this.version
  private emit() {
    this.version++
    for (const fn of this.listeners) fn()
  }
  liveInfo(jobId: string): LiveInfo | undefined {
    return this.live.get(jobId)
  }

  /** Register what happens when a job for `purpose` completes. Flushes results that arrived first. */
  onComplete(purpose: Purpose, handler: CompletionHandler): () => void {
    this.handlers.set(purpose, handler)
    const queued = this.waiting.get(purpose)
    if (queued) {
      this.waiting.delete(purpose)
      for (const { job, ctx } of queued) handler(job, ctx)
    }
    return () => {
      if (this.handlers.get(purpose) === handler) this.handlers.delete(purpose)
    }
  }

  /** The project is closing (features/project-home.clan): stop asking about its jobs and start no more.
   *  Whatever is still being made stays in its document as queued, running or fetching, so resume()
   *  picks it up the next time the project is opened, in that project and no other. */
  stop() {
    this.stopped = true
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
    this.listeners.clear()
  }

  // ── submit / retry / cancel ──

  /** `modelChoice`: the model picked in the regenerate menu (features/model-choice.clan). */
  async submit(op: Op, input: JobInput, parentIds: string[], purpose: JobPurpose, jobId = newId('job'), modelChoice?: ModelChoice): Promise<string> {
    if (this.stopped) throw new Error('the project was closed')
    const request: JobRequest = { contractVersion: '2', jobId, op, parentIds, input, ...(modelChoice ? { modelChoice } : {}) }
    const hashes = new Set<string>()
    collectHashes(input, hashes)
    const now = new Date().toISOString()
    const entry: DocJob = {
      id: jobId,
      op,
      state: 'queued',
      parent_ids: parentIds,
      input_hashes: [...hashes],
      created_at: now,
    }
    if (input.text) entry.text = input.text
    if (input.chips?.length) entry.chips = input.chips
    if (input.region) entry.region = input.region as Region
    this.ui.update((u) => {
      u.jobCtx[jobId] = { ...purpose, request }
    })
    systemUpdate(this.doc, (d) => {
      d.jobs.push(entry)
    }, `submit ${op}`)
    this.live.set(jobId, { state: 'queued' })
    this.emit()
    await this.send(request)
    return jobId
  }

  private async send(request: JobRequest) {
    try {
      const job = await this.relay.createJob(request)
      if (this.stopped) return
      this.apply(job)
    } catch (e) {
      const err = asContractError(e)
      // Too many of this person's jobs are running (relay inFlightPerParticipant). The relay did not
      // record this one, so wait for a free slot and send the same request again (idempotent jobId).
      if (err.code === 'queue_full' && err.retryable) {
        if (this.live.get(request.jobId)?.state === 'cancelled') return
        this.live.set(request.jobId, { state: 'queued' })
        this.emit()
        const t = setTimeout(() => { this.timers.delete(request.jobId); void this.send(request) }, Math.max(1, err.retryAfterS ?? 4) * 1000)
        this.timers.set(request.jobId, t)
        return
      }
      this.fail(request.jobId, err)
    }
  }

  /** Re-run a failed job as a new job (same input, new id: the old id would return the same failure).
   *  `modelChoice`: run it on another model this time (null: the routed default); left out, the same pick. */
  async retry(jobId: string, modelChoice?: ModelChoice | null): Promise<string | null> {
    const ctx = this.ui.get().jobCtx[jobId]
    if (!ctx) return null
    const { request, dismissed: _d, retriedAs: _r, ...purpose } = ctx
    const newJobId = newId('job')
    this.ui.update((u) => {
      const c = u.jobCtx[jobId]
      if (c) {
        c.dismissed = true
        c.retriedAs = newJobId
      }
    })
    const pick = modelChoice === undefined ? request.modelChoice : modelChoice ?? undefined
    await this.submit(request.op, request.input, request.parentIds, purpose as JobPurpose, newJobId, pick)
    return newJobId
  }

  async cancel(jobId: string) {
    this.stopPolling(jobId)
    try {
      const job = await this.relay.cancelJob(jobId)
      this.apply(job)
    } catch (e) {
      this.patchDocJob(jobId, { state: 'cancelled', error: asContractError(e) })
      this.live.set(jobId, { state: 'cancelled' })
      this.emit()
    }
  }

  dismiss(jobId: string) {
    this.ui.update((u) => {
      const c = u.jobCtx[jobId]
      if (c) c.dismissed = true
    })
  }

  async report(jobId: string | undefined, message: string, extra: Partial<LogEntry> = {}) {
    const entry: LogEntry = {
      level: 'report',
      message: message.slice(0, 2000),
      stage: this.stage(),
      browser: navigator.userAgent.slice(0, 300),
      ...extra,
    }
    if (jobId) entry.jobId = jobId
    try {
      await this.relay.log(entry)
      return true
    } catch {
      return false
    }
  }

  /** Pick up every job that was still moving when the page was last open. */
  resume() {
    for (const j of this.doc.get().jobs) {
      if (isActive(j.state)) {
        this.live.set(j.id, { state: j.state })
        this.schedule(j.id, 0.2)
      }
    }
    this.emit()
  }

  // ── polling ──

  private schedule(jobId: string, seconds: number) {
    this.stopPolling(jobId)
    if (this.stopped) return
    this.timers.set(jobId, setTimeout(() => void this.poll(jobId), Math.max(0.2, seconds) * 1000))
  }

  private stopPolling(jobId: string) {
    const t = this.timers.get(jobId)
    if (t) clearTimeout(t)
    this.timers.delete(jobId)
  }

  /** Ask about every job still moving now, without waiting for its timer (tests drive the mock relay with this). */
  async pollNow() {
    // Only jobs waiting on a poll timer: a job being fetched into the blob store has none and must not complete twice.
    await Promise.all([...this.timers.keys()].map((id) => {
      this.stopPolling(id)
      return this.poll(id)
    }))
  }

  private async poll(jobId: string) {
    this.timers.delete(jobId)
    if (this.stopped) return
    try {
      const job = await this.relay.getJob(jobId)
      if (this.stopped) return
      this.apply(job)
    } catch (e) {
      const err = asContractError(e)
      // The relay never recorded this job: it was refused as queue_full and waits to be sent
      // again, and a reload (resume) polled it first (2026-10-08, Make views on a 2-job limit).
      // Send the request we hold again; the same jobId never pays twice.
      const request = this.ui.get().jobCtx[jobId]?.request
      if (e instanceof RelayError && e.status === 404 && request && this.live.get(jobId)?.state === 'queued') {
        return void this.send(request)
      }
      if (err.code === 'invalid_input') this.fail(jobId, err)
      else if (err.code === 'unauthorised') this.schedule(jobId, 10) // signed out: resume once signed in again
      else this.schedule(jobId, 5) // network blip: keep trying, the ledger has the job
    }
  }

  private fail(jobId: string, error: ContractError) {
    this.stopPolling(jobId)
    this.patchDocJob(jobId, { state: 'failed', error })
    this.live.set(jobId, { state: 'failed' })
    this.emit()
  }

  private patchDocJob(jobId: string, patch: Partial<DocJob>) {
    systemUpdate(this.doc, (d) => {
      const j = d.jobs.find((x) => x.id === jobId)
      // Only a real change moves updated_at: a poll that learns nothing writes nothing.
      const changed = j && Object.entries(patch).some(([k, v]) => JSON.stringify((j as unknown as Record<string, unknown>)[k]) !== JSON.stringify(v))
      if (j && changed) Object.assign(j, patch, { updated_at: new Date().toISOString() })
    })
  }

  private apply(job: Job) {
    normalisePromptVersion(job)
    const done = job.state === 'completed'
    const prev = this.doc.get().jobs.find((x) => x.id === job.jobId)
    if (prev && !isActive(prev.state) && prev.state === job.state) return
    this.live.set(job.jobId, { state: done ? 'fetching' : job.state, queuePosition: job.queuePosition })
    const patch: Partial<DocJob> = { state: done ? 'fetching' : job.state, cost: job.cost }
    if (job.provider) patch.provider = job.provider
    if (job.model) patch.model = job.model
    if (job.requestId) patch.remote_id = job.requestId
    if (job.director) patch.agent = job.director
    if (job.error) patch.error = job.error
    this.patchDocJob(job.jobId, patch)
    this.emit()
    if (done) void this.complete(job)
    else if (isActive(job.state)) this.schedule(job.jobId, job.nextPollS ?? 2)
  }

  private async complete(job: Job) {
    try {
      const assets: DocAsset[] = []
      for (const o of job.outputs ?? []) {
        const blob = await this.relay.fetchOutput(o)
        await putBlobAs(o.sha256, blob)
        const a: DocAsset = {
          sha256: o.sha256,
          kind: o.mime.startsWith('video/') ? 'video' : 'image',
          mime: o.mime,
          origin: job.kind === 'mock' ? 'mock' : 'generated',
          job_id: job.jobId,
          locations: outputLocations(o.sha256, o.url),
        }
        if (o.bytes) a.bytes = o.bytes
        if (o.w) a.w = o.w
        if (o.h) a.h = o.h
        if (o.durationS) a.duration_s = o.durationS
        assets.push(a)
      }
      // Closed while its outputs came in: the bytes are kept (shared blobs), the job stays "fetching"
      // in its own document and lands when that project is opened again.
      if (this.stopped) return
      systemUpdate(this.doc, (d) => {
        for (const a of assets) if (!d.assets.some((x) => x.sha256 === a.sha256)) d.assets.push(a)
        const j = d.jobs.find((x) => x.id === job.jobId)
        if (j) {
          j.state = 'completed'
          j.outputs = (job.outputs ?? []).map((o) => o.sha256)
          j.updated_at = new Date().toISOString()
        }
      }, `complete ${job.op}`)
      this.live.set(job.jobId, { state: 'completed' })
      this.emit()
      const ctx = this.ui.get().jobCtx[job.jobId]
      if (!ctx) return
      const handler = this.handlers.get(ctx.for)
      if (handler) handler(job, ctx)
      else this.waiting.set(ctx.for, [...(this.waiting.get(ctx.for) ?? []), { job, ctx }])
    } catch (e) {
      this.fail(job.jobId, asContractError(e))
    }
  }
}

/** Where an output's bytes can be found. The document only takes idb://, s3:// and https:// locations,
 *  so a local dev relay's http://localhost URL is left out (the bytes are in this browser anyway). */
export function outputLocations(sha256: string, url: string): string[] {
  return /^https:\/\//.test(url) ? [idbLocation(sha256), url] : [idbLocation(sha256)]
}

/** Prompt files renamed without changing their content. A .clan made before the promptVersion
 *  pattern was loosened refuses dotted names, and a job directed under the old name would be
 *  refused on every save (2026-10-07: "director.v2.1" looped as "1 queued"). Same prompt, new name. */
const PROMPT_RENAMES: Record<string, string> = { 'director.v2.1': 'director.v3' }

export function normalisePromptVersion(job: Job): void {
  const v = job.director?.promptVersion
  if (job.director && v && PROMPT_RENAMES[v]) job.director = { ...job.director, promptVersion: PROMPT_RENAMES[v] }
}
