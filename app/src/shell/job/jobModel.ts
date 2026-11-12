// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The job page and the Live jobs list, as plain functions (features/job-page.clan): the words said about
// a job, the order Live jobs lists in, what a form changed, and what a save came to. Nothing here fetches.
// It draws what the server sent for this person's role and nothing else: a field the role is not sent
// (the budget in hours) is simply not there, and nothing here names a person's speed or score.

import type { JobDocument, JobEntry, JobNeed, JobPatch } from '../../host/types'
import { toolOfApp } from '../landing/tools'
import { STAGE_CHOICES, dayWords, holderLine } from '../approvals/approvalsModel'
import { dueWords } from '../home/model'

/** `Step 3 of 11. Brief check.` */
export const stageLine = (j: Pick<JobEntry, 'stage'>): string => `Step ${j.stage.step} of ${STAGE_CHOICES.length}. ${j.stage.label}.`

/** The deadline, in words; a job past it says so. */
export function dueLine(j: Pick<JobEntry, 'due' | 'at_risk'>): string {
  if (!j.due) return 'No deadline'
  return j.at_risk ? `Past its deadline, ${dueWords(j.due)}` : `Due ${dueWords(j.due)}`
}

/** Who the job waits on, in one sentence: the route's holder when there is one, else the stage's own answer. */
export function waitingLine(j: Pick<JobEntry, 'holder' | 'waiting_on' | 'days_waiting_on_client' | 'route'>): string {
  if (j.holder) return holderLine(j.holder)
  if (j.route.length > 0) return 'Every step of the route is approved.'
  if (j.waiting_on === 'client') {
    const d = j.days_waiting_on_client
    return d === null ? 'Waiting on the client.' : `Waiting on the client for ${dayWords(d)}.`
  }
  return 'Waiting on the agency.'
}

/** The hours in words, only for a role that was sent them. */
export const budgetLine = (j: Pick<JobEntry, 'budget_hours'>): string | null =>
  j.budget_hours === undefined || j.budget_hours === null ? null : `${j.budget_hours} ${j.budget_hours === 1 ? 'hour' : 'hours'}`

/** Live jobs: soonest deadline first, a job with none last; jobs on one date keep the order they were opened in. */
export function orderLive<T extends { due: string | null }>(jobs: readonly T[]): T[] {
  return jobs
    .map((j, i) => ({ j, i }))
    .sort((a, b) => {
      if (a.j.due === b.j.due) return a.i - b.i
      if (a.j.due === null) return 1
      if (b.j.due === null) return -1
      return a.j.due < b.j.due ? -1 : 1
    })
    .map(({ j }) => j)
}

/** What a document row says of itself under its title. */
export function docLine(d: JobDocument): string {
  const tool = toolOfApp(d.app_id)?.name ?? 'Document'
  const state = d.changed_since_lock ? 'Changed since it was signed' : d.locked ? 'Signed and locked' : d.needs_you > 0 ? `${d.needs_you} to check` : 'Open'
  return `${tool} · ${state}`
}

/** The brief that moved on after it was signed: the two versions, for the Changed brief state. */
export function changedBriefOf(j: Pick<JobEntry, 'documents'>): { doc: JobDocument; from: string; to: string } | null {
  const doc = j.documents.find(d => d.changed_since_lock && d.version !== null)
  return doc && doc.version !== null ? { doc, from: `v${doc.version}`, to: `v${doc.version + 1}` } : null
}

/** The person's next action on this job: the first thing the index asks of them on it. */
export const nextNeed = (needs: readonly JobNeed[], number: string): JobNeed | null => needs.find(n => n.job === number && n.path) ?? null

export interface JobForm { title: string; owner: string; due: string; budget: string }

export const formOf = (j: JobEntry): JobForm => ({ title: j.title, owner: j.owner, due: j.due ?? '', budget: j.budget_hours == null ? '' : String(j.budget_hours) })

/** Only what the person changed; null when nothing is. The budget is left out for a role that may not set it. */
export function patchOf(j: JobEntry, f: JobForm, mayBudget: boolean): JobPatch | null {
  const out: JobPatch = {}
  if (f.title.trim() !== j.title) out.title = f.title.trim()
  if (f.owner.trim() !== j.owner) out.owner = f.owner.trim()
  if (f.due !== (j.due ?? '')) out.due = f.due === '' ? null : f.due
  if (mayBudget && f.budget.trim() !== (j.budget_hours == null ? '' : String(j.budget_hours)) && f.budget.trim() !== '') out.budget_hours = Number(f.budget)
  return Object.keys(out).length > 0 ? out : null
}

/** The first thing wrong with the form, in a sentence, or null when it may go. */
export function formProblem(f: JobForm, mayBudget: boolean): string | null {
  if (!f.title.trim()) return 'A job needs a title.'
  if (!f.owner.trim()) return 'A job needs an owner.'
  if (f.due !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(f.due)) return 'The deadline is a date.'
  if (mayBudget && f.budget.trim() !== '' && !(Number(f.budget) >= 0)) return 'The budget is a number of hours.'
  return null
}

/** What a job write came to: done, refused to this role, a value the server explains, or lost on the way. */
export function saveOutcome(r: { ok: true } | { ok: false; status: number; message: string }): 'saved' | 'refused' | 'problem' | 'failed' {
  if (r.ok) return 'saved'
  if (r.status === 403) return 'refused'
  if (r.status === 400 || r.status === 404 || r.status === 409) return 'problem'
  return 'failed'
}
