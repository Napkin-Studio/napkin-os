// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// "Pick up where you left off" under Me (features/align-needs-lock-people.clan): the documents that hold an item for
// this person, soonest due first, five and then Show all; with none, the line names the next deadline. Pure: the
// server's per-document facts (`GET /needs` documents) and the library's items in, rows out. It counts items a
// document holds for a person and scores no one.

import type { DocumentNeeds, JobNeed, LibraryItem, NextDeadline } from '../../host/types'
import { dueWords } from '../home/model'
import { clientName, stateWords } from './deskData'

/** Rows shown before Show all. */
export const ME_FIRST = 5

export interface MeRow {
  key: string
  path: string
  title: string
  /** "Client A · 2 for you". */
  sub: string
  /** "Due 13 Nov", or the count when no date is set. */
  state: string
  due: string | null
  /** Items on this document that wait on this person. */
  mine: number
  /** The person's own timesheet reminder: no document, it opens the timesheet. */
  timesheet?: boolean
}

const plural = (n: number) => `${n} for you`

/** The documents holding an item for the person, by the earliest date of those items (none last), then by title. */
export function meRows(items: readonly LibraryItem[], documents: readonly DocumentNeeds[], timesheet: JobNeed | null = null): MeRow[] {
  const byPath = new Map(items.map(i => [i.path, i] as const))
  const rows: MeRow[] = []
  for (const d of documents) {
    if (d.mine <= 0) continue
    const item = byPath.get(d.path)
    if (!item) continue
    const client = item.client ? clientName(item.client) : 'No client'
    rows.push({
      key: d.path, path: d.path, title: item.title || 'Untitled',
      sub: `${client} · ${plural(d.mine)}`,
      state: d.earliest_due ? `Due ${dueWords(d.earliest_due)}` : stateWords(item).text,
      due: d.earliest_due, mine: d.mine,
    })
  }
  rows.sort((a, b) => (a.due === b.due ? a.title.localeCompare(b.title) : a.due === null ? 1 : b.due === null ? -1 : a.due < b.due ? -1 : 1))
  if (timesheet) rows.unshift({ key: 'timesheet', path: '', title: 'Confirm today\'s timesheet', sub: 'Your timesheet', state: 'Today', due: timesheet.due, mine: 1, timesheet: true })
  return rows
}

/** What an empty Me list says: the next deadline on the person's own jobs when there is one, else that none is set. */
export function emptyLine(next: NextDeadline | null | undefined): string {
  if (next === undefined) return 'Nothing needs you now.'
  if (next === null) return 'Nothing needs you now. No deadline is set on your jobs.'
  return `Nothing needs you now. Next deadline: ${next.job}, ${next.client}, ${dueWords(next.due)}.`
}

/** The first five rows, and how many wait behind Show all. */
export function firstRows<T>(rows: readonly T[], all: boolean): { shown: T[]; more: number } {
  const shown = all ? [...rows] : rows.slice(0, ME_FIRST)
  return { shown, more: rows.length - shown.length }
}
