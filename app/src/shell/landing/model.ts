// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What the landing says, worked out from what the host answered: the clients
// and the library listing. Pure: no host, no React, so the rules (urgency,
// counts, the status line, search and Show all) are table-tested.
//
// "Needs you" is a document with something a person must check (the host's
// `state.needs_you`, the same count the document shows), or a run waiting at a
// gate. "Running" is a run in progress. "Failed" is a run that failed. All three
// are read from the library listing, never kept here.

import type { ClientRecord, LibraryItem } from '../../host'
import { TOOLS, toolOfApp, type Tool } from './tools'
import type { Route, ToolId } from '../route'

/**
 * The ring on a circle, in the order that wins when a client has several:
 * needs you, failed, working, thinking, reading, checking, idle. The same
 * vocabulary and order as the Orbs rings (features/landing-circles.clan).
 */
export type Activity = 'human' | 'error' | 'work' | 'think' | 'read' | 'check' | 'idle'

export const ACTIVITY_ORDER: readonly Activity[] = ['human', 'error', 'work', 'think', 'read', 'check', 'idle']

/** The words for a ring: said in text beside every circle, never colour alone. */
export const ACTIVITY_WORD: Record<Activity, string> = {
  human: 'needs you', error: 'failed', work: 'working', think: 'thinking', read: 'reading', check: 'checking', idle: 'idle',
}

/** The one that wins. */
export function strongest(list: readonly Activity[]): Activity {
  let best: Activity = 'idle'
  for (const a of list) if (ACTIVITY_ORDER.indexOf(a) < ACTIVITY_ORDER.indexOf(best)) best = a
  return best
}

/**
 * What a running tool is doing, from the stage its run names. Research stages
 * (`extract`, `research`) read; `select`, `synthesise`, `report` think; a
 * gate or a check checks; any other stage (Deck's `Layout`) is plain work.
 */
export function stageActivity(stage: string | undefined): 'work' | 'think' | 'read' | 'check' {
  const s = (stage ?? '').toLowerCase()
  if (/check|verif|review|valid|proof|judg|lock|gate/.test(s)) return 'check'
  if (/read|extract|research|source|search|ingest|scan|fetch|retriev/.test(s)) return 'read'
  if (/think|identif|select|synthes|draft|plan|reason|compose|report|write/.test(s)) return 'think'
  return 'work'
}

/** The first page of the clients page; the rest wait behind "Show all". */
export const FIRST_PAGE = 8

export interface Tally {
  /** Pieces of work. */
  open: number
  /** Documents with something for a person to check, or a run waiting on one. */
  needsYou: number
  running: number
  failed: number
  /** The strongest of what the running ones are doing (working, thinking, reading, checking); work when unsaid. */
  busy?: Activity
}

const zero = (): Tally => ({ open: 0, needsYou: 0, running: 0, failed: 0 })

function add(t: Tally, item: LibraryItem) {
  t.open += 1
  if (needsYou(item)) t.needsYou += 1
  if (item.run?.state === 'working') {
    t.running += 1
    t.busy = strongest([t.busy ?? 'idle', stageActivity(item.run.stage)])
  }
  if (item.run?.state === 'failed') t.failed += 1
}

export const needsYou = (item: LibraryItem): boolean =>
  (!item.state?.locked && (item.state?.needs_you ?? 0) > 0) || item.run?.state === 'waiting'

export const isRunning = (item: LibraryItem): boolean => item.run?.state === 'working'

