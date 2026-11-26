// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// A file added in Brief Maker, Research or Production: is it a brand bible, and what does the person want done with it?
// (features/brand-clan.clan, lane B; docs/contracts/brand-clan.md section 7, middleware-api.md section 13; mocks a1 and a2.)
//
//   fileAdded      -> brand_identify (rules, then one Haiku call: nothing at all when the rules say no)
//   one question   -> Update "X" / Make a new Brand Clan (name it) / Not a brand bible      (no Brand Clan yet: Build / Not)
//   the answer     -> brand_build, a background job; the person carries on and the question never blocks "Write the brief"
//   the job        -> polled; done says what is ready, failed says why and offers Retry; a file over 120 pages asks first
//
// No React in this file: the flow takes its ports (the middleware, the client's Brand Clans, the clock) and is tested without a page.
// Everything is per agency; nothing here is kept beyond this tab except the job being waited for (a reload picks it up again).

/** A file an app tells the shell it stored in the open document: `clan:file-added`. `name` is the stored asset name, `label` the person's. */
export interface FileRef { name: string; label: string }
export const FRAME_TYPE = 'clan:file-added'
/** The apps whose uploads may be a brand bible: Brief Maker, Research and Production (a file in any other is not asked about). */
export const BRAND_SOURCE_APPS: readonly string[] = ['ie.napkin.brief-maker', 'ie.napkin.campaign-research', 'ie.napkin.production']
export const takesBrandFiles = (appId: string | null | undefined): boolean => !!appId && BRAND_SOURCE_APPS.includes(appId)

/** The message an app posts after it stored a file (Brief Maker and Research after `upload-asset`, Production after its own upload). */
export function fileFrom(m: unknown): FileRef | null {
  const v = m as { type?: unknown; name?: unknown; label?: unknown } | null
  if (!v || v.type !== FRAME_TYPE || typeof v.name !== 'string' || !v.name || v.name.length > 300 || v.name.includes('/')) return null
  const label = typeof v.label === 'string' && v.label.trim() ? v.label.trim().slice(0, 300) : v.name
  return { name: v.name, label }
}

export interface ClanRef { document_id: string; path: string; name: string; default: boolean }
export interface Question {
  mode: 'new' | 'choose'
  options: string[]
  update: { document_id: string; name: string } | null
  pages: number
  over_cap: boolean
  page_cap: number
}
export interface Identified { ask: boolean; reason: string | null; question: Question | null; pages: number }
export interface BuildStarted { job: string }
export interface JobView { state: 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'needs_input'; error: { type: string; message: string } | null; result: BuildResult | null }
export interface BuildResult { summary: string; mode: 'new' | 'update'; name: string; pending: boolean; path: string | null; gaps: string[] }

export class BrandError extends Error {
  type: string
  status: number
  constructor(type: string, message: string, status = 0) { super(message); this.type = type; this.status = status }
}

export interface Ports {
  /** The client's Brand Clans (lane A's `list`); an empty list when it has none or the host cannot say. */
  clans(clientId: string): Promise<ClanRef[]>
  identify(file: FileRef, client: { id: string; name: string }, clans: ClanRef[]): Promise<Identified>
  /** Starts `brand_build`; throws `BrandError('over_cap', ...)` for a file over 120 pages that was not confirmed. */
  build(file: FileRef, client: { id: string }, a: BuildAnswer): Promise<BuildStarted>
  status(job: string): Promise<JobView>
  sleep(ms: number): Promise<void>
}

export type BuildAnswer =
  | { mode: 'new'; name: string; confirmed: boolean }
  | { mode: 'update'; clan: { document_id: string; path: string; name: string }; confirmed: boolean }

export type Phase =
  | { kind: 'detecting' }
  | { kind: 'ask'; question: Question; clans: ClanRef[] }
  | { kind: 'naming'; question: Question; clans: ClanRef[] }
  | { kind: 'big'; pages: number; answer: BuildAnswer }
  | { kind: 'working'; job: string; answer: BuildAnswer }
  | { kind: 'done'; result: BuildResult; answer: BuildAnswer }
  | { kind: 'failed'; reason: string; answer: BuildAnswer | null }
  | { kind: 'offer' }

export interface Entry { id: string; label: string; phase: Phase }

export interface Store { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void; readonly length: number; key(i: number): string | null }
export interface FlowOptions { client: { id: string; name: string } | null; store?: Store | null; doc: string; pollMs?: number }

const POLL_MS = 2000
const GIVE_UP = 600     // polls: 20 minutes at 2 s, then the person is told it is taking long rather than waiting for ever

