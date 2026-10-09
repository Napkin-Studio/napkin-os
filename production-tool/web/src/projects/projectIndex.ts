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

/** "Name (copy)", "Name (copy 2)", … not taken yet. */
export function copyName(name: string, taken: readonly string[]): string {
  const base = name.replace(/ \(copy(?: \d+)?\)$/, '')
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? `${base} (copy)` : `${base} (copy ${n})`
    if (!taken.includes(candidate)) return candidate
  }
}

/** The index, kept in storage. Changes are written at once (they are few and small). */
export class ProjectIndex {
  private list: ProjectEntry[] = []
  private readonly listeners = new Set<() => void>()
  private readonly storage: ProjectStorage
  private readonly now: () => Date
  private writing: Promise<void> = Promise.resolve()

  constructor(storage: ProjectStorage, now: () => Date = () => new Date()) {
    this.storage = storage
    this.now = now
  }

  /** Read the index. False when there is none yet (a first load: see migrate.ts). */
  async load(): Promise<boolean> {
    const v = await this.storage.get<Stored>(INDEX_KEY)
    this.list = v?.projects ?? []
    this.emit()
    return !!v
  }

  all = (): ProjectEntry[] => this.list
  get = (id: string): ProjectEntry | undefined => this.list.find((p) => p.id === id)

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  async create(init: { id?: string; name?: string; naming?: ProjectEntry['naming']; summary?: ProjectSummary; at?: string } = {}): Promise<ProjectEntry> {
    const at = init.at ?? this.now().toISOString()
    const entry: ProjectEntry = {
      id: init.id ?? newProjectId(),
      name: init.name?.trim() || UNTITLED,
      naming: init.naming ?? (init.name ? 'person' : 'auto'),
      created: at,
      updated: at,
      summary: init.summary ?? emptySummary(),
    }
    this.list = [...this.list.filter((p) => p.id !== entry.id), entry]
    await this.save()
    return entry
  }

  /** A person's name for it: kept from now on, whatever the script says. Blank goes back to naming itself. */
  async rename(id: string, name: string): Promise<void> {
    const n = name.trim().replace(/\s+/g, ' ').slice(0, 80)
    await this.change(id, (p) => (n ? { ...p, name: n, naming: 'person' } : { ...p, naming: 'auto' }))
  }

  /** What the project is now. `name`: the script's first line, taken only while the project names itself. */
  async touch(id: string, summary: ProjectSummary, opts: { name?: string | null; changed?: boolean } = {}): Promise<void> {
    await this.change(id, (p) => ({
      ...p,
      summary,
      ...(p.naming === 'auto' ? { name: opts.name || UNTITLED } : {}),
      ...(opts.changed === false ? {} : { updated: this.now().toISOString() }),
    }))
  }

  async remove(id: string): Promise<void> {
    this.list = this.list.filter((p) => p.id !== id)
    await this.save()
  }

  /** Is this picture used by a project other than `except`? */
  usedElsewhere(sha: string, except: string): boolean {
    return this.list.some((p) => p.id !== except && p.summary.shas.includes(sha))
  }

  private async change(id: string, fn: (p: ProjectEntry) => ProjectEntry) {
    const i = this.list.findIndex((p) => p.id === id)
    if (i < 0) return
    const next = fn(this.list[i])
    if (JSON.stringify(next) === JSON.stringify(this.list[i])) return
    this.list = this.list.map((p, j) => (j === i ? next : p))
    await this.save()
  }

  /** Write the index as it is (a first load with nothing to carry over still leaves one). */
  saveNow(): Promise<void> {
    return this.save()
  }

  private save(): Promise<void> {
    this.emit()
    const snapshot: Stored = { version: 1, projects: this.list }
    this.writing = this.writing.then(() => this.storage.put(INDEX_KEY, snapshot)).catch(() => {})
    return this.writing
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }
}
