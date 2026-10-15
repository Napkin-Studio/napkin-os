// Jobs: submit to the relay, write the document entry at submit (state
// queued), poll no faster than nextPollS, fetch outputs into the blob store,
// then hand the result to whoever asked for it. Pending jobs resume after a
// reload: what each job is for is in the document (contract 3: jobs[id].purpose,
// node and inputs, model/purpose.ts), and what only this browser keeps (the
// request to send again, notices) is in ProjectUi.jobs.
//
// A job may stop and ask (needs_input, ui-behaviour 3.17): its question is
// written to the document as an ask, the runner keeps asking the relay every
// 5 s (someone else may answer), and answer() / change() send a person's answer.
// Neither is ever an undo step.

import { crewFor } from '../../../clan-store/src'
import type {
  AgentBlock, AnswerConflict, Ask, AskAnswer, ClipQuality, ContractError, CrewId, DocAsset, DocJob, Job, JobAnswer, JobInput, JobInputRow, JobRequest, JobState,
  LinkEndpoint, LogEntry, Mime, ModelChoice, Op, ProductionDocument, Region,
} from '../contracts/types'
import { CONTRACT_VERSION, TERMINAL_STATES } from '../contracts/types'
import { systemUpdate, type DocumentStore } from '../doc/store'
import type { JobCtx, JobLocal, JobPurpose, ProjectUi } from '../doc/ui'
import { jobState, record } from '../dogfood/recorder'
import { idbLocation, putBlobAs } from '../lib/blobs'
import { newId, ulid } from '../lib/ulid'
import { purposeInputs, purposeNode, purposeOf, purposeWords } from '../model/purpose'
import { jobsList } from '../model/selectors'
import type { UiStore } from '../projects/uiStore'
import { asContractError, RelayError, type Relay } from '../relay'

export interface LiveInfo {
  state: JobState
  queuePosition?: number
  /** A line for the card while it is still trying something (a result that would not download). */
  note?: string
}

/** Times a job whose POST /jobs answer was lost is sent again when the relay says it never got it. */
export const LOST_RESENDS = 4
/** Waits (s) between tries to download a finished job's outputs; after the last, every FETCH_AGAIN_S. */
export const FETCH_BACKOFF_S = [2, 5, 15, 30]
export const FETCH_AGAIN_S = 60
/** How often a job waiting on a question is asked about: someone else may answer it. */
export const ASK_POLL_S = 5

/** Who starts a job when no one is signed in (the local mock), and their agency. */
export const LOCAL_PERSON = 'human:p_local'
export const LOCAL_TENANT = '00000000-0000-0000-0000-000000000000'

/** POST /jobs never answered, or answered with no verdict (a network error, a gateway 502/504, the
 *  relay's own 500): the relay may have taken the job. A refusal (quota, spend stop, invalid input)
 *  names its code and is final. */
function answerLost(e: unknown): boolean {
  if (!(e instanceof RelayError)) return false
  if (e.status === 0) return e.error.code === 'provider_unavailable'
  return e.status >= 500 && e.error.code === 'internal'
}

const sleep = (s: number) => new Promise<void>((r) => setTimeout(r, s * 1000))

export type CompletionHandler = (job: Job, ctx: JobCtx) => void
export type Purpose = JobPurpose['for']

/** What else a submit carries: what only this browser keeps about the job, and the node when it is
 *  not the purpose's (a Change runs on its question's node). */
export interface SubmitExtras {
  local?: Omit<Partial<JobLocal>, 'request'>
  node?: LinkEndpoint
  /** clip, clip_edit (features/clip-quality.clan): the size to make, and Remake as Final's draft job. */
  quality?: ClipQuality
  promoteFrom?: string
}

/** A person's answer to a job's question. */
export type AnswerChoice = { optionId: string } | { text: string }

function collectHashes(v: unknown, out: Set<string>) {
  if (typeof v === 'string') {
    if (/^sha256:[0-9a-f]{64}$/.test(v)) out.add(v)
  } else if (Array.isArray(v)) v.forEach((x) => collectHashes(x, out))
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => collectHashes(x, out))
}