export interface ClientSummary {
  client: ClientRecord
  total: Tally
  perTool: Record<ToolId, Tally>
  /** Work that belongs to no tool the table knows (a document of another app). */
  other: Tally
  activity: Activity
  /** The words under the circle: "3 briefs · 1 needs you · 1 running". */
  status: string
  /** Newest `updated_at` among its work; empty with none. */
  latest: string
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

export function activityOf(t: Tally): Activity {
  return t.needsYou ? 'human' : t.failed ? 'error' : t.running ? t.busy ?? 'work' : 'idle'
}

/** What one piece of work shows: waiting on a person, failed, what it is doing, or nothing. */
export function activityOfItem(item: LibraryItem): Activity {
  if (needsYou(item)) return 'human'
  if (item.run?.state === 'failed') return 'error'
  if (item.run?.state === 'working') return stageActivity(item.run.stage)
  return 'idle'
}

/** "3 briefs · 2 research · 1 needs you · 1 running · 1 failed": each tool's work by its own noun, nothing said about a zero. */
export function statusLine(perTool: Record<ToolId, Tally>, total: Tally): string {
  const byTool = TOOLS.filter(t => perTool[t.id].open).map(t => plural(perTool[t.id].open, t.noun[0], t.noun[1]))
  const known = TOOLS.reduce((n, t) => n + perTool[t.id].open, 0)
  const rest = total.open - known
  const parts = byTool.length
    ? [...byTool, ...(rest > 0 ? [`${rest} other`] : [])]
    : [total.open ? plural(total.open, 'piece of work', 'pieces of work') : 'No work yet']
  if (total.needsYou) parts.push(total.needsYou === 1 ? 'needs you' : `${total.needsYou} need you`)
  if (total.failed) parts.push(`${total.failed} failed`)
  if (total.running) parts.push(`${total.running} running`)
  return parts.join(' · ')
}

export function summarise(client: ClientRecord, items: readonly LibraryItem[]): ClientSummary {
  const mine = items.filter(i => i.client?.id === client.id)
  const perTool = Object.fromEntries(TOOLS.map(t => [t.id, zero()])) as Record<ToolId, Tally>
  const total = zero()
  const other = zero()
  let latest = ''
  for (const i of mine) {
    add(total, i)
    add(toolOfApp(i.app_id) ? perTool[toolOfApp(i.app_id)!.id] : other, i)
    if (i.updated_at > latest) latest = i.updated_at
  }
  return { client, total, perTool, other, activity: activityOf(total), status: statusLine(perTool, total), latest }
}

const URGENCY: Record<Activity, number> = { human: 4, error: 3, work: 2, think: 2, read: 2, check: 2, idle: 0 }

/** When a client last saw activity: its newest piece of work, or its making. */
const recentOf = (s: ClientSummary): string => (s.latest > s.client.created_at ? s.latest : s.client.created_at) || ''

/**
 * Urgency first (needs you, failed, running), then the most recent activity, then the order
 * the clients were made in. A client just added, or just worked on, is always on the first
 * page; untouched ones drift behind Show all (owner, 2026-11-12: a new client was hidden).
 */
export function ordered(clients: readonly ClientRecord[], items: readonly LibraryItem[]): ClientSummary[] {
  return clients
    .map((c, i) => ({ s: summarise(c, items), i }))
    .sort((a, b) => URGENCY[b.s.activity] - URGENCY[a.s.activity]
      || (recentOf(b.s) > recentOf(a.s) ? 1 : recentOf(b.s) < recentOf(a.s) ? -1 : 0)
      || a.i - b.i)
    .map(x => x.s)
}

/** Whether a name matches a search: case and spacing do not matter. */
export const matches = (name: string, query: string): boolean => {
  const q = query.split(/\s+/).filter(Boolean).join(' ').toLowerCase()
  return !q || name.split(/\s+/).join(' ').toLowerCase().includes(q)
}

export interface Page {
  shown: ClientSummary[]
  /** Clients beyond the first page that "Show all" would add. */
  hidden: number
  /** Search and Show all are offered once there are more clients than a page. */
  paged: boolean
}

/** What the clients page draws: a search shows every match; otherwise a page, or all. */
export function pageOf(all: readonly ClientSummary[], query: string, showAll: boolean): Page {
  const paged = all.length > FIRST_PAGE
  const found = all.filter(s => matches(s.client.name, query))
  if (query.trim() || showAll || !paged) return { shown: found, hidden: 0, paged }
  return { shown: found.slice(0, FIRST_PAGE), hidden: found.length - FIRST_PAGE, paged }
}

/** A circle's size: the first three are large, the rest small once there are many. */
export function boxFor(index: number, count: number): number {
  return count <= 6 || index < 3 ? 144 : 89
}

export interface AgencySummary {
  clients: number
  open: number
  needsYou: LibraryItem[]
  running: LibraryItem[]
  failed: LibraryItem[]
  /** The ring on the agency circle: the strongest across all work (needs you, failed, working, thinking, reading, checking, idle). */
  activity: Activity
  /** Work that has no client yet. */
  unassigned: number
}

export function agencySummary(clients: readonly ClientRecord[], items: readonly LibraryItem[], unassigned: number): AgencySummary {
  return {
    clients: clients.length,
    open: items.length,
    needsYou: items.filter(needsYou),
    running: items.filter(isRunning),
    failed: items.filter(i => i.run?.state === 'failed'),
    activity: strongest(items.map(activityOfItem)),
    unassigned,
  }
}

/** The line under the greeting: "3 clients · 14 open · 2 need you · 1 running". */
export function countsLine(s: AgencySummary): string {
  if (s.clients === 0) return s.open ? `${plural(s.open, 'piece of work', 'pieces of work')} and no clients yet` : 'No clients yet'
  const parts = [plural(s.clients, 'client'), `${s.open} open`]
  if (s.needsYou.length) parts.push(s.needsYou.length === 1 ? '1 needs you' : `${s.needsYou.length} need you`)
  if (s.running.length) parts.push(`${s.running.length} running`)
  if (s.failed.length) parts.push(`${s.failed.length} failed`)
  return parts.join(' · ')
}

/** The circle's accessible name: everything the sighted see, in words. */
export function circleName(s: ClientSummary): string {
  // Needs you, failed and running are already in the status line; the quieter
  // verbs (thinking, reading, checking) are said here so the ring has words.
  const quiet = s.activity === 'think' || s.activity === 'read' || s.activity === 'check' ? `, ${ACTIVITY_WORD[s.activity]}` : ''
  return `${s.client.name}, ${s.status}${quiet}${s.activity === 'idle' ? ', idle' : ''}. Opens its tools`
}

/**
 * What the polite live region says when a refresh finds something new, so a
 * person who is not looking hears it: more needing them, or a new failure.
 * Nothing when nothing got worse (a job finishing is not announced).
 */
export function newsOf(before: Pick<AgencySummary, 'needsYou' | 'failed'> | null, now: Pick<AgencySummary, 'needsYou' | 'failed'>): string {
  if (!before) return ''
  const parts: string[] = []
  const more = now.needsYou.length - before.needsYou.length
  if (more > 0) parts.push(more === 1 ? '1 more needs you' : `${more} more need you`)
  const fails = now.failed.length - before.failed.length
  if (fails > 0) parts.push(fails === 1 ? '1 more failed' : `${fails} more failed`)
  return parts.join(', ')
}

/** Why a document is on the Needs you strip, in words: a run waiting, or how many things to check. */
export function needsReason(item: LibraryItem): string {
  if (item.run?.state === 'waiting') return item.run.label || 'Waiting for you'
  const n = item.state?.needs_you ?? 0
  return `${n} ${n === 1 ? 'thing' : 'things'} to check`
}

/** What a running or failed document is doing, in words (the run's own label; Failed when it says nothing). */
export const runWords = (item: LibraryItem): string =>
  item.run?.label || (item.run?.state === 'failed' ? 'Failed' : 'Running')

/**
 * A running job as the bar's chip says it (the mock's "Working · step 1/3"):
 * a clean verb, never the run's stage key or its "(0 of 3)", and the step being
 * worked, 1-based for people (the run counts steps done, so 0 of 3 is step 1).
 * The verb is the label's own first word when that is a plain "-ing" verb with
 * nothing after it ("Rewriting"); otherwise "working".
 */
export function jobOf(run: { label?: string | null; progress?: readonly [number, number] | null } | null | undefined): { verb: string; step: readonly [number, number] | null } {
  const label = String(run?.label ?? '').trim()
  const m = /^([A-Za-z]+ing)(?:\s+(?:again|it|the \w+(?: again)?))?\.?$/.exec(label)
  const verb = m ? m[1].toLowerCase() : 'working'
  const p = run?.progress
  const step = p && p[1] > 0 ? [Math.min(Math.max(0, p[0]) + 1, p[1]), p[1]] as const : null
  return { verb, step }
}

/** Which tool a document belongs to, for a strip's second line. */
export const toolName = (item: LibraryItem): Tool | undefined => toolOfApp(item.app_id)

/** Up to two characters for a circle: the same rule as the host's `initials_of`. */
export function initialsOf(name: string): string {
  const words = name.split(/\s+/).filter(Boolean)
  const chars = (w: string, n: number) => Array.from(w).slice(0, n).join('')
  if (words.length === 0) return ''
  if (words.length === 1) return chars(words[0], 2).toUpperCase()
  return (chars(words[0], 1) + chars(words[1], 1)).toUpperCase()
}

const titleCase = (s: string): string => s.replace(/(^|[\s._-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase())

/** With no agency (anonymous, the desktop, a local server) the studio is Napkin Studio itself, named
 *  once: the agency pill shows "Napkin Studio" alone, never a placeholder over it (owner, 2026-11-12). */
const STUDIO = 'Napkin Studio'

/** Who is signed in, from the host's `Person`: a first name for the greeting and the agency's name. */
export function whoIs(person: { id: string; name: string | null } | null): { first: string | null; agency: string } {
  if (!person) return { first: null, agency: STUDIO }
  const at = person.id.indexOf('@')
  if (at < 0) {
    // Anonymous or the desktop: the id is a tenant or "local", not someone's name.
    return { first: person.name ? person.name.split(/\s+/)[0] : null, agency: STUDIO }
  }
  const local = person.id.slice(0, at)
  const agency = person.id.slice(at + 1)
  return {
    first: person.name ? person.name.split(/\s+/)[0] : titleCase(local),
    agency: agency ? titleCase(agency) : STUDIO,
  }
}

/**
 * Where a document belongs in the trail: its client's tool, else just its client;
 * null when it has no client (then the bar keeps its plain way home).
 */
export function routeOfDocument(m: { client?: { id: string } | null; app?: { app_id: string } | null }): Route | null {
  const client = m.client?.id
  if (!client) return null
  const tool = toolOfApp(m.app?.app_id)
  return tool ? { level: 'tool', client, tool: tool.id } : { level: 'client', client }
}

/** "Adopt clients" button label: how many names are on offer. */
export function adoptLabel(n: number): string {
  return `Adopt clients (${n})`
}
