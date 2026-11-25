// The project index (features/project-home.clan): every project this browser
// holds, with what Home shows of it. The projects' own things live under their
// ids (storage.ts); the index only lists them. The ids are prefixed ULIDs
// (prj_…), the shape the relay takes in X-Project-Id.

import { ulid } from '../lib/ulid'
import { INDEX_KEY, type ProjectStorage } from './storage'
import { UNTITLED, type ProjectSummary } from './summary'

export interface ProjectEntry {
  id: string
  name: string
  /** 'auto': named from the script's first line as it changes; 'person': renamed by hand, kept. */
  naming: 'auto' | 'person'
  created: string
  updated: string
  summary: ProjectSummary
  /** The newest relay copy this browser saved or opened, from any of its tabs (features/personal-workspaces.clan):
   *  what "saved HH:MM" and Home show. Never a tab's If-Match: each tab sends the version its own document is
   *  based on (serverCopy.ts, re-test R1). */
  server?: ServerMark
  /** A blank film nothing was added to yet (owner 2026-11-18): not listed on All projects, and gone when it is
   *  left empty. The first change to its document, or a mark on its canvas, keeps it (keep). */
  draft?: true
}

export interface ServerMark {
  etag: string
  savedAt: string
}

interface Stored {
  version: 1
  projects: ProjectEntry[]
}

export type Sort = 'recent' | 'name'

export const newProjectId = () => `prj_${ulid()}`

export function emptySummary(): ProjectSummary {
  return { stage: 'character', pictures: 0, shots: 0, behind: 0, adSeconds: null, active: 0, shas: [] }
}

/** Newest change first, or by name (then newest). */
export function ordered(list: readonly ProjectEntry[], sort: Sort = 'recent', query = ''): ProjectEntry[] {
  const q = query.trim().toLowerCase()
  const hits = q ? list.filter((p) => p.name.toLowerCase().includes(q)) : [...list]
  const recent = (a: ProjectEntry, b: ProjectEntry) => b.updated.localeCompare(a.updated)
  return hits.sort(sort === 'name' ? (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || recent(a, b) : recent)
}

/** `name`, else "name 2", "name 3", … whichever is not taken yet (case aside). */
export function unusedName(name: string, taken: readonly string[]): string {
  const have = new Set(taken.map((t) => t.toLowerCase()))
  if (!have.has(name.toLowerCase())) return name
  for (let n = 2; ; n++) if (!have.has(`${name} ${n}`.toLowerCase())) return `${name} ${n}`
}

/** "Name (copy)", "Name (copy 2)", … not taken yet. */
export function copyName(name: string, taken: readonly string[]): string {
  const base = name.replace(/ \(copy(?: \d+)?\)$/, '')
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? `${base} (copy)` : `${base} (copy ${n})`
    if (!taken.includes(candidate)) return candidate
  }
}

/** One change to the list: applied here at once, then again to the stored list when it is written. */
type Op = (list: ProjectEntry[]) => ProjectEntry[]

/** A change, and the project whose save mark it clears on purpose (the relay has no copy of it any more). */
interface Pending {
  op: Op
  clears?: string
}

const later = (a: ServerMark, b: ServerMark) => {
  const ta = Date.parse(a.savedAt)
  const tb = Date.parse(b.savedAt)
  return Number.isFinite(ta) && Number.isFinite(tb) ? ta > tb : false
}

/**
 * `next` with every project's save mark moved forward only: an entry that would carry an older mark than `base`
 * has (or none, unless `clears` names it) keeps `base`'s. The relay's savedAt only grows, so whatever path writes
 * an entry (a whole-list write, a copy another tab read earlier), a mark never goes back (re-test N3).
 */
export function marksForward(base: readonly ProjectEntry[], next: ProjectEntry[], clears: ReadonlySet<string> = new Set()): ProjectEntry[] {
  const before = new Map(base.map((p) => [p.id, p.server]))
  return next.map((p) => {
    const had = before.get(p.id)
    if (!had) return p
    if (p.server ? later(had, p.server) : !clears.has(p.id)) return { ...p, server: had }
    return p
  })
}