/** The words of mock a1 and a2, in one place. */
export const words = {
  title: (label: string) => `${label} looks like a brand bible.`,
  askNew: (client: string) => `${client} has no Brand Clan yet. Build one from it?`,
  askChoose: (client: string) => `${client} has Brand Clans already. What should we do with it?`,
  update: (name: string) => `Update “${name}”`,
  build: 'Build its Brand Clan',
  makeNew: 'Make a new Brand Clan',
  notBible: 'Not a brand bible',
  naming: 'Name the new Brand Clan',
  big: (label: string, pages: number) => `${label} has ${pages} pages.`,
  bigSub: (cap: number) => `Napkin reads up to ${cap} pages on its own; reading all of this one costs more.`,
  bigYes: (pages: number) => `Read all ${pages} pages`,
  bigNo: 'Not now',
  working: (a: BuildAnswer) => a.mode === 'update' ? `Updating “${a.clan.name}” from the brand book` : `Building the Brand Clan “${a.name}” from the brand book`,
  workingSub: (a: BuildAnswer) => a.mode === 'update'
    ? 'in the background. Carry on; we will tell you when its changes are ready to review.'
    : 'in the background. Carry on; we will tell you when it is ready.',
  done: (r: BuildResult) => r.pending ? `A new version of “${r.name}” is ready to review.` : `The Brand Clan “${r.name}” is ready.`,
  doneSub: (r: BuildResult, client: string) => r.pending
    ? `It waits on ${client}’s page, under Brand Clans, until you take it. Nothing changes before then.`
    : `Find it on ${client}’s page, under Brand Clans.`,
  gaps: (n: number) => `${n} ${n === 1 ? 'section was' : 'sections were'} not in the file and ${n === 1 ? 'is' : 'are'} left empty.`,
  failed: 'Could not build the Brand Clan.',
  untouched: 'Your file is untouched and nothing was made.',
  offer: (label: string) => `Build a Brand Clan from ${label}`,
}

const keyOf = (doc: string, name: string) => `napkin.brandbuild.v1:${doc}:${name}`

export class BrandFlow {
  private entries = new Map<string, Entry>()
  private snap: readonly Entry[] = []
  private subs = new Set<() => void>()
  private dead = false
  private ports: Ports
  private opts: FlowOptions
  constructor(ports: Ports, opts: FlowOptions) { this.ports = ports; this.opts = opts }

  subscribe = (fn: () => void) => { this.subs.add(fn); return () => { this.subs.delete(fn) } }
  snapshot = (): readonly Entry[] => this.snap
  /** The page went away: in-flight work stops reporting. `revive` is for a strict-mode remount of the same flow. */
  dispose() { this.dead = true }
  revive() { this.dead = false }

  private put(e: Entry) {
    this.entries.set(e.id, e)
    this.snap = [...this.entries.values()]
    this.subs.forEach(f => f())
  }
  private drop(id: string) {
    this.entries.delete(id)
    this.snap = [...this.entries.values()]
    this.subs.forEach(f => f())
    this.forget(id)
  }
  private remember(id: string, label: string, job: string, answer: BuildAnswer) {
    try { this.opts.store?.setItem(keyOf(this.opts.doc, id), JSON.stringify({ label, job, answer })) } catch { /* kept for this visit only */ }
  }
  private forget(id: string) { try { this.opts.store?.removeItem(keyOf(this.opts.doc, id)) } catch { /* nothing kept */ } }
  private get<T extends Phase['kind']>(id: string, kind: T): (Entry & { phase: Extract<Phase, { kind: T }> }) | null {
    const e = this.entries.get(id)
    return e && e.phase.kind === kind ? (e as Entry & { phase: Extract<Phase, { kind: T }> }) : null
  }

  /** An app stored a file. A file already being dealt with is not asked about twice. */
  async fileAdded(f: FileRef): Promise<void> {
    const client = this.opts.client
    if (!client || this.entries.has(f.name)) return
    this.put({ id: f.name, label: f.label, phase: { kind: 'detecting' } })
    const clans = await this.clansOf(client.id)
    let got: Identified
    try { got = await this.ports.identify(f, client, clans) } catch {
      // Detection failing or timing out asks nothing: the file keeps a small action, so the person is never stuck (DESIGN 3).
      if (!this.dead) this.put({ id: f.name, label: f.label, phase: { kind: 'offer' } })
      return
    }
    if (this.dead) return
    if (got.ask && got.question) this.put({ id: f.name, label: f.label, phase: { kind: 'ask', question: got.question, clans } })
    else if (got.reason === 'detection_failed') this.put({ id: f.name, label: f.label, phase: { kind: 'offer' } })
    else this.drop(f.name)       // not a brand bible by the rules or by Haiku: nothing appears
  }

  private clansOf(clientId: string): Promise<ClanRef[]> { return this.ports.clans(clientId).catch(() => []) }

  /** "Build a Brand Clan from this": the chip's small action when detection failed, which asks the question without a model call. */
  async offerBuild(id: string): Promise<void> {
    const e = this.get(id, 'offer')
    const client = this.opts.client
    if (!e || !client) return
    const clans = await this.clansOf(client.id)
    const pick = clans.find(c => c.default) ?? (clans.length === 1 ? clans[0] : null)
    this.put({ ...e, phase: { kind: 'ask', clans, question: {
      mode: clans.length ? 'choose' : 'new', options: clans.length ? ['update', 'new', 'not_bible'] : ['build', 'not_bible'],
      update: pick ? { document_id: pick.document_id, name: pick.name } : null, pages: 0, over_cap: false, page_cap: 120 } } })
  }