export function isActive(state: JobState): boolean {
  return !TERMINAL_STATES.includes(state)
}

/**
 * What handlers and panels get for a job: its purpose, read from the document, with what this browser
 * keeps about it. A job another browser started has no JobLocal here: it still lands from its purpose,
 * and its `request` is undefined. Undefined for a job this build does not know the purpose of.
 */
export function jobCtx(d: ProductionDocument, ui: Pick<ProjectUi, 'jobs'>, jobId: string): JobCtx | undefined {
  const j = d.jobs[jobId]
  const purpose = j && purposeOf(j)
  if (!purpose) return undefined
  return { ...(ui.jobs[jobId] ?? { request: undefined }), ...purpose } as JobCtx
}

/** jobCtx for one document and UI, as the chains read it. */
export function ctxReader(d: ProductionDocument, ui: Pick<ProjectUi, 'jobs'>): (jobId: string) => JobCtx | undefined {
  return (id) => jobCtx(d, ui, id)
}

/** The ask a job is waiting on (or last asked), if any. */
export function askOf(d: ProductionDocument, jobId: string): Ask | undefined {
  const j = d.jobs[jobId]
  return (j?.ask_id ? d.asks[j.ask_id] : undefined) ?? Object.values(d.asks).find((a) => a.job_id === jobId)
}

/** The rows the document keeps of what a job used, beyond its purpose's: the named refs it sends. */
function inputRows(input: JobInput): JobInputRow[] {
  return (input.refs ?? []).filter((r) => r.name).map((r) => ({ kind: 'ref', ref: r.id, used_as: r.role, included: true }))
}

