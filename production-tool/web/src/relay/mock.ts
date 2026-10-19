// The in-browser mock relay: used whenever VITE_RELAY_URL is not set, so the
// whole UI runs with `npm run dev` and no backend. It follows the relay
// contract: idempotent on jobId, fake queue positions, about 2 s per image,
// every output `kind: "mock"`. Images come back as the input stamped "MOCK";
// clips are short canvas recordings.
//
// Test hooks, typed into any text box that goes with a job:
//   #fail      → the job fails with provider_failed (retryable)
//   #moderate  → the job fails with moderated (not retryable)
//   [ask]      → the job stops at needs_input with a nudge question (two options, one recommended);
//                POST /jobs/{id}/answer resumes it, and a second answer is 409 AnswerConflict (in a write,
//                the item's lines say it, as the relay's passthrough reads them)
//
// Contract 3 (features/contract-v3.clan): a request of any other contractVersion is refused, the Job
// names its project, tenant, starter, crew, node, nonce and purpose, a shot list is PlannedShot[], and
// the stitch leaves out clips marked endCard (it adds its own end card).

import { crewFor, newUlidId } from '../../../clan-store/src'
import type {
  Answer, AnswerConflict, AssetRef, CameraMovement, CameraSize, Config, ContractError, CrewId, InputMime, Job, JobAnswer, JobRequest,
  JobShot, JobState, Key, LibraryEntry, LibraryIndex, LibraryPublish, LogEntry, Me, Output, PlannedShot, Question, Write,
} from '../contracts/types'
import { mockWrites } from './mockWrite'
import { AGENCY_SHELF } from '../contracts/types'
import { quotaClassOf, SPEND_POLICY } from '../contracts/load'
import { getBlob, putBlob } from '../lib/blobs'
import { resolveQuality, sizeLabel } from '../capabilities'
import { hexOf } from '../lib/hash'
import { mockFrameEdit } from '../jobs/frameWords'
import type { AnswerResult, Relay, UploadResult } from './types'
import { RelayError } from './types'

export interface RenderedOutput {
  blob: Blob
  mime: string
  w?: number
  h?: number
  durationS?: number
  /** The size Runway would have rendered before the relay's crop (frame-aspect): metadata only, no crop here. */
  croppedFrom?: { w: number; h: number }
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
  /** Answer write with 422 capability_missing, as a relay without Skye does. */
  writeOff?: boolean
}

interface LedgerItem {
  req: JobRequest
  createdAt: number
  startPos: number
  cancelledAt?: number
  /** [ask]: the question the job stopped at, and the answer that let it go on. */
  question?: Question
  answer?: Answer
  answeredBy?: string
  answeredAt?: number
  done?: { state: JobState; outputs?: Output[]; shots?: PlannedShot[]; writes?: Write[]; error?: ContractError; at: number }
}

const MOCK_HOST = 'https://mock.napkin.invalid'

/** The words the mock's question is asked about. */
const ASK = /\[ask\]/i

/** The value a frame_edit's answer chose (its options' ids are their values: camera, local, both). */
function frameAnswer(item: LedgerItem): string | undefined {
  const fromChange = item.req.input.answer?.optionId
  return item.answer?.option_id ?? fromChange
}

/** What the contract-3 relay says to a request of another contract. */
export const OTHER_CONTRACT = 'This build reads contract 3; reload the page.'

function collectHashes(v: unknown, out: Set<string>) {
  if (typeof v === 'string') {
    if (/^sha256:[0-9a-f]{64}$/.test(v)) out.add(v)
  } else if (Array.isArray(v)) {
    for (const x of v) collectHashes(x, out)
  } else if (v && typeof v === 'object') {
    for (const x of Object.values(v)) collectHashes(x, out)
  }
}

const SIZES: CameraSize[] = ['wide', 'medium', 'close', 'medium', 'insert', 'close']
const MOVES: CameraMovement[] = ['track', 'push_in', 'static', 'orbit', 'pan', 'pull_out']

/** A shot already there, as the request sends it (JobShot): its id and words, and what a re-plan keeps. */
export type ExistingShot = Pick<JobShot, 'id' | 'action'> & Partial<Pick<JobShot, 'kind' | 'camera' | 'refs'>>

const HEADING = /^(INT|EXT|INT\/EXT|I\/E)[. ]/i
const CLAUSE = /,\s+|\s+(?:and|then)\s+/g
const norm = (t: string) => t.toLowerCase().split(/\s+/).filter(Boolean).join(' ').replace(/[.!?\s]+$/, '')
const sentencesOf = (line: string) => line.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter((x) => x.replace(/[.!?\s]/g, ''))

