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
  /** The relay's copy this browser last saved or opened (features/personal-workspaces.clan): its ETag
   *  goes as If-Match on the next save, so a save from somewhere else since is never overwritten. */
  server?: ServerMark
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
  private pending: Op[] = []
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
      const next = this.pending.reduce((l, op) => op(l), v.projects)
      if (JSON.stringify(next) === JSON.stringify(this.list)) return
      this.list = next
      this.emit()
    }).catch(() => {})
    return this.writing
  }

  all = (): ProjectEntry[] => this.list
  get = (id: string): ProjectEntry | undefined => this.list.find((p) => p.id === id)

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  async create(init: { id?: string; name?: string; naming?: ProjectEntry['naming']; summary?: ProjectSummary; at?: string; server?: ServerMark } = {}): Promise<ProjectEntry> {
    const at = init.at ?? this.now().toISOString()
    const entry: ProjectEntry = {
      id: init.id ?? newProjectId(),
      name: init.name?.trim() || UNTITLED,
      naming: init.naming ?? (init.name ? 'person' : 'auto'),
      created: at,
      updated: at,
      summary: init.summary ?? emptySummary(),
      ...(init.server ? { server: init.server } : {}),
    }
    await this.commit((l) => [...l.filter((p) => p.id !== entry.id), entry])
    return entry
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
    const taken = this.list.filter((p) => p.id !== id).map((p) => p.name)
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
    })
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
  private async change(id: string, fn: (p: ProjectEntry) => ProjectEntry) {
    const i = this.list.findIndex((p) => p.id === id)
    if (i < 0) return
    if (JSON.stringify(fn(this.list[i])) === JSON.stringify(this.list[i])) return
    await this.commit((l) => l.map((p) => (p.id === id ? fn(p) : p)))
  }

  /** Write the index as this tab has it (a first load with nothing to carry over still leaves one): every
   *  entry it holds, and any another tab wrote that it does not. */
  saveNow(): Promise<void> {
    const mine = this.list
    return this.commit((l) => [...l.filter((p) => !mine.some((m) => m.id === p.id)), ...mine])
  }

  /** Apply a change here, then write it into the index as stored now (read, change, write: one at a time). */
  private commit(op: Op): Promise<void> {
    this.list = op(this.list)
    this.pending.push(op)
    this.emit()
    this.writing = this.writing.then(async () => {
      if (!this.pending.length) return
      let base: ProjectEntry[] | null = null
      try {
        base = (await this.storage.get<Stored>(INDEX_KEY))?.projects ?? []
      } catch { /* storage cannot be read: write what this tab has */ }
      const ops = this.pending
      this.pending = []
      const written = base ? ops.reduce((l, op) => op(l), base) : this.list
      await this.storage.put(INDEX_KEY, { version: 1, projects: written } satisfies Stored)
      this.channel?.postMessage('changed')
      // What other tabs wrote is here now too, with this tab's newer changes on top.
      const next = this.pending.reduce((l, op) => op(l), written)
      if (JSON.stringify(next) !== JSON.stringify(this.list)) {
        this.list = next
        this.emit()
      }
    }).catch(() => {})
    return this.writing
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }
}