/** The tabs of this browser say "the index changed" on this channel, and the others read it again. */
export const INDEX_CHANNEL = 'napkin-production-index'

/**
 * The index, kept in storage. Changes are written at once (they are few and small), each one merged into the
 * index as stored at that moment, never the whole list this tab holds (re-test N3, 2026-11-18): a second tab
 * that read the index earlier wrote its copy over the first tab's save mark, and the next save went without
 * If-Match. A change to one project touches that project's entry only.
 */
export class ProjectIndex {
  private list: ProjectEntry[] = []
  private readonly listeners = new Set<() => void>()
  private readonly storage: ProjectStorage
  private readonly now: () => Date
  private writing: Promise<void> = Promise.resolve()
  /** Changes made here and not written yet, oldest first. */
  private pending: Pending[] = []
  private readonly channel: BroadcastChannel | null

  /** `channel`: tell this browser's other tabs when the index changes, and read it again when they do. */
  constructor(storage: ProjectStorage, now: () => Date = () => new Date(), opts: { channel?: string } = {}) {
    this.storage = storage
    this.now = now
    this.channel = opts.channel && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(opts.channel) : null
    if (this.channel) this.channel.onmessage = () => { void this.reload() }
  }

  /** Read the index. False when there is none yet (a first load: see migrate.ts). */
  async load(): Promise<boolean> {
    const v = await this.storage.get<Stored>(INDEX_KEY)
    this.list = v?.projects ?? []
    this.emit()
    return !!v
  }

  /** Another tab wrote the index: take what it has, with this tab's unwritten changes on top. */
  private reload(): Promise<void> {
    this.writing = this.writing.then(async () => {
      const v = await this.storage.get<Stored>(INDEX_KEY)
      if (!v) return
      const next = this.apply(v.projects, this.pending)
      if (JSON.stringify(next) === JSON.stringify(this.list)) return
      this.list = next
      this.emit()
    }).catch(() => {})
    return this.writing
  }

  /** The person's projects on the relay (id and name), as last listed: a name a project gives itself is not one of
   *  theirs either (re-test N-D: a fresh browser's spin-off took the name of a project only the server listed). */
  private remote: { id: string; name: string }[] = []

  /** What the relay lists now. */
  knowRemote(rows: readonly { id: string; name?: string }[]) {
    this.remote = rows.flatMap((r) => (r.name ? [{ id: r.id, name: r.name }] : []))
  }

  /** The name the host's library gave `id` when it was last listed; undefined when it was not listed. */
  serverName = (id: string): string | undefined => this.remote.find((r) => r.id === id)?.name

  all = (): ProjectEntry[] => this.list
  get = (id: string): ProjectEntry | undefined => this.list.find((p) => p.id === id)

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  async create(init: { id?: string; name?: string; naming?: ProjectEntry['naming']; summary?: ProjectSummary; at?: string; server?: ServerMark; draft?: true } = {}): Promise<ProjectEntry> {
    const at = init.at ?? this.now().toISOString()
    const entry: ProjectEntry = {
      id: init.id ?? newProjectId(),
      name: init.name?.trim() || UNTITLED,
      naming: init.naming ?? (init.name ? 'person' : 'auto'),
      created: at,
      updated: at,
      summary: init.summary ?? emptySummary(),
      ...(init.server ? { server: init.server } : {}),
      ...(init.draft ? { draft: true as const } : {}),
    }
    await this.commit((l) => [...l.filter((p) => p.id !== entry.id), entry])
    return entry
  }

  /** Something was added to a blank film: it is a project now, listed and kept. */
  async keep(id: string): Promise<void> {
    await this.change(id, (p) => {
      const { draft: _d, ...rest } = p
      return rest
    })
  }

  /** A person's name for it: kept from now on, whatever the script says. Blank goes back to naming itself. */
  async rename(id: string, name: string): Promise<void> {
    const n = name.trim().replace(/\s+/g, ' ').slice(0, 80)
    await this.change(id, (p) => (n ? { ...p, name: n, naming: 'person' } : { ...p, naming: 'auto' }))
  }

