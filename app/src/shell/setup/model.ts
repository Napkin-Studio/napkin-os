// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The setup flow's logic and its words (features/agency-setup.clan). Pure, so it is tested without a
// browser. Progress is never stored: a step is done when its data exists, and the server says so.

import type { ImportKind, ImportReport, SetupStatus } from './api'

export const STEP_IDS = ['logo', 'name', 'people', 'clients', 'jobs'] as const
export type StepId = (typeof STEP_IDS)[number]

export interface StepInfo {
  id: StepId
  /** The word on the step list. */
  nav: string
  title: string
  line: string
}

export const STEPS: readonly StepInfo[] = [
  { id: 'logo', nav: 'Logo', title: 'Start with your logo', line: 'Drop in your logo as an SVG or a PNG. Napkin takes its colour and paints the studio with it. You can change it any time.' },
  { id: 'name', nav: 'Name', title: 'Name your agency', line: 'This is the name your people see, and the name on what you send to clients.' },
  { id: 'people', nav: 'People', title: 'Bring your people in', line: 'One line per person. Everyone gets the home that fits their role, and you can change a role later, with no new sign-in.' },
  { id: 'clients', nav: 'Clients', title: 'Add your clients', line: 'One line per client. A client you list twice is added once.' },
  { id: 'jobs', nav: 'Jobs', title: 'Open your live jobs', line: 'One line per job, filed under a client that is already here.' },
]

export const stepOf = (id: StepId): StepInfo => STEPS.find(s => s.id === id)!
export const numberOf = (id: StepId): number => STEP_IDS.indexOf(id) + 1
export const nextStep = (id: StepId): StepId | null => STEP_IDS[STEP_IDS.indexOf(id) + 1] ?? null
export const prevStep = (id: StepId): StepId | null => STEP_IDS[STEP_IDS.indexOf(id) - 1] ?? null

/** Where leaving and coming back resumes: the first step whose data is not there yet. */
export function firstUnfinished(status: Pick<SetupStatus, 'steps'>): StepId | null {
  return status.steps.find(s => !s.done)?.id ?? null
}

export const isDone = (status: Pick<SetupStatus, 'steps'> | null, id: StepId): boolean =>
  !!status?.steps.find(s => s.id === id)?.done

export const NOUN: Record<ImportKind, { one: string; many: string; of: string }> = {
  people: { one: 'person', many: 'people', of: 'people' },
  clients: { one: 'client', many: 'clients', of: 'clients' },
  jobs: { one: 'job', many: 'jobs', of: 'jobs' },
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The home card's line: what comes next, in words. */
export function nextLine(status: Pick<SetupStatus, 'steps' | 'next'> | null): { head: string; verb: string } | null {
  if (!status || !status.next) return null
  const done = status.steps.filter(s => s.done).length
  const info = stepOf(status.next)
  return { head: done === 0 ? 'Your agency is not set up yet. It starts with your logo.' : `Next in your setup: ${info.title.toLowerCase()}.`, verb: done === 0 ? 'Start setup' : 'Continue setup' }
}

/** What a file check or an import says, in two short lines. */
export function importSummary(r: ImportReport): { head: string; sub: string | null; tone: 'ok' | 'look' | 'none' } {
  const n = NOUN[r.kind]
  const bad = r.errors.length
  if (r.committed || (!r.dry_run && r.ok > 0)) {
    const parts: string[] = []
    if (r.created > 0) parts.push(`${r.created} added`)
    if (r.updated > 0) parts.push(`${r.updated} changed`)
    if (r.unchanged > 0) parts.push(`${r.unchanged} already here`)
    const head = `${plural(r.created + r.updated + r.unchanged, n.one, n.many)} done: ${parts.join(', ')}.`
    return { head, sub: bad > 0 ? `${plural(bad, 'row was', 'rows were')} left out. They are listed below, by line.` : null, tone: bad > 0 ? 'look' : 'ok' }
  }
  if (r.ok === 0) {
    return { head: `None of the ${plural(r.rows, 'row', 'rows')} can be imported.`, sub: 'Fix the lines below and choose the file again. Nothing has been saved.', tone: 'none' }
  }
  if (r.created === 0 && r.updated === 0) {
    return { head: `All ${r.ok} ${r.ok === 1 ? n.one : n.many} in this file are already here. Nothing would change.`, sub: bad > 0 ? `${plural(bad, 'row needs', 'rows need')} a look.` : null, tone: bad > 0 ? 'look' : 'ok' }
  }
  const ready = `${r.ok} ${r.ok === 1 ? `${n.one} is` : `${n.many} are`} ready to import.`
  return {
    head: bad > 0 ? `${ready} ${plural(bad, 'row needs', 'rows need')} a look.` : ready,
    sub: bad > 0 ? 'The rows that need a look are left out. Fix them in the file and import it again, or go on without them. Nothing has been saved yet.' : 'Nothing has been saved yet.',
    tone: bad > 0 ? 'look' : 'ok',
  }
}

/** The first people list for an agency starts its directory: said plainly before it is saved. */
export function directoryNote(r: ImportReport, agency: string | null): string | null {
  if (r.kind !== 'people' || !r.starts_directory || r.committed) return null
  return `This is ${agency ? `${agency}'s` : 'your'} first people list. Once it is saved, only the people on it can sign in, and you stay on it as an admin.`
}

/** The rows to show, the bad ones first and no more than `limit`; how many were left off. */
export function errorRows(r: ImportReport, limit = 50): { shown: ImportReport['results']; more: number } {
  const bad = r.results.filter(x => x.status === 'error')
  return { shown: bad.slice(0, limit), more: Math.max(0, bad.length - limit) }
}

/** A role as it is said: `creative-director` is Creative director. */
export function roleWords(id: string, titles: ReadonlyMap<string, string> = new Map()): string {
  if (id === 'admin') return 'Admin'
  return titles.get(id) ?? id.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase())
}

export const stateWords = (s: string | undefined): string => (s === 'invited' ? 'Invited' : s === 'removed' ? 'Removed' : s === 'active' ? 'Active' : '')

export type AuditFilter = 'all' | 'approval' | 'export' | 'link' | 'sign-in' | 'people'
export const AUDIT_FILTERS: readonly { id: AuditFilter; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'approval', label: 'Approvals' },
  { id: 'export', label: 'Exports' },
  { id: 'link', label: 'Client links' },
  { id: 'people', label: 'People and roles' },
  { id: 'sign-in', label: 'Sign-ins' },
]

/** Which filter a line belongs under: settings and permission changes are one, People and roles. */
export function auditFilterOf(kind: string): AuditFilter {
  return kind === 'permission' || kind === 'settings' ? 'people' : (['approval', 'export', 'link', 'sign-in'].includes(kind) ? (kind as AuditFilter) : 'all')
}

export function auditShown<T extends { kind: string }>(lines: readonly T[], filter: AuditFilter): T[] {
  return filter === 'all' ? [...lines] : lines.filter(l => auditFilterOf(l.kind) === filter)
}

/** `2026-11-12T09:41:02Z` as `12 Nov, 09:41`, in the reader's own time. */
export function whenWords(at: string): string {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return at
  const day = d.toLocaleDateString('en-IE', { day: 'numeric', month: 'short' })
  const time = d.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${day}, ${time}`
}

/** A version hash, short enough to read and long enough to tell two apart: `sha256:a31631...` is `a31631`. */
export function versionWords(v: string | undefined): string | null {
  if (!v) return null
  return v.replace(/^sha256:/, '').slice(0, 8)
}