/** A sentence in two at the clause boundary nearest its middle, or undefined. */
function splitClause(text: string): [string, string] | undefined {
  const cuts = [...text.matchAll(CLAUSE)].filter((m) => m.index! > 0 && m.index! + m[0].length < text.length)
  if (!cuts.length) return undefined
  const m = cuts.reduce((a, b) => (Math.abs(b.index! - text.length / 2) < Math.abs(a.index! - text.length / 2) ? b : a))
  const a = text.slice(0, m.index).trim()
  const b = text.slice(m.index! + m[0].length).trim()
  return a && b ? [a, b[0].toUpperCase() + b.slice(1)] : undefined
}

/**
 * What a plan is made of (the same rule as the passthrough director, relay/director/base.py plan_pieces):
 * the shots already there that keep their id, with their words (a script line, or a sentence, that is a
 * shot's action keeps that shot, in its order; a shot with no words takes the next new sentence), and the
 * new shots' words after them, each sentence used once. Fewer sentences than shots make fewer shots (a
 * sentence splits at a clause only to reach the fewest shots the length needs, 10 s each at most); more
 * sentences than shots share them.
 */
export function planPieces(script: string, existing: ExistingShot[], targetS: number): {
  kept: { shot: ExistingShot; action: string }[]
  pieces: { text: string; heading?: string }[]
} {
  const used = new Set<number>()
  const find = (words: string) => existing.findIndex((s, k) => !used.has(k) && !!s.id && !!norm(s.action ?? '') && norm(s.action ?? '') === norm(words))
  let pieces: { text: string; heading?: string }[] = []
  let heading: string | undefined
  for (const line of script.split('\n').map((l) => l.trim()).filter(Boolean)) {
    // A scene heading line (INT. … / EXT. …) is where, not a moment: the shots after it are in that scene.
    if (HEADING.test(line)) {
      heading = line.slice(0, 200)
      continue
    }
    for (const words of find(line) >= 0 ? [line] : sentencesOf(line)) {
      const k = find(words)
      if (k >= 0) used.add(k)
      else pieces.push({ text: words, ...(heading ? { heading } : {}) })
    }
  }
  const kept: { shot: ExistingShot; action: string }[] = []
  existing.forEach((s, k) => {
    if (used.has(k)) kept.push({ shot: s, action: s.action })
    else if (s.id && !(s.action ?? '').trim() && pieces.length) kept.push({ shot: s, action: pieces.shift()!.text }) // a shot with no words takes the next new words
  })
  const fewest = Math.max(2, Math.ceil(targetS / 10))
  const most = Math.max(fewest, Math.ceil(targetS / 5))
  while (pieces.length && kept.length + pieces.length < fewest) {
    const i = pieces.reduce((best, p, j) => (p.text.length > pieces[best].text.length ? j : best), 0)
    const cut = splitClause(pieces[i].text)
    if (!cut) break
    pieces.splice(i, 1, { ...pieces[i], text: cut[0] }, { ...pieces[i], text: cut[1] })
  }
  const slots = pieces.length ? Math.max(1, most - kept.length) : 0
  if (pieces.length > slots) {
    const size = Math.floor(pieces.length / slots)
    const rest = pieces.length % slots
    const grouped: typeof pieces = []
    let at = 0
    for (let g = 0; g < slots; g++) {
      const part = pieces.slice(at, at + size + (g < rest ? 1 : 0))
      at += part.length
      grouped.push({ text: part.map((p) => p.text).join(' '), ...(part[0].heading ? { heading: part[0].heading } : {}) })
    }
    pieces = grouped
  }
  return { kept, pieces }
}

/** The mock director: each sentence of the script once (planPieces), seconds summing to the target; each
 * new shot shows every character it was given, by its bare key when it has a front (the real director
 * picks a variant only when the moment needs one). A re-plan (`existing`, the shots the request sent)
 * keeps the shots whose words are still in the script, by id and camera, so the web merges by id; the
 * new words come after them. */