  /** What the project is now. `name`: the script's first line, taken only while the project names itself. */
  async touch(id: string, summary: ProjectSummary, opts: { name?: string | null; changed?: boolean } = {}): Promise<void> {
    // A name it gives itself is its own: another project's already is "Name 2", "Name 3"… (re-test N9: two films
    // named themselves after the same brief, on Home and on the server).
    const taken = [...this.list, ...this.remote].filter((p) => p.id !== id).map((p) => p.name)
    const auto = opts.name ? unusedName(opts.name, taken) : UNTITLED
    await this.change(id, (p) => ({
      ...p,
      summary,
      ...(p.naming === 'auto' ? { name: auto } : {}),
      ...(opts.changed === false ? {} : { updated: this.now().toISOString() }),
    }))
  }

  /** The relay's copy as this browser last saved or opened it (undefined: none). Not an edit: `updated` stays. */
  async setServer(id: string, server: ServerMark | undefined): Promise<void> {
    await this.change(id, (p) => {
      const { server: _old, ...rest } = p
      return server ? { ...rest, server } : rest
    }, server ? undefined : id)
  }

  async remove(id: string): Promise<void> {
    await this.commit((l) => l.filter((p) => p.id !== id))
  }

  /** Is this picture used by a project other than `except`? */
  usedElsewhere(sha: string, except: string): boolean {
    return this.list.some((p) => p.id !== except && p.summary.shas.includes(sha))
  }

  /** A change to one project's entry: made to the entry as stored when it is written, so whatever another tab
   *  wrote to it (or to any other project) since this tab read the index stays. */
  private async change(id: string, fn: (p: ProjectEntry) => ProjectEntry, clears?: string) {
    const i = this.list.findIndex((p) => p.id === id)
    if (i < 0) return
    if (JSON.stringify(fn(this.list[i])) === JSON.stringify(this.list[i])) return
    await this.commit((l) => l.map((p) => (p.id === id ? fn(p) : p)), clears)
  }

  /** Write the index as this tab has it (a first load with nothing to carry over still leaves one): every
   *  entry it holds, and any another tab wrote that it does not. */
  saveNow(): Promise<void> {
    const mine = this.list
    return this.commit((l) => [...l.filter((p) => !mine.some((m) => m.id === p.id)), ...mine])
  }

  /** Apply a change here, then write it into the index as stored now: read, change and write in one step no
   *  other tab comes between (storage.update), with every save mark moving forward only (marksForward). */
  private commit(op: Op, clears?: string): Promise<void> {
    const change: Pending = { op, clears }
    this.list = this.apply(this.list, [change])
    this.pending.push(change)
    this.emit()
    this.writing = this.writing.then(async () => {
      if (!this.pending.length) return
      const changes = this.pending
      this.pending = []
      let written: ProjectEntry[]
      try {
        written = (await this.storage.update<Stored>(INDEX_KEY, (v) => ({ version: 1, projects: this.apply(v?.projects ?? [], changes) }))).projects
      } catch {
        // Storage cannot be read: write what this tab has.
        written = this.list
        await this.storage.put(INDEX_KEY, { version: 1, projects: written } satisfies Stored)
      }
      this.channel?.postMessage('changed')
      // What other tabs wrote is here now too, with this tab's newer changes on top.
      const next = this.apply(written, this.pending)
      if (JSON.stringify(next) !== JSON.stringify(this.list)) {
        this.list = next
        this.emit()
      }
    }).catch(() => {})
    return this.writing
  }

  /** `changes` made to `base`, no save mark going back. */
  private apply(base: ProjectEntry[], changes: readonly Pending[]): ProjectEntry[] {
    const clears = new Set(changes.flatMap((c) => (c.clears ? [c.clears] : [])))
    return marksForward(base, changes.reduce((l, c) => c.op(l), base), clears)
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }
}
