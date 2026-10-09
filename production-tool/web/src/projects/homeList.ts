// What Home lists (features/personal-workspaces.clan): this browser's projects and the ones the
// person saved on the relay from anywhere, one card per project id, newest first.

import type { SavedProject } from '../contracts/types'
import type { ProjectEntry, Sort } from './projectIndex'
import { UNTITLED } from './summary'

export type HomeItem =
  | {
      kind: 'local'
      p: ProjectEntry
      /** The relay's copy, when it has one. */
      server?: SavedProject
      /** Saved from somewhere else since this browser last saved or opened it. */
      newerThere: boolean
      at: string
    }
  | { kind: 'server'; row: SavedProject; name: string; at: string }

export const itemId = (i: HomeItem) => (i.kind === 'local' ? i.p.id : i.row.id)
export const itemName = (i: HomeItem) => (i.kind === 'local' ? i.p.name : i.name)

/** One card per project: this browser's (with what the relay has of it) and the relay's others. */
export function homeItems(local: readonly ProjectEntry[], server: readonly SavedProject[], sort: Sort = 'recent', query = ''): HomeItem[] {
  const there = new Map(server.map((r) => [r.id, r]))
  const t = Date.parse
  const items: HomeItem[] = local.map((p) => {
    const row = there.get(p.id)
    const newerThere = !!row && row.etag !== p.server?.etag && (!p.server || t(row.savedAt) > t(p.server.savedAt))
    return { kind: 'local', p, server: row, newerThere, at: row && t(row.savedAt) > t(p.updated) ? row.savedAt : p.updated }
  })
  const mine = new Set(local.map((p) => p.id))
  for (const row of server) if (!mine.has(row.id)) items.push({ kind: 'server', row, name: row.name || UNTITLED, at: row.savedAt })
  const q = query.trim().toLowerCase()
  const hits = q ? items.filter((i) => itemName(i).toLowerCase().includes(q)) : items
  const recent = (a: HomeItem, b: HomeItem) => Date.parse(b.at) - Date.parse(a.at)
  return hits.sort(sort === 'name' ? (a, b) => itemName(a).localeCompare(itemName(b), undefined, { sensitivity: 'base' }) || recent(a, b) : recent)
}

/** "Welcome back, Maya: 3 projects": said at sign-in when the name already has saved work. */
export function welcomeBack(name: string, projects: number): string | null {
  if (projects <= 0) return null
  return `Welcome back, ${name}: ${projects} ${projects === 1 ? 'project' : 'projects'}`
}
