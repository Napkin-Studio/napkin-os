// The in-browser mock relay: used whenever VITE_RELAY_URL is not set, so the
// whole UI runs with `npm run dev` and no backend. It follows the relay
// contract: idempotent on jobId, fake queue positions, about 2 s per image,
// every output `kind: "mock"`. Images come back as the input stamped "MOCK";
// clips are short canvas recordings.
//
// Test hooks, typed into any text box that goes with a job:
//   #fail      → the job fails with provider_failed (retryable)
//   #moderate  → the job fails with moderated (not retryable)

import type {
  AssetRef, Config, ContractError, InputMime, Job, JobRequest, JobState, Key, LibraryEntry, LibraryIndex, LibraryPublish, LogEntry, Output,
  SessionRequest, SessionResponse, Shot,
} from '../contracts/types'
import { quotaClassOf } from '../contracts/types'
import { getBlob, putBlob } from '../lib/blobs'
import { hexOf } from '../lib/hash'
import { newId } from '../lib/ulid'
import { splitTarget } from '../lib/shots'
import type { Relay, UploadResult } from './types'
import { RelayError } from './types'

export interface RenderedOutput {
  blob: Blob
  mime: string
  w?: number
  h?: number
  durationS?: number
}

/** Makes the mock's pictures and clips. The browser one draws on a canvas; tests pass a stub. */
export interface MockRenderer {
  render(req: JobRequest, input: (sha: string) => Promise<Blob | undefined>): Promise<RenderedOutput[]>
}

export interface MockOptions {
  renderer: MockRenderer
  now?: () => number
  /** Base delay per job in ms (images); video ops take a bit longer. */
  delayMs?: number
  /** Persist the ledger so a reload mid-job resumes (localStorage, wrapped). */
  persistKey?: string | null
  putOutput?: (blob: Blob) => Promise<string>
  getInput?: (sha: string) => Promise<Blob | undefined>
}

interface LedgerItem {
  req: JobRequest
  createdAt: number
  startPos: number
  cancelledAt?: number
  done?: { state: JobState; outputs?: Output[]; shots?: Shot[]; error?: ContractError; at: number }
}

const MOCK_HOST = 'https://mock.napkin.invalid'

function collectHashes(v: unknown, out: Set<string>) {
  if (typeof v === 'string') {
    if (/^sha256:[0-9a-f]{64}$/.test(v)) out.add(v)
  } else if (Array.isArray(v)) {
    for (const x of v) collectHashes(x, out)
  } else if (v && typeof v === 'object') {
    for (const x of Object.values(v)) collectHashes(x, out)
  }
}

const COMPOSITIONS: Shot['composition'][] = ['wide', 'medium', 'close', 'medium', 'insert', 'close']
const MOVES: Shot['camera_move'][] = ['track', 'push_in', 'static', 'orbit', 'pan', 'pull_out']
/** The mock director: split the script into sentences, one shot each, seconds summing to the target;
 * each shot shows every named ref it was given (the real director picks the variant per shot). */
export function mockShotList(script: string, targetS: number, names: string[] = []): Shot[] {
  const durations = splitTarget(targetS)
  const sentences = script.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean)
  return durations.map((d, i) => ({
    id: newId('shot'),
    order: i + 1,
    duration_s: d,
    composition: COMPOSITIONS[i % COMPOSITIONS.length],
    action: (sentences[i] ?? sentences[sentences.length - 1] ?? 'Our hero looks at the camera.').slice(0, 300),
    camera_move: MOVES[i % MOVES.length],
    refs: names.slice(0, 9),
    status: 'planned' as const,
  }))
}

export class MockRelay implements Relay {
  readonly kind = 'mock' as const
  private readonly ledger = new Map<string, LedgerItem>()
  private readonly running = new Map<string, Promise<void>>()
  private readonly opts: Required<Omit<MockOptions, 'persistKey'>> & { persistKey: string | null }
  private participantId = 'p_mock000'
  private handle = 'you'

  constructor(opts: MockOptions) {
    this.opts = {
      renderer: opts.renderer,
      now: opts.now ?? (() => Date.now()),
      delayMs: opts.delayMs ?? 2000,
      persistKey: opts.persistKey === undefined ? 'napkin-pt.mock-ledger' : opts.persistKey,
      putOutput: opts.putOutput ?? putBlob,
      getInput: opts.getInput ?? getBlob,
    }
    this.load()
  }

  private load() {
    if (!this.opts.persistKey) return
    try {
      const raw = localStorage.getItem(this.opts.persistKey)
      if (!raw) return
      const items = JSON.parse(raw) as Record<string, LedgerItem>
      for (const [k, v] of Object.entries(items)) this.ledger.set(k, v)
    } catch { /* no storage; the mock forgets on reload */ }
  }

