// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What a people file's check or import says, in words (features/align-needs-lock-people.clan, stage 4; the words are the
// build's setup flow's, kept when the flow went). Pure, so it is tested without a browser.

import type { ImportReport } from './api'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** What a file check or an import says, in two short lines. */
export function importSummary(r: ImportReport): { head: string; sub: string | null; tone: 'ok' | 'look' | 'none' } {
  const bad = r.errors.length
  if (r.committed || (!r.dry_run && r.ok > 0)) {
    const parts: string[] = []
    if (r.created > 0) parts.push(`${r.created} added`)
    if (r.updated > 0) parts.push(`${r.updated} changed`)
    if (r.unchanged > 0) parts.push(`${r.unchanged} already here`)
    const head = `${plural(r.created + r.updated + r.unchanged, 'person', 'people')} done: ${parts.join(', ')}.`
    return { head, sub: bad > 0 ? `${plural(bad, 'row was', 'rows were')} left out. They are listed below, by line.` : null, tone: bad > 0 ? 'look' : 'ok' }
  }
  if (r.ok === 0) {
    return { head: `None of the ${plural(r.rows, 'row', 'rows')} can be imported.`, sub: 'Fix the lines below and choose the file again. Nothing has been saved.', tone: 'none' }
  }
  if (r.created === 0 && r.updated === 0) {
    return { head: `All ${r.ok} ${r.ok === 1 ? 'person' : 'people'} in this file are already here. Nothing would change.`, sub: bad > 0 ? `${plural(bad, 'row needs', 'rows need')} a look.` : null, tone: bad > 0 ? 'look' : 'ok' }
  }
  const ready = `${r.ok} ${r.ok === 1 ? 'person is' : 'people are'} ready to import.`
  return {
    head: bad > 0 ? `${ready} ${plural(bad, 'row needs', 'rows need')} a look.` : ready,
    sub: bad > 0 ? 'The rows that need a look are left out. Fix them in the file and import it again, or go on without them. Nothing has been saved yet.' : 'Nothing has been saved yet.',
    tone: bad > 0 ? 'look' : 'ok',
  }
}

/** An agency's first people list, said plainly before it is saved. */
export function firstListNote(r: ImportReport, agency: string | null): string | null {
  if (!r.starts_directory || r.committed) return null
  return `This is ${agency ? `${agency}'s` : 'your'} first people list. Each person can sign in once it is saved, with the roles in the file, and you stay on it as an admin.`
}

/** The rows to show, the bad ones only and no more than `limit`; how many were left off. */
export function errorRows(r: ImportReport, limit = 50): { shown: ImportReport['results']; more: number } {
  const bad = r.results.filter(x => x.status === 'error')
  return { shown: bad.slice(0, limit), more: Math.max(0, bad.length - limit) }
}

/** The import button's words, or null when there is nothing to import. */
export function importVerb(r: ImportReport): string | null {
  const n = r.created + r.updated
  if (r.ok === 0 || (n === 0 && !r.starts_directory)) return null
  return `Import ${n || r.ok} ${(n || r.ok) === 1 ? 'person' : 'people'}`
}