export function mockShotList(script: string, targetS: number, names: string[] = [], existing: ExistingShot[] = []): PlannedShot[] {
  const keys = names.filter((n) => n.endsWith('_front')).map((n) => n.split('_')[0])
  names = [...keys, ...names.filter((n) => !keys.includes(n.split('_')[0]))]
  const { kept, pieces } = planPieces(script, existing, targetS)
  if (!kept.length && !pieces.length) pieces.push({ text: 'Our hero looks at the camera.' })
  const n = Math.min(24, kept.length + pieces.length)
  const base = Math.floor(targetS / n)
  const extra = targetS - base * n
  return Array.from({ length: n }, (_, i): PlannedShot => {
    const duration_s = Math.max(1, base + (i < extra ? 1 : 0))
    const k = kept[i]
    const camera = k?.shot.camera ?? { size: SIZES[i % SIZES.length], movement: MOVES[i % MOVES.length] }
    const beats = [{ kind: 'camera' as const, at_s: 0, text: `${(camera.movement ?? 'static').replace('_', ' ')} on a ${camera.size} shot` }]
    if (k) {
      return {
        id: k.shot.id, kind: k.shot.kind ?? 'shot', duration_s, camera, action: k.action.slice(0, 300),
        refs: (k.shot.refs?.length ? k.shot.refs : names).slice(0, 9), beats,
      }
    }
    const said = pieces[i - kept.length]
    return {
      kind: 'shot',
      ...(said.heading ? { scene_heading: said.heading } : {}),
      duration_s,
      camera,
      action: said.text.slice(0, 300),
      refs: names.slice(0, 9),
      beats,
    }
  })
}

/** The mock's question: a nudge with two options, the first recommended. Its id is minted here, like the relay's. */
function mockQuestion(): Question {
  return {
    id: newUlidId('q'),
    kind: 'nudge',
    text: 'Open wide on the street, or start close on the hero?',
    why: 'The words could open either way.',
    options: [
      { id: 'wide', label: 'Open wide', detail: 'Set the place first.' },
      { id: 'close', label: 'Start close', detail: 'Lead with the hero.' },
    ],
    allow_text: true,
    recommended_option_id: 'wide',
  }
}

/** The mock's agency: Napkin's own tenant, UUIDv5 of 'napkin:agency:napkin' (as napkin-web's TenantId::of_agency). */
export const MOCK_TENANT = { id: 'f283da90-07cd-59ec-b370-b23704a2bc91', agency: 'napkin' } as const

export class MockRelay implements Relay {
  readonly kind = 'mock' as const
  private readonly ledger = new Map<string, LedgerItem>()
  private readonly running = new Map<string, Promise<void>>()
  private readonly opts: Required<Omit<MockOptions, 'persistKey'>> & { persistKey: string | null }
  private readonly participantId = 'p_mock000'
  private readonly handle = 'guest'