  private save() {
    if (!this.opts.persistKey) return
    try {
      localStorage.setItem(this.opts.persistKey, JSON.stringify(Object.fromEntries(this.ledger)))
    } catch { /* storage full or blocked */ }
  }

  useToken(_token: string | null) {}

  async session(req: SessionRequest): Promise<SessionResponse> {
    this.participantId = 'p_' + (req.handle.toLowerCase().replace(/[^a-z0-9]/g, '') + 'mock00').slice(0, 8)
    this.handle = req.handle
    return {
      token: 'mock-token',
      participantId: this.participantId,
      handle: req.handle,
      role: 'participant',
      workspace: 'mock',
      expiresAt: new Date(this.opts.now() + 24 * 3600 * 1000).toISOString(),
      quotas: { image: 40, video: 6, render: 3 },
    }
  }

  async upload(blob: Blob, mime: InputMime): Promise<UploadResult> {
    const sha256 = await this.opts.putOutput(blob)
    return { sha256, url: `${MOCK_HOST}/in/${sha256}`, mime, exists: false, bytes: blob.size }
  }

  private delayFor(op: JobRequest['op']): number {
    const d = this.opts.delayMs
    if (op === 'shot_list') return d * 0.75
    if (op === 'clip' || op === 'clip_edit' || op === 'stitch') return d * 1.25
    return d
  }

  async createJob(req: JobRequest): Promise<Job> {
    if (req.contractVersion !== '2') {
      throw new RelayError({ code: 'invalid_input', message: 'Unknown contract version.', retryable: false }, 400)
    }
    const existing = this.ledger.get(req.jobId)
    if (!existing) {
      this.ledger.set(req.jobId, { req, createdAt: this.opts.now(), startPos: 1 + Math.floor(Math.random() * 3) })
      this.save()
    }
    return this.snapshot(req.jobId)
  }

  async getJob(jobId: string): Promise<Job> {
    if (!this.ledger.has(jobId)) throw new RelayError({ code: 'invalid_input', message: 'No such job.', retryable: false }, 404)
    return this.snapshot(jobId)
  }

  async cancelJob(jobId: string): Promise<Job> {
    const item = this.ledger.get(jobId)
    if (!item) throw new RelayError({ code: 'invalid_input', message: 'No such job.', retryable: false }, 404)
    if (!item.done) {
      item.cancelledAt = this.opts.now()
      item.done = { state: 'cancelled', at: this.opts.now() }
      this.save()
    }
    return this.snapshot(jobId)
  }

  async log(entry: LogEntry): Promise<void> {
    console.info('[mock relay] POST /log', entry)
  }

  async config(): Promise<Config | null> {
    return null
  }

  /** The workspace library, in this browser only (localStorage when the ledger persists). */
  private libraryData(): Record<Key, LibraryEntry[]> {
    if (!this.opts.persistKey) return this.memLibrary
    try {
      return JSON.parse(localStorage.getItem('napkin-pt.mock-library') ?? '{}') as Record<Key, LibraryEntry[]>
    } catch {
      return this.memLibrary
    }
  }

  private memLibrary: Record<Key, LibraryEntry[]> = {}

  private saveLibrary(data: Record<Key, LibraryEntry[]>) {
    this.memLibrary = data
    if (!this.opts.persistKey) return
    try {
      localStorage.setItem('napkin-pt.mock-library', JSON.stringify(data))
    } catch { /* storage blocked: memory only */ }
  }

  async library(): Promise<LibraryIndex> {
    const data = this.libraryData()
    return {
      workspace: 'mock',
      keys: Object.values(data).map((versions) => {
        const e = versions[versions.length - 1]
        const cover = (e.refs.find((r) => r.variant === 'front') ?? e.refs[0]).asset
        return { key: e.key, ver: e.ver, role: e.role, by: e.by, at: e.at, variants: e.refs.map((r) => r.variant), cover }
      }).sort((a, b) => a.key.localeCompare(b.key)),
    }
  }

  async libraryEntry(key: Key, ver?: number): Promise<LibraryEntry> {
    const versions = this.libraryData()[key] ?? []
    const e = ver ? versions.find((v) => v.ver === ver) : versions[versions.length - 1]
    if (!e) throw new RelayError({ code: 'invalid_input', message: `There is no ${key} in your workspace's library.`, retryable: false }, 404)
    return e
  }

