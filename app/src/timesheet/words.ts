// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The words of the timesheet day (docs/design/timesheet-day.html). Pure, so they are table-tested.

import type { Gap, Line } from './api'

/** `2 h 10`, `0 h 45`: hours, then minutes padded to two. */
export function hm(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The line's own provenance: what it was built from, in the person's terms. */
export function builtFrom(l: Pick<Line, 'source' | 'session_ids' | 'edits'>): string {
  const sessions = plural(l.session_ids.length, 'work session', 'work sessions')
  if (l.source === 'hand') return 'You added this by hand.'
  if (l.source === 'guess') return `You accepted this guess. Built from ${sessions}.`
  return l.edits > 0
    ? `Built from ${sessions} and ${plural(l.edits, 'edit', 'edits')} you made.`
    : `Built from ${sessions}.`
}

/** `Tuesday 11 November` for a date `YYYY-MM-DD`. */
export function dayTitle(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const at = new Date(Date.UTC(y, m - 1, d))
  const part = (o: Intl.DateTimeFormatOptions) => at.toLocaleDateString('en-IE', { ...o, timeZone: 'UTC' })
  return `${part({ weekday: 'long' })} ${d} ${part({ month: 'long' })}`
}

/** Today's date as the person's own clock has it, `YYYY-MM-DD`. */
export function localDate(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit', hour12: false })

/** The gap's line: when, and the guess with its reason when there is one. */
export function gapWords(g: Gap, name: (job: string, label: string) => string): { head: string; guess: string | null } {
  return {
    head: `Not accounted for, ${clock(g.from)} to ${clock(g.to)}.`,
    guess: g.guess ? `Best guess: ${name(g.guess.job, g.guess.label)}. You had it open before and after.` : null,
  }
}

/** The confirm button's words. */
export function confirmWords(minutes: number): string { return `Confirm today, ${hm(minutes)}` }
