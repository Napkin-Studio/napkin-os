// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What a home is made of, as plain functions (features/roles-and-homes.clan).
// The server sends the doors, More tools and the O's circles from the roles in
// the session (napkin-web/src/roles.rs); this file only reads them: which tool
// a door opens, which doors have a tool at all, what Needs you holds, and the
// words said about it. Nothing here fetches.

import type { DoorEntry, HomeView, MapCircle } from '../../host/http'
import type { JobNeed, LibraryItem } from '../../host/types'
import { toolById } from '../landing/tools'
import { callsIn, clientName, stateWords } from '../nui/deskData'
import type { ToolId } from '../route'
import { greeting } from '../when'

/** The doors whose tool exists today, and the tool of the landing each opens. Every other door is a later phase's. */
const DOOR_TOOL: Readonly<Record<string, ToolId>> = { brief: 'brief', research: 'research', presentations: 'deck' }

export const doorTool = (id: string): ToolId | null => DOOR_TOOL[id] ?? null

/** Clients opens the client desk, the Agency dashboard and Approvals read the job index, all already here; the others need their tool's app installed. */
export function doorIsLive(id: string, apps: readonly string[]): boolean {
  if (id === 'clients' || id === 'agency-dashboard' || id === 'approvals') return true
  const tool = doorTool(id)
  const appId = tool ? toolById(tool)?.appId : null
  return !!appId && apps.includes(appId)
}

/** The five rows Needs you shows before Show all. */
export const NEEDS_FIRST = 5

export interface NeedRow {
  /** The index's stable id for a job's need; a document's own row has none. */
  id?: string
  path: string
  /** The work, and its client. */
  title: string
  sub: string
  /** What the person is asked for, in words. */
  state: string
  /** The next action, on its button. */
  action: string
  /** The job's deadline, when the row is a job's: what the list is ordered by. */
  due?: string | null
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2026-11-20` as `20 Nov`; anything else as it came. */
export function dueWords(due: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(due)
  return m && MONTHS[Number(m[2]) - 1] ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : due
}

/** A job's need as a row: the line, the job and its client, the deadline, and the one next action. An approval that is late says how late. */
export function jobNeedRow(n: JobNeed): NeedRow {
  const late = n.kind === 'approval' || n.kind === 'approval-chase' ? n.days_late ?? 0 : 0
  const state = late > 0 ? `${late} ${late === 1 ? 'day' : 'days'} late` : n.due ? `Due ${dueWords(n.due)}` : 'No deadline'
  return { id: n.id, path: n.path, title: n.text, sub: `${n.job}, ${n.client}`, state, action: n.action, due: n.due }
}

/** By deadline, soonest first, a row with none last; rows with the same deadline keep the order they came in. */
export function orderNeeds<T extends { due?: string | null }>(rows: readonly T[]): T[] {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const x = a.r.due ?? null
      const y = b.r.due ?? null
      if (x === y) return a.i - b.i
      if (x === null) return 1
      if (y === null) return -1
      return x < y ? -1 : 1
    })
    .map(({ r }) => r)
}

/** The first five lines, and how many are left behind Show all. */
export function firstNeeds<T>(rows: readonly T[], all: boolean): { shown: T[]; more: number } {
  const shown = all ? [...rows] : rows.slice(0, NEEDS_FIRST)
  return { shown, more: rows.length - shown.length }
}

/**
 * What is waiting on this person. A job's documents are the job's: its needs come from the server per
 * person (a planner and a creative director on one job see different lines). A document with no job
 * stays as it was: a call to make, a run that wants an answer, a failed run.
 */
export function needsRows(items: readonly LibraryItem[], jobNeeds: readonly JobNeed[] = []): NeedRow[] {
  const loose = items
    .filter(i => !i.job)
    .filter(i => callsIn(i) > 0 || i.run?.state === 'failed')
    .map(i => {
      const st = stateWords(i)
      const failed = i.run?.state === 'failed'
      const waiting = i.run?.state === 'waiting'
      return {
        path: i.path,
        title: i.title || 'Untitled',
        sub: i.client ? clientName(i.client) : 'No client',
        state: st.text,
        action: failed ? 'See what failed' : waiting ? 'Answer' : 'Make the calls',
      }
    })
  return orderNeeds<NeedRow>([...jobNeeds.map(jobNeedRow), ...loose])
}

/** The line under the greeting. */
export function needsLine(n: number): string {
  if (n === 0) return 'Nothing needs you now.'
  return n === 1 ? '1 thing needs you.' : `${n} things need you.`
}

export function hello(first: string | null, now = new Date()): string {
  const g = greeting(now).replace(/\.$/, '')
  return first ? `${g}, ${first}` : g
}

/** The home's label above its name: `PLANNING · HOME`. */
export const homeEyebrow = (view: HomeView): string => `${view.title || 'Your'} · home`

/** Where a circle on the O opens: the home of a role, or the client desk. */
export const circleHome = (c: MapCircle): { as: string } | { desk: true } => (c.opens ? { as: c.opens } : { desk: true })

/** The label on a door in a screen reader: its words, and where it stands. */
export const doorLabel = (d: DoorEntry, live: boolean): string => `${d.name}${live ? '' : ', comes in a later phase'}`

/** Where circle `i` of `n` sits, in percent of the map: the first at the top, the rest clockwise. */
export function placeOf(i: number, n: number, radius = 37): { left: string; top: string } {
  const a = (2 * Math.PI * i) / Math.max(n, 1)
  const pct = (n: number) => `${Number(n.toFixed(2))}%`
  return { left: pct(50 + radius * Math.sin(a)), top: pct(50 - radius * Math.cos(a)) }
}