  async publish(key: Key, req: LibraryPublish): Promise<LibraryEntry> {
    const data = this.libraryData()
    const versions = data[key] ?? []
    const latest = versions.length ? versions[versions.length - 1].ver : 0
    if (req.baseVer !== latest) {
      throw new RelayError({ code: 'conflict', message: `Someone published version ${latest} of this key since yours. Import it first, then publish.`, retryable: false }, 409)
    }
    const entry: LibraryEntry = { workspace: 'mock', key, ver: latest + 1, role: req.role, by: this.handle, at: new Date(this.opts.now()).toISOString(), refs: req.refs }
    this.saveLibrary({ ...data, [key]: [...versions, entry] })
    return entry
  }

  async fetchOutput(output: Output | AssetRef): Promise<Blob> {
    const blob = await this.opts.getInput(output.sha256)
    if (!blob) throw new RelayError({ code: 'internal', message: 'The mock result is gone (storage was cleared).', retryable: true })
    return blob
  }

  /** Kick off the render once the fake queue time has passed. */
  /** Resolves when every job that has started finishing has finished (tests wait on this, not on timers). */
  async settled(): Promise<void> {
    await Promise.all([...this.running.values()])
  }

  private finish(jobId: string, item: LedgerItem) {
    if (this.running.has(jobId)) return
    const p = (async () => {
      const { req } = item
      const text = `${req.input.text ?? ''} ${req.input.script ?? ''}`
      try {
        if (/#moderate/i.test(text)) {
          item.done = { state: 'failed', at: this.opts.now(), error: { code: 'moderated', message: 'This request was blocked by the safety check.', retryable: false, providerCode: 'SAFETY.INPUT.TEXT' } }
        } else if (/#fail/i.test(text)) {
          item.done = { state: 'failed', at: this.opts.now(), error: { code: 'provider_failed', message: 'The provider could not make this one. Try again.', retryable: true } }
        } else if (req.op === 'shot_list') {
          item.done = { state: 'completed', at: this.opts.now(), shots: mockShotList(req.input.script ?? '', req.input.targetS ?? 10, (req.input.refs ?? []).flatMap((r) => (r.name ? [r.name] : []))), outputs: [] }
        } else {
          const rendered = await this.opts.renderer.render(req, this.opts.getInput)
          const outputs: Output[] = []
          for (const r of rendered) {
            const sha256 = await this.opts.putOutput(r.blob)
            const o: Output = { sha256, url: `${MOCK_HOST}/out/${sha256}`, mime: r.mime, bytes: r.blob.size }
            if (r.w) o.w = r.w
            if (r.h) o.h = r.h
            if (r.durationS) o.durationS = Math.round(r.durationS * 100) / 100
            outputs.push(o)
          }
          if (!item.done) item.done = { state: 'completed', at: this.opts.now(), outputs }
        }
      } catch (e) {
        item.done = { state: 'failed', at: this.opts.now(), error: { code: 'internal', message: e instanceof Error ? e.message : 'The mock failed.', retryable: true } }
      }
      this.save()
    })()
    this.running.set(jobId, p)
  }

  private snapshot(jobId: string): Job {
    const item = this.ledger.get(jobId)!
    const { req } = item
    const now = this.opts.now()
    const elapsed = now - item.createdAt
    const delay = this.delayFor(req.op)
    let state: JobState
    let queuePosition: number | undefined
    if (item.done) {
      state = item.done.state
    } else if (elapsed < delay * 0.4) {
      state = 'queued'
      queuePosition = Math.max(1, item.startPos - Math.floor(elapsed / (delay * 0.15)))
    } else if (elapsed < delay * 0.7) {
      state = 'submitted'
      queuePosition = 0
    } else {
      state = 'fetching'
      if (elapsed >= delay) this.finish(jobId, item)
    }
    const hashes = new Set<string>()
    collectHashes(req.input, hashes)
    const job: Job = {
      contractVersion: '2',
      jobId,
      participantId: this.participantId,
      op: req.op,
      quotaClass: quotaClassOf(req.op),
      state,
      nextPollS: 1,
      provider: 'mock',
      model: 'mock',
      requestId: `mock-${hexOf(jobId).slice(-8).toLowerCase()}`,
      inputHashes: [...hashes],
      kind: 'mock',
      cost: { estimate: 0, reserved: 0, confirmed: 0, currency: 'USD', unknown: false },
      createdAt: new Date(item.createdAt).toISOString(),
      updatedAt: new Date(item.done?.at ?? now).toISOString(),
    }
    if (queuePosition !== undefined) job.queuePosition = queuePosition
    if (item.done?.outputs) job.outputs = item.done.outputs
    if (item.done?.shots) job.shots = item.done.shots
    if (item.done?.error) job.error = item.done.error
    if (item.done?.state === 'completed') job.needsUser = null
    return job
  }
}