const answerRow = (a: AnswerChoice | { option_id?: string; text?: string }) =>
  ('optionId' in a ? { option_id: a.optionId } : 'option_id' in a && a.option_id ? { option_id: a.option_id } : { text: (a as { text: string }).text })

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
  /** Jobs sent again after a lost answer, by how many times (LOST_RESENDS). */
  private readonly resent = new Map<string, number>()
  /** Jobs whose outputs are being downloaded: nothing else may land them (a cancel landed one twice). */
  private readonly completing = new Set<string>()

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

  /** A job's purpose with what this browser keeps about it (jobCtx). */
  ctx(jobId: string): JobCtx | undefined {
    return jobCtx(this.doc.get(), this.ui.get(), jobId)
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

  /** The person this browser acts for: human:<participantId>, or the local person when no one is signed in. */
  private person(): string {
    const me = this.ui.get().me
    return me ? `human:${me.participantId}` : LOCAL_PERSON
  }

  // ── submit / retry / cancel ──

  /** `modelChoice`: the model picked in the regenerate menu (features/model-choice.clan). */
  async submit(
    op: Op, input: JobInput, parentIds: string[], purpose: JobPurpose, jobId = newId('job'), modelChoice?: ModelChoice, extras: SubmitExtras = {},
  ): Promise<string> {
    if (this.stopped) throw new Error('the project was closed')
    const d = this.doc.get()
    const node = extras.node ?? purposeNode(d, purpose, jobId)
    const words = purposeWords(purpose)
    // A fresh nonce for every job: another take is never deduped with the one running (ui-behaviour 4.3).
    const nonce = ulid()
    const request: JobRequest = {
      contractVersion: CONTRACT_VERSION, jobId, op, projectId: d.project.id, nonce, purpose: words, node, parentIds, input,
      ...(modelChoice ? { modelChoice } : {}),
      ...(extras.quality && (op === 'clip' || op === 'clip_edit') ? { quality: extras.quality } : {}),
      ...(extras.promoteFrom && (op === 'clip' || op === 'clip_edit') ? { promoteFrom: extras.promoteFrom } : {}),
    }
    const hashes = new Set<string>()
    collectHashes(input, hashes)
    const me = this.ui.get().me
    const entry: DocJob = {
      id: jobId,
      v: 1,
      field_v: {},
      op,
      state: 'queued',
      node,
      purpose: words,
      started_by: this.person(),
      tenant_id: me?.tenant.id ?? LOCAL_TENANT,
      nonce,
      crew: crewFor(op) as CrewId,
      parent_ids: parentIds,
      input_hashes: [...hashes],
      created_at: new Date().toISOString(),
    }
    const rows = [...purposeInputs(purpose), ...inputRows(input)].slice(0, 32)
    if (rows.length) entry.inputs = rows
    if (input.text) entry.text = input.text
    if (input.chips?.length) entry.chips = input.chips
    if (input.region) entry.region = input.region as Region
    this.ui.update((u) => {
      u.jobs[jobId] = { ...extras.local, request }
    })
    void systemUpdate(this.doc, (x) => {
      x.jobs[jobId] = entry
    }, `submit ${op}`)
    this.live.set(jobId, { state: 'queued' })
    this.emit()
    // The beta's record: what was asked, once; then only the job's state changes (never a poll).
    record('job-submit', op, {
      jobId, for: purpose.for, pick: modelChoice ? `${modelChoice.provider}:${modelChoice.model}` : undefined,
      parents: parentIds.length, inputs: [...hashes], text: input.text, chips: input.chips, region: input.region,
    })
    jobState(jobId, 'queued', { op })
    await this.send(request)
    return jobId
  }

  /** How many of this person's jobs the relay runs at once (config inFlightPerParticipant; the session sets it). */
  inFlightLimit: () => number = () => Infinity
  /** Jobs the relay holds a place for now (queued or running there), by id. */
  private readonly atRelay = new Set<string>()
  /** Requests waiting in this browser for a place, oldest first: never sent past the limit (it was a 429). */
  private held: JobRequest[] = []

  /** Keep the count of places the relay holds for this person, and send what waits when one frees. */
  private track(jobId: string, relayState: JobState | null) {
    const holds = relayState !== null && ['queued', 'submitting', 'submitted', 'fetching', 'validating'].includes(relayState)
    if (holds) this.atRelay.add(jobId)
    else this.atRelay.delete(jobId)
    while (this.held.length && this.atRelay.size < this.inFlightLimit() && !this.stopped) {
      const next = this.held.shift()!
      void this.send(next)
    }
  }

  private async send(request: JobRequest) {
    if (!this.atRelay.has(request.jobId) && this.atRelay.size >= this.inFlightLimit()) {
      // Wait here, "In the queue", until one of this person's jobs at the relay finishes.
      if (!this.held.some((r) => r.jobId === request.jobId)) this.held.push(request)
      this.live.set(request.jobId, { state: 'queued' })
      this.emit()
      return
    }
    this.atRelay.add(request.jobId)
    try {
      const job = await this.relay.createJob(request)
      if (this.stopped) return
      this.apply(job)
    } catch (e) {
      const err = asContractError(e)
      this.atRelay.delete(request.jobId)
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
      // The answer was lost, not refused (features/video-stage-findings.clan): the relay may be making
      // it already, so failing it here let Retry pay twice. Stay queued and ask; a 404 sends the same
      // request again (poll), and the same jobId never pays twice.
      if (answerLost(e) && this.live.get(request.jobId)?.state !== 'cancelled') {
        this.live.set(request.jobId, { state: 'queued' })
        this.emit()
        this.schedule(request.jobId, 3)
        return
      }
      this.fail(request.jobId, err)
    }
  }

  /** Re-run a failed job as a new job (same input, new id and nonce: the old id would return the same failure).
   *  `modelChoice`: run it on another model this time (null: the routed default); left out, the same pick.
   *  null when this browser does not hold the job's request (another browser started it). */
  async retry(jobId: string, modelChoice?: ModelChoice | null): Promise<string | null> {
    const j = this.doc.get().jobs[jobId]
    const purpose = j && purposeOf(j)
    const local = this.ui.get().jobs[jobId] as JobLocal | undefined
    if (!j || !purpose || !local?.request) return null
    const { request } = local
    const newJobId = newId('job')
    this.ui.update((u) => {
      const c = u.jobs[jobId]
      if (c) {
        c.dismissed = true
        c.retriedAs = newJobId
      }
    })
    const pick = modelChoice === undefined ? request.modelChoice : modelChoice ?? undefined
    record('job-action', modelChoice === undefined ? 'retry' : 'other-model', {
      jobId, newJobId, pick: pick ? `${pick.provider}:${pick.model}` : undefined,
    })
    const keep: SubmitExtras['local'] = {
      ...(local.followRun ? { followRun: local.followRun } : {}),
      ...(local.fixModelChoice ? { fixModelChoice: local.fixModelChoice } : {}),
      ...(local.fixQuality ? { fixQuality: local.fixQuality } : {}),
    }
    await this.submit(request.op, request.input, request.parentIds, purpose, newJobId, pick, {
      local: keep, node: j.node, ...(request.quality ? { quality: request.quality } : {}), ...(request.promoteFrom ? { promoteFrom: request.promoteFrom } : {}),
    })
    return newJobId
  }

  async cancel(jobId: string) {
    record('job-action', 'cancel', { jobId })
    // Its result is already downloading: it lands as it is (a cancel then landed it twice, 2026-10-09).
    if (this.completing.has(jobId)) return
    this.stopPolling(jobId)
    const waiting = this.held.findIndex((r) => r.jobId === jobId)
    if (waiting >= 0) {
      // Never sent: nothing to stop at the relay.
      this.held.splice(waiting, 1)
      this.patchDocJob(jobId, { state: 'cancelled' })
      this.live.set(jobId, { state: 'cancelled' })
      this.emit()
      return
    }
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
    record('job-action', 'dismiss', { jobId })
    this.ui.update((u) => {
      // A job another browser started has no entry here yet: the dismissal is this browser's alone.
      u.jobs[jobId] = { ...(u.jobs[jobId] ?? {}), dismissed: true } as JobLocal
    })
  }

  async report(jobId: string | undefined, message: string, extra: Partial<LogEntry> = {}) {
    const entry: LogEntry = {
      level: 'report',
      message: message.slice(0, 2000),
      browser: navigator.userAgent.slice(0, 300),
      ...extra,
    }
    if (jobId) {
      entry.jobId = jobId
      const node = this.doc.get().jobs[jobId]?.node
      if (node && !entry.node) entry.node = node
    }
    record('job-action', 'report', { jobId, message: entry.message })
    try {
      await this.relay.log(entry)
      return true
    } catch {
      return false
    }
  }

  /** Pick up every job that was still moving when the page was last open. */
  resume() {
    for (const j of jobsList(this.doc.get())) {
      if (isActive(j.state)) {
        this.live.set(j.id, { state: j.state })
        if (j.state !== 'needs_input' && j.state !== 'uncertain') this.atRelay.add(j.id)
        if (j.state !== 'uncertain') this.schedule(j.id, 0.2) // the relay never moves an uncertain job
      }
    }
    this.emit()
  }

  // ── a job that asks ──

  /**
   * Answer the question a job stopped at (ui-behaviour 3.17): POST /jobs/{id}/answer, and the job goes on
   * under the same id. The answer is the person's decision ("answer …"), never an undo step. When someone
   * answered first, their answer is written instead and returned as `conflict`.
   */
  async answer(jobId: string, choice: AnswerChoice): Promise<{ ok: true } | { conflict: AnswerConflict }> {
    const ask = askOf(this.doc.get(), jobId)
    if (!ask) throw new Error('This job is not asking anything.')
    const body: JobAnswer = { contractVersion: CONTRACT_VERSION, questionId: ask.question.id, ...('optionId' in choice ? { optionId: choice.optionId } : { text: choice.text }) }
    record('job-action', 'answer', { jobId })
    const r = await this.relay.answerJob(jobId, body)
    if ('conflict' in r) {
      const won = r.conflict
      await this.doc.change((d) => {
        const a = d.asks[ask.id]
        if (!a || a.answers.some((x) => x.by === won.answeredBy)) return
        a.answers = [...a.answers, { ...answerRow(won.answer), by: won.answeredBy, at: new Date().toISOString() } as AskAnswer]
        a.state = 'answered'
      }, { action: 'sync', quiet: true, undo: false })
      this.schedule(jobId, 0.2)
      return { conflict: won }
    }
    await this.doc.change((d) => {
      const a = d.asks[ask.id]
      if (!a) return
      a.answers = [...a.answers, { ...answerRow(choice), by: this.person(), at: new Date().toISOString() } as AskAnswer]
      a.state = 'answered'
    }, { action: `answer ${ask.question.text}`.slice(0, 300), undo: false, ...this.citing(jobId) })
    this.apply(r.job)
    return { ok: true }
  }

  /**
   * Change an answer (ui-behaviour 3.17): a NEW job of the same op, for the same node and purpose, carrying
   * the new answer (input.answer) with the asking job as its parent. The answer joins the ask's answers as
   * the person's decision ("change_answer …"), never an undo step. Resolves the new job's id.
   */
  async change(jobId: string, choice: AnswerChoice): Promise<string> {
    const d = this.doc.get()
    const j = d.jobs[jobId]
    const ask = askOf(d, jobId)
    if (!j || !ask) throw new Error('This job is not asking anything.')
    const purpose = purposeOf(j) ?? { for: 'canvas' as const }
    const local = this.ui.get().jobs[jobId] as JobLocal | undefined
    const answer: JobAnswer = { contractVersion: CONTRACT_VERSION, questionId: ask.question.id, ...('optionId' in choice ? { optionId: choice.optionId } : { text: choice.text }) }
    const input: JobInput = { ...(local?.request?.input ?? {}), answer }
    if (!input.text && j.text) input.text = j.text
    record('job-action', 'change-answer', { jobId })
    const newJobId = await this.submit(j.op, input, [jobId], purpose, undefined, local?.request?.modelChoice, {
      node: j.node, local: local?.followRun ? { followRun: local.followRun } : undefined,
      ...(local?.request?.quality ? { quality: local.request.quality } : {}),
    })
    await this.doc.change((x) => {
      const a = x.asks[ask.id]
      if (!a) return
      a.answers = [...a.answers, { ...answerRow(choice), by: this.person(), at: new Date().toISOString() } as AskAnswer].slice(-16)
    }, { action: `change_answer ${ask.question.text}`.slice(0, 300), undo: false, ...this.citing(jobId) })
    return newJobId
  }

  private citing(jobId: string): { cites?: string[] } {
    const docId = this.doc.documentId?.()
    return docId ? { cites: [`${docId}#jobs[${jobId}]`] } : {}
  }

  /** The question a polled job asks, as the document's ask (once); and an answer someone gave elsewhere. */
  private noteAsk(job: Job) {
    const q = job.question
    if (!q) return
    void systemUpdate(this.doc, (d) => {
      const j = d.jobs[job.jobId]
      if (!j) return
      let ask = d.asks[q.id]
      if (!ask) {
        ask = { id: q.id, v: 1, field_v: {}, question: q, node: job.node ?? j.node, job_id: job.jobId, crew: (job.crew ?? j.crew) as CrewId, state: 'open', answers: [] }
        d.asks[q.id] = ask
      }
      if (j.ask_id !== q.id) j.ask_id = q.id
      if (job.answer && job.answeredBy && ask.state === 'open') {
        ask.answers = [...ask.answers, { ...answerRow(job.answer), by: job.answeredBy, at: job.updatedAt || new Date().toISOString() } as AskAnswer]
        ask.state = 'answered'
      }
    }, 'sync')
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
      const request = (this.ui.get().jobs[jobId] as JobLocal | undefined)?.request
      if (e instanceof RelayError && e.status === 404 && request && this.live.get(jobId)?.state === 'queued') {
        // A lost answer whose request never got there either: bounded, for a relay that always errors.
        const n = (this.resent.get(jobId) ?? 0) + 1
        this.resent.set(jobId, n)
        if (n <= LOST_RESENDS) return void this.send(request)
        return this.fail(jobId, { code: 'provider_unavailable', message: 'The server did not take this job. Try again.', retryable: true })
      }
      if (e instanceof RelayError && e.status === 404) {
        // The relay had it and no longer does (a local relay restarted): "No such job." with no Retry
        // left it stuck (2026-10-09). Making it again is a new job.
        return this.fail(jobId, { code: 'internal', message: 'The server lost track of this job. Retry makes it again.', retryable: true })
      }
      if (err.code === 'invalid_input') this.fail(jobId, err)
      else if (err.code === 'unauthorised') this.schedule(jobId, 10) // signed out: resume once signed in again
      else this.schedule(jobId, 5) // network blip: keep trying, the ledger has the job
    }
  }

  private fail(jobId: string, error: ContractError) {
    jobState(jobId, 'failed', { code: error.code, message: error.message, ms: this.ageMs(jobId) })
    this.stopPolling(jobId)
    this.patchDocJob(jobId, { state: 'failed', error })
    this.live.set(jobId, { state: 'failed' })
    this.emit()
    this.track(jobId, null)
  }

  /** How long since the job was asked for, for the record. */
  private ageMs(jobId: string): number | undefined {
    const at = this.doc.get().jobs[jobId]?.created_at
    return at ? Date.now() - Date.parse(at) : undefined
  }

  private patchDocJob(jobId: string, patch: Partial<DocJob>) {
    void systemUpdate(this.doc, (d) => {
      const j = d.jobs[jobId]
      // Only a real change moves updated_at: a poll that learns nothing writes nothing.
      const changed = j && Object.entries(patch).some(([k, v]) => JSON.stringify((j as unknown as Record<string, unknown>)[k]) !== JSON.stringify(v))
      if (j && changed) Object.assign(j, patch, { updated_at: new Date().toISOString() })
    })
  }

  /** Keep where the relay meant to run the job, when it made it elsewhere (Runway, the floor, after its
   *  pick could not), beside the job's request: the card says "Made on Runway: Mock could not". */
  private noteFallback(job: Job) {
    const local = this.ui.get().jobs[job.jobId] as JobLocal | undefined
    if (!local || !job.fallbackFrom) return
    if (local.fallbackFrom?.provider === job.fallbackFrom.provider && local.fallbackReason === job.fallbackReason) return
    this.ui.update((u) => {
      const c = u.jobs[job.jobId]
      if (!c) return
      c.fallbackFrom = { provider: job.fallbackFrom!.provider, model: job.fallbackFrom!.model }
      if (job.fallbackReason) c.fallbackReason = job.fallbackReason
    })
  }

  private apply(job: Job) {
    if (this.completing.has(job.jobId)) return // its outputs are downloading: that lands it
    normalisePromptVersion(job)
    const done = job.state === 'completed'
    const prev = this.doc.get().jobs[job.jobId]
    if (prev && !isActive(prev.state) && prev.state === job.state) return
    this.live.set(job.jobId, { state: done ? 'fetching' : job.state, queuePosition: job.queuePosition })
    jobState(job.jobId, done ? 'fetching' : job.state, {
      op: job.op, provider: job.provider, model: job.model, fallbackFrom: job.fallbackFrom?.provider,
      code: job.error?.code, message: job.error?.message, ms: this.ageMs(job.jobId),
    })
    const patch: Partial<DocJob> = { state: done ? 'fetching' : job.state, cost: job.cost }
    if (job.provider) patch.provider = job.provider
    if (job.model) patch.model = job.model
    if (job.requestId) patch.remote_id = job.requestId
    if (job.director) {
      patch.director = agentForDocument(job.director)
      const cards = job.director.cards
      const local = this.ui.get().jobs[job.jobId] as JobLocal | undefined
      if (cards?.length && local && !local.cards) {
        this.ui.update((u) => { const c = u.jobs[job.jobId]; if (c) c.cards = cards })
      }
    }
    if (job.error) patch.error = job.error
    this.patchDocJob(job.jobId, patch)
    this.noteAsk(job)
    this.noteFallback(job)
    this.emit()
    this.track(job.jobId, job.state)
    if (done) void this.complete(job)
    // Waiting on a question: keep asking, someone else may answer it (ui-behaviour 5.2).
    else if (job.state === 'needs_input') this.schedule(job.jobId, ASK_POLL_S)
    // Uncertain is final at the relay (it never sends it again): asking every 2 s for ever changed
    // nothing (2026-10-09). The card waits for the participant: Stop waiting, or Try again.
    else if (isActive(job.state) && job.state !== 'uncertain') this.schedule(job.jobId, job.nextPollS ?? 2)
  }

  /** Download a finished job's outputs into the blob store. A blip does not fail the job (Retry then paid
   *  for a new clip, 2026-10-09): it is tried again after FETCH_BACKOFF_S, then the job stays "fetching" and
   *  is asked about every FETCH_AGAIN_S, which downloads it again; a reload does the same (resume). */
  private async download(job: Job): Promise<DocAsset[] | null> {
    for (let attempt = 0; ; attempt++) {
      try {
        const assets: DocAsset[] = []
        for (const o of job.outputs ?? []) {
          const blob = await this.relay.fetchOutput(o)
          await putBlobAs(o.sha256, blob)
          const a: DocAsset = {
            sha256: o.sha256,
            kind: o.mime.startsWith('video/') ? 'video' : 'image',
            mime: o.mime as Mime,
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
        return assets
      } catch {
        if (this.stopped) return null
        if (attempt >= FETCH_BACKOFF_S.length) {
          this.live.set(job.jobId, { state: 'fetching', note: 'Could not download it yet; trying again.' })
          this.emit()
          return null
        }
        await sleep(FETCH_BACKOFF_S[attempt])
        if (this.stopped) return null
      }
    }
  }

  private async complete(job: Job) {
    if (this.completing.has(job.jobId)) return
    this.completing.add(job.jobId)
    let assets: DocAsset[] | null
    try {
      assets = await this.download(job)
    } finally {
      this.completing.delete(job.jobId)
    }
    if (!assets) {
      if (!this.stopped) this.schedule(job.jobId, FETCH_AGAIN_S) // still "fetching": the next poll downloads it again
      return
    }
    try {
      // Closed while its outputs came in: the bytes are kept (shared blobs), the job stays "fetching"
      // in its own document and lands when that project is opened again.
      if (this.stopped) return
      await systemUpdate(this.doc, (d) => {
        for (const a of assets) if (!d.assets[a.sha256]) d.assets[a.sha256] = a
        const j = d.jobs[job.jobId]
        if (j) {
          j.state = 'completed'
          j.outputs = (job.outputs ?? []).map((o) => o.sha256)
          j.updated_at = new Date().toISOString()
        }
      }, `complete ${job.op}`)
      this.live.set(job.jobId, { state: 'completed' })
      jobState(job.jobId, 'completed', { op: job.op, provider: job.provider, model: job.model, outputs: assets.map((a) => a.sha256), ms: this.ageMs(job.jobId) })
      this.emit()
      const ctx = this.ctx(job.jobId)
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

/** The director block as the document keeps it (jobs[].director): without `cards`. The cards go to
 *  the landing's rationale instead (JobLocal.cards, clan-store jobRationale). */
export function agentForDocument(block: AgentBlock): AgentBlock {
  if (!('cards' in block)) return block
  const { cards: _cards, ...rest } = block
  return rest
}

export function normalisePromptVersion(job: Job): void {
  const v = job.director?.promptVersion
  if (job.director && v && PROMPT_RENAMES[v]) job.director = { ...job.director, promptVersion: PROMPT_RENAMES[v] }
}