  /** The answer to the question. `update` and `build` start at once; `new` first asks for the name. */
  async answer(id: string, a: 'update' | 'new' | 'build' | 'not_bible'): Promise<void> {
    const e = this.get(id, 'ask')
    if (!e) return
    const { question, clans } = e.phase
    if (a === 'not_bible') { this.drop(id); return }
    if (a === 'new') { this.put({ ...e, phase: { kind: 'naming', question, clans } }); return }
    if (a === 'build') return this.start(e, { mode: 'new', name: 'Original', confirmed: false })
    const pick = clans.find(c => c.document_id === question.update?.document_id)
    if (!pick) return
    return this.start(e, { mode: 'update', clan: { document_id: pick.document_id, path: pick.path, name: pick.name }, confirmed: false })
  }

  async make(id: string, name: string): Promise<void> {
    const e = this.get(id, 'naming')
    const n = name.trim()
    if (!e || !n || n.length > 60) return
    return this.start(e, { mode: 'new', name: n, confirmed: false })
  }

  /** A file over the cap: yes reads all of it, no leaves it. */
  async confirmBig(id: string, yes: boolean): Promise<void> {
    const e = this.get(id, 'big')
    if (!e) return
    if (!yes) { this.drop(id); return }
    return this.start(e, { ...e.phase.answer, confirmed: true })
  }

  async retry(id: string): Promise<void> {
    const e = this.get(id, 'failed')
    if (!e) return
    if (!e.phase.answer) { this.put({ ...e, phase: { kind: 'offer' } }); return }
    return this.start(e, e.phase.answer)
  }

  dismiss(id: string) { this.drop(id) }

  private async start(e: Entry, answer: BuildAnswer): Promise<void> {
    const client = this.opts.client
    if (!client) return
    const f = { name: e.id, label: e.label }
    this.put({ ...e, phase: { kind: 'working', job: '', answer } })
    try {
      const { job } = await this.ports.build(f, client, answer)
      if (this.dead) return
      this.remember(e.id, e.label, job, answer)
      this.put({ ...e, phase: { kind: 'working', job, answer } })
      await this.watch(e.id, e.label, job, answer)
    } catch (err) {
      if (this.dead) return
      if (err instanceof BrandError && err.type === 'over_cap') {
        const pages = Number(/(\d+) pages/.exec(err.message)?.[1] ?? 0)
        this.put({ ...e, phase: { kind: 'big', pages, answer } })
        return
      }
      this.put({ ...e, phase: { kind: 'failed', reason: reasonOf(err), answer } })
    }
  }

  /** Follow a job to its end. Called on a fresh start, and by `resume` after a reload. */
  private async watch(id: string, label: string, job: string, answer: BuildAnswer): Promise<void> {
    const poll = this.opts.pollMs ?? POLL_MS
    for (let i = 0; i < GIVE_UP && !this.dead; i++) {
      await this.ports.sleep(poll)
      if (this.dead) return
      let v: JobView
      try { v = await this.ports.status(job) } catch (err) {
        // A job the middleware no longer knows ended with a restart: say so, offer it again.
        if (err instanceof BrandError && err.type === 'unknown_job') { this.forget(id); this.put({ id, label, phase: { kind: 'failed', reason: 'The service restarted while it worked. Run it again.', answer } }); return }
        continue    // a poll that did not get through is tried again
      }
      if (v.state === 'done' && v.result) { this.forget(id); this.put({ id, label, phase: { kind: 'done', result: v.result, answer } }); return }
      if (v.state === 'failed' || v.state === 'cancelled') {
        this.forget(id)
        this.put({ id, label, phase: { kind: 'failed', reason: v.error?.message ?? 'The build stopped.', answer } })
        return
      }
    }
    if (!this.dead) this.put({ id, label, phase: { kind: 'failed', reason: 'It is taking longer than expected.', answer } })
  }

  /** After a reload: pick up each build this document still has running (kept in this tab's session storage until it ends). */
  resumeAll(): void {
    const st = this.opts.store
    if (!st) return
    const prefix = keyOf(this.opts.doc, '')
    const keys: string[] = []
    try { for (let i = 0; i < st.length; i++) { const k = st.key(i); if (k && k.startsWith(prefix)) keys.push(k) } } catch { return }
    for (const k of keys) {
      const id = k.slice(prefix.length)
      const held = readHeld(st, k)
      if (!held?.job || !held.answer || this.entries.has(id)) continue
      const label = held.label || id
      this.put({ id, label, phase: { kind: 'working', job: held.job, answer: held.answer } })
      void this.watch(id, label, held.job, held.answer)
    }
  }
}

function readHeld(st: Store, k: string): { label?: string; job?: string; answer?: BuildAnswer } | null {
  try { return JSON.parse(st.getItem(k) ?? 'null') } catch { return null }
}

/** What the person is told: the service's own reason, never a stack. */
export function reasonOf(err: unknown): string {
  if (err instanceof BrandError) {
    if (err.type === 'host_unavailable') return 'This studio is not set up to keep Brand Clans yet.'
    return err.message || 'It did not work.'
  }
  return 'The studio could not be reached.'
}
