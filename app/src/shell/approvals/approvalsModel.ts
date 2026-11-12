// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Approvals page and the route strip, as plain functions (features/approval-route.clan): the words
// said about a route step and about who holds a job, the order the page lists jobs in, and the blank
// the route editor starts from. Nothing here fetches, and nothing scores a person: a step says who
// approved it and who it waits on, never how fast anyone is.

import type { Holder, JobEntry, RouteStep, RouteStepState } from '../../host/types'
import { dueWords } from '../home/model'

/** The eleven stages of a job (v2 section 3), in order: the ids the server's route takes. */
export const STAGE_CHOICES: readonly { id: string; label: string }[] = [
  { id: 'client-brief', label: 'Client brief' },
  { id: 'brief-check', label: 'Brief check' },
  { id: 'scope-estimate', label: 'Scope and estimate' },
  { id: 'ideas', label: 'Ideas' },
  { id: 'production', label: 'Production' },
  { id: 'decks', label: 'Decks and presentation' },
  { id: 'client-approval', label: 'Client approval' },
  { id: 'delivery', label: 'Delivery' },
  { id: 'timesheets', label: 'Timesheets' },
  { id: 'invoice-ready', label: 'Invoice-ready lines' },
  { id: 'case-study', label: 'Case study' },
]

export const stageLabel = (id: string): string => STAGE_CHOICES.find(s => s.id === id)?.label ?? id

/** `planner` as `Planner`, `creative_director` as `Creative director`, a free label as it was typed. */
export function roleWords(role: string | null | undefined): string {
  const r = (role ?? '').trim().replace(/[_-]+/g, ' ')
  return r ? r.charAt(0).toUpperCase() + r.slice(1) : ''
}

export const dayWords = (n: number): string => `${n} ${n === 1 ? 'day' : 'days'}`
export const lateWords = (n: number): string => `${dayWords(n)} late`

/** The date part of an RFC 3339 time, in words: `2026-11-12T09:00:00Z` as `12 Nov`. */
export const dateOf = (at: string | null): string => (at ? dueWords(at.slice(0, 10)) : '')

/** What one step says of itself, in a line. */
export function stepLine(s: RouteStepState): string {
  if (s.state === 'approved') {
    return `Approved by ${s.approved_by ?? s.approver}${s.approved_at ? ` on ${dateOf(s.approved_at)}` : ''}.`
  }
  if (s.state === 'waiting') {
    const late = s.days_late ?? 0
    return late > 0 ? `${lateWords(late)}. Was due ${dueWords(s.due)}.` : `Due ${dueWords(s.due)}.`
  }
  return `Due ${dueWords(s.due)}.`
}

/** The step's second line: how long the job has waited at it, for the one it waits at. */
export function heldLine(s: RouteStepState): string | null {
  return s.state === 'waiting' && s.days_held !== null ? `Held ${dayWords(s.days_held)}, since ${dateOf(s.held_since)}.` : null
}

/** Who the job waits on, in one sentence; empty when the route is done or there is none. */
export function holderLine(h: Holder | null): string {
  if (!h) return ''
  const who = h.party === 'client' ? `the client, ${h.person}` : h.person
  const role = roleWords(h.role)
  const late = h.days_late > 0 ? ` ${lateWords(h.days_late)}.` : ''
  return `Waiting on ${who}${role && h.party === 'agency' ? `, ${role.toLowerCase()}` : ''}, for ${dayWords(h.days)}. Due ${dueWords(h.due)}.${late}`
}

/** The jobs the page lists: a job that is waiting first, soonest due date first; then a done route; then a job with none. */
export function orderJobs(jobs: readonly JobEntry[]): JobEntry[] {
  const rank = (j: JobEntry) => (j.holder ? 0 : j.route.length > 0 ? 1 : 2)
  return jobs
    .map((j, i) => ({ j, i }))
    .sort((a, b) => {
      const d = rank(a.j) - rank(b.j)
      if (d !== 0) return d
      const x = a.j.holder?.due ?? ''
      const y = b.j.holder?.due ?? ''
      return x === y ? a.i - b.i : x < y ? -1 : 1
    })
    .map(({ j }) => j)
}

/** The editor's rows for a job's route: the steps as the server has them, or one blank step. */
export function draftOf(route: readonly RouteStepState[]): RouteStep[] {
  return route.length > 0
    ? route.map(s => ({ stage: s.stage, party: s.party, role: s.role, approver: s.approver, contact: s.contact, due: s.due, rounds: s.rounds }))
    : [blankStep()]
}

export function blankStep(stage = 'brief-check'): RouteStep {
  return { stage, party: 'agency', role: '', approver: '', contact: '', due: '', rounds: null }
}

/** What the server takes: empty strings left out, a client's extras only on a client step. */
export function cleanSteps(rows: readonly RouteStep[]): RouteStep[] {
  return rows.map(r => {
    const role = (r.role ?? '').trim()
    const client = r.party === 'client'
    const contact = (r.contact ?? '').trim()
    return {
      stage: r.stage,
      party: r.party,
      ...(role ? { role } : {}),
      approver: r.approver.trim(),
      ...(client && contact ? { contact } : {}),
      due: r.due,
      ...(client && r.rounds ? { rounds: Number(r.rounds) } : {}),
    }
  })
}

/** What the editor asks before it sends: the first thing missing, in a sentence, or null when it may go. */
export function missingIn(rows: readonly RouteStep[]): string | null {
  for (const [i, r] of rows.entries()) {
    const n = i + 1
    if (!r.approver.trim()) return `Step ${n} needs an approver.`
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.due)) return `Step ${n} needs a due date.`
  }
  return null
}

/** What a route save came to, as the page treats it: done, refused to this role (Missing access), a step the server
 *  explains (shown under the form), or lost on the way (Failed save, with Try again). */
export function outcomeOf(r: { ok: true } | { ok: false; status: number; message: string }): 'saved' | 'refused' | 'problem' | 'failed' {
  if (r.ok) return 'saved'
  if (r.status === 403) return 'refused'
  if (r.status === 400 && r.message) return 'problem'
  return 'failed'
}