  constructor(opts: MockOptions) {
    this.opts = {
      renderer: opts.renderer,
      now: opts.now ?? (() => Date.now()),
      delayMs: opts.delayMs ?? 2000,
      persistKey: opts.persistKey === undefined ? 'napkin-pt.mock-ledger' : opts.persistKey,
      putOutput: opts.putOutput ?? putBlob,
      getInput: opts.getInput ?? getBlob,
      writeOff: opts.writeOff ?? false,
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

  /** GET /me: always the same local person, in Napkin's own agency; the mock has no sign-in (features/drop-hackathon-extras.clan). */
  async me(): Promise<Me> {
    return {
      participantId: this.participantId,
      handle: this.handle,
      team: MOCK_TENANT.agency,
      workspace: MOCK_TENANT.id,
      tenant: { ...MOCK_TENANT },
      // As the relay answers with no tenant limits set (contracts/spend-policy.json, features/tenant-limits.clan).
      allow: { claude: SPEND_POLICY.allow.claude, makers: [...SPEND_POLICY.allow.makers] },
      quotas: null,
      projects: 0, // nothing is saved to a server without the relay
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
    if (req.contractVersion !== '3') throw new RelayError({ code: 'invalid_input', message: OTHER_CONTRACT, retryable: false }, 400)
    // Skye switched off, as an older relay or an agency whose text may not go to the model answers.
    if (req.op === 'write' && this.opts.writeOff) throw new RelayError({ code: 'capability_missing', message: "Skye isn't available here yet.", retryable: false }, 422)
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

  /** POST /jobs/{jobId}/answer. `by`: who answers (tests answer as someone else); the mock's own person by default. */
  async answerJob(jobId: string, answer: JobAnswer, by = `human:${this.participantId}`): Promise<AnswerResult> {
    if (answer.contractVersion !== '3') throw new RelayError({ code: 'invalid_input', message: OTHER_CONTRACT, retryable: false }, 400)
    const item = this.ledger.get(jobId)
    if (!item) throw new RelayError({ code: 'invalid_input', message: 'No such job.', retryable: false }, 404)
    if (item.answer && item.answeredBy) {
      const conflict: AnswerConflict = {
        error: { code: 'conflict', message: 'Someone answered first.', retryable: false },
        answeredBy: item.answeredBy,
        answer: item.answer,
      }
      return { conflict }
    }
    if (!item.question || item.question.id !== answer.questionId) {
      throw new RelayError({ code: 'invalid_input', message: 'This job is not asking that.', retryable: false }, 400)
    }
    item.answer = answer.optionId ? { option_id: answer.optionId } : { text: answer.text! }
    item.answeredBy = by
    item.answeredAt = this.opts.now()
    this.save()
    return { job: this.snapshot(jobId) }
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

  async library(shelf = AGENCY_SHELF): Promise<LibraryIndex> {
    const data = this.libraryData()
    return {
      workspace: MOCK_TENANT.id,
      shelf,
      keys: Object.values(data).filter((v) => v.at(-1)!.shelf === shelf).map((versions) => {
        const e = versions[versions.length - 1]
        const refs = e.refs ?? []
        const front = refs.find((r) => r.variant === 'front') ?? refs[0]
        return {
          key: e.key, kind: e.kind, ver: e.ver, ...(e.role ? { role: e.role } : {}), by: e.by, at: e.at,
          variants: refs.map((r) => r.variant), ...(front ? { cover: front.asset } : {}),
        }
      }).sort((a, b) => a.key.localeCompare(b.key)),
    }
  }

  async libraryEntry(key: Key, ver?: number, _shelf = AGENCY_SHELF): Promise<LibraryEntry> {
    const versions = this.libraryData()[key] ?? []
    const e = ver ? versions.find((v) => v.ver === ver) : versions[versions.length - 1]
    if (!e) throw new RelayError({ code: 'invalid_input', message: `There is no ${key} in your workspace's library.`, retryable: false }, 404)
    return e
  }

  async publish(key: Key, req: LibraryPublish, shelf = AGENCY_SHELF): Promise<LibraryEntry> {
    const data = this.libraryData()
    const versions = data[key] ?? []
    const latest = versions.length ? versions[versions.length - 1].ver : 0
    if (req.baseVer !== latest) {
      throw new RelayError({ code: 'conflict', message: `Someone published version ${latest} of this key since yours. Import it first, then publish.`, retryable: false }, 409)
    }
    const entry: LibraryEntry = {
      workspace: MOCK_TENANT.id, shelf, kind: req.kind, key, ver: latest + 1, ...(req.role ? { role: req.role } : {}), by: this.handle,
      at: new Date(this.opts.now()).toISOString(), ...(req.refs ? { refs: req.refs } : {}), ...(req.payload ? { payload: req.payload } : {}),
    }
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
      const req = item.req.op === 'stitch'
        ? { ...item.req, input: { ...item.req.input, clips: (item.req.input.clips ?? []).filter((c) => !c.endCard) } }
        : item.req
      const text = `${req.input.text ?? ''} ${req.input.script ?? ''}`
      try {
        if (/#moderate/i.test(text)) {
          item.done = { state: 'failed', at: this.opts.now(), error: { code: 'moderated', message: 'This request was blocked by the safety check.', retryable: false, providerCode: 'SAFETY.INPUT.TEXT' } }
        } else if (/#fail/i.test(text)) {
          item.done = { state: 'failed', at: this.opts.now(), error: { code: 'provider_failed', message: 'The provider could not make this one. Try again.', retryable: true } }
        } else if (req.op === 'frame_edit' && mockFrameEdit(req.input, frameAnswer(item)).edit?.runAs === 'none') {
          // Only the camera's move changes: nothing is drawn (features/frame-change-edit.clan).
          item.done = { state: 'completed', at: this.opts.now(), outputs: [] }
        } else if (req.op === 'write' && req.input.write) {
          item.done = { state: 'completed', at: this.opts.now(), writes: mockWrites(req.input.write), outputs: [] }
        } else if (req.op === 'shot_list') {
          const names = (req.input.refs ?? []).flatMap((r) => (r.name ? [r.name] : []))
          item.done = { state: 'completed', at: this.opts.now(), shots: mockShotList(req.input.script ?? '', req.input.targetS ?? 10, names, req.input.shots ?? []), outputs: [] }
        } else {
          const rendered = await this.opts.renderer.render(req, this.opts.getInput)
          const outputs: Output[] = []
          for (const r of rendered) {
            const sha256 = await this.opts.putOutput(r.blob)
            const o: Output = { sha256, url: `${MOCK_HOST}/out/${sha256}`, mime: r.mime, bytes: r.blob.size }
            if (r.w) o.w = r.w
            if (r.h) o.h = r.h
            if (r.durationS) o.durationS = Math.round(r.durationS * 100) / 100
            if (r.croppedFrom) o.croppedFrom = { ...r.croppedFrom }
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
    // An answered question starts the job's clock again: it goes on from where it stopped.
    const elapsed = now - (item.answeredAt ?? item.createdAt)
    const delay = this.delayFor(req.op)
    // Change this frame: the passthrough's reading of the words (jobs/frameEdit.ts), its ask included.
    const frameEdit = req.op === 'frame_edit' ? mockFrameEdit(req.input, frameAnswer(item)) : undefined
    const words = `${req.input.text ?? ''} ${req.input.script ?? ''} ${(req.input.write?.lines ?? []).map((l) => l.text).join(' ')}`
    const asks = (ASK.test(words) || !!frameEdit?.question) && !req.input.answer
    let state: JobState
    let queuePosition: number | undefined
    if (item.done) {
      state = item.done.state
    } else if (asks && !item.answer && elapsed >= delay * 0.4) {
      state = 'needs_input'
      if (!item.question) {
        item.question = frameEdit?.question ? { id: newUlidId('q'), ...frameEdit.question } : mockQuestion()
        this.save()
      }
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
      contractVersion: '3',
      jobId,
      participantId: this.participantId,
      tenantId: MOCK_TENANT.id,
      projectId: req.projectId,
      startedBy: `human:${this.participantId}`,
      crew: crewFor(req.op) as CrewId,
      node: req.node,
      nonce: req.nonce,
      ...(req.purpose ? { purpose: req.purpose } : {}),
      op: req.op,
      quotaClass: quotaClassOf(req.op),
      state,
      nextPollS: 1,
      provider: 'mock',
      model: req.modelChoice?.model ?? 'mock',
      requestId: `mock-${hexOf(jobId).slice(-8).toLowerCase()}`,
      inputHashes: [...hashes],
      kind: 'mock',
      cost: { estimate: 0, reserved: 0, confirmed: 0, currency: 'USD', unknown: false },
      createdAt: new Date(item.createdAt).toISOString(),
      updatedAt: new Date(item.done?.at ?? now).toISOString(),
    }
    if (queuePosition !== undefined) job.queuePosition = queuePosition
    if (req.op === 'clip' || req.op === 'clip_edit') {
      // What ran, as the relay says it (features/clip-quality.clan): the level and its size on the model's sheet.
      const sized = resolveQuality(req.op, req.modelChoice?.provider ?? 'mock', req.modelChoice?.model, req.quality)
      job.model = sized.model
      if (sized.level && sized.tier && !sized.keepsSize) job.quality = { level: sized.level, size: sizeLabel(sized.tier)! }
    }
    if (item.done?.outputs) job.outputs = item.done.outputs
    // A take's cuts (features/connected-video.clan): the mock cuts at the prompt's times, so each is found
    // there (the relay's take_cuts finds a real one within the model's accuracy).
    if (item.done?.state === 'completed' && req.op === 'clip' && (req.input.mode === 'take' || req.input.mode === 'take_refs')) {
      job.cuts = mockCuts(req.input)
    }
    if (item.done?.shots) job.shots = item.done.shots
    if (item.done?.writes) job.writes = item.done.writes
    if (item.done?.error) job.error = item.done.error
    if (item.question) job.question = item.question
    if (frameEdit?.edit && state !== 'needs_input') {
      job.director = {
        model: 'passthrough', promptVersion: 'director.v0', rationale: `mock: read as a ${frameEdit.edit.reading} change`,
        output: { op: 'frame_edit', frameEdit: frameEdit.edit, question: null, rationale: 'mock', confidence: 0.1 },
      }
    }
    if (item.answer && item.answeredBy) {
      job.answer = item.answer
      job.answeredBy = item.answeredBy
    }
    return job
  }
}

/** Where the mock take cuts: at each shot's start after the first (the request's cuts, else the shots' lengths). */
export function mockCuts(input: JobRequest['input']): { planned_s: number; found_s: number | null }[] {
  let at = 0
  const starts = input.cuts?.map((c) => c.atS) ?? (input.shots ?? []).map((s) => { const a = at; at += s.duration_s; return a })
  return starts.slice(1).map((s) => ({ planned_s: s, found_s: s }))
}
