// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The words of Judge (features/judge.clan), as plain functions over what the host sends, so a test can hold them.
// Judge advises and the creative director decides: until a Judge version is trusted the 24 is advice, and every
// line here that speaks of a route says so. Napkin never scores people: nothing here names a person's number;
// a score belongs to a piece of work.

import type { JudgeCardView, JudgeTest, PieceScore } from '../../host/types'

/** The id of the bar's button and of the strip's retry. */
export const SEND_TO_JUDGE = 'send-to-judge'

/** The apps whose work Judge scores: a tool sends work by declaring the `judge_work` task, and these three do. */
export const JUDGE_APPS: readonly string[] = ['ie.napkin.script-editor', 'ie.napkin.idea-room', 'ie.napkin.visual-brief']

export const NOT_TRUSTED = 'Judge is not yet trusted here. Advice only.'
export const BRAVE = 'Brave, fix the craft'

type Route = 'team' | 'cd_brave' | 'cd'

export const ROUTE_NAME: Record<Route, string> = {
  team: 'Back to the team with the notes',
  cd_brave: 'To the creative director: Brave, fix the craft',
  cd: 'To the creative director',
}

export const DIM_NAME = { idea: 'Idea', craft: 'Craft', effect: 'Effect' } as const

/** What a run costs, said before it starts. */
export function priceLine(setup: JudgeCardView['setup'] | undefined): string {
  if (!setup) return ''
  if (!setup.configured) return 'Judge is not set up here, so nothing can be scored yet.'
  if (setup.backend === 'fixture') return 'Judge answers from fixture scores here. Nothing is charged and no model is called.'
  if (setup.price_eur === null) return 'Judge reads this version once. The price of a run is not set yet.'
  const euro = setup.price_eur < 1 ? `${Math.round(setup.price_eur * 100)} cent${Math.round(setup.price_eur * 100) === 1 ? '' : 's'}` : `${setup.price_eur.toFixed(2)} euro`
  return `Judge reads this version once. A run costs about ${euro}, and the spend cap is checked before it starts.`
}

/** The failed tests first, then the passed, each in the order the rubric gives. */
export function failedFirst(tests: readonly JudgeTest[]): JudgeTest[] {
  return [...tests].sort((a, b) => Number(a.value === 'pass') - Number(b.value === 'pass'))
}

/** What the person reads at the top of the card: why it is this number. */
export function headline(card: NonNullable<JudgeCardView['score']>): string {
  const failed = card.tests.filter(t => t.value === 'fail').length
  const word = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  return `${card.total} of 30. Idea ${card.sub.idea}, craft ${card.sub.craft}, effect ${card.sub.effect}. ${failed === 0 ? 'Every test passed.' : `${word(failed, 'test', 'tests')} not passed.`}`
}

/** Out of date, or for an earlier version: said plainly, with the way to score again. */
export function staleLine(card: NonNullable<JudgeCardView['score']>): string | null {
  if (card.out_of_date) return 'This score is out of date: the brief has a new version since it was scored. Score again.'
  if (!card.current) return 'This score is for an earlier version of the work. Score again to see where this version stands.'
  return null
}

/** The refusal in the host's words: the part after its code. */
export function refusalLine(message: string): string {
  const m = /^(ai_off|not_eu|not_configured|spend_refused|judge_failed|judge_malformed)\s*:\s*(.*)$/s.exec(message.trim())
  return m ? m[2].trim() : 'Judge could not score this just now. Nothing was changed.'
}

/** The run-failed state's class for a host refusal. */
export function failureOf(message: string): 'provider' | 'refused' | 'timeout' | 'other' {
  if (/^(ai_off|not_eu|not_configured|spend_refused)/.test(message.trim())) return 'refused'
  return 'provider'
}

/** What a door lists: the pieces by job, newest score first, with the counts of pieces and never of people. */
export interface PieceRow extends PieceScore { job: string; client: string }

export function rowsOf(jobs: readonly { number: string; client: { name: string }; scores?: PieceScore[] }[]): PieceRow[] {
  return jobs.flatMap(j => (j.scores ?? []).map(s => ({ ...s, job: j.number, client: j.client.name })))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
}

export function countsOf(rows: readonly PieceRow[]) {
  const n = rows.length
  const sum = rows.reduce((t, r) => t + r.total, 0)
  return {
    scored: n,
    average: n === 0 ? 0 : Math.round((sum / n) * 10) / 10,
    under24: rows.filter(r => r.total < 24).length,
    at27: rows.filter(r => r.total >= 27).length,
    brave: rows.filter(r => r.brave).length,
    overruled: rows.filter(r => r.overruled).length,
  }
}

/** Where a piece stands, in a few words. */
export function standing(r: Pick<PieceScore, 'route' | 'brave' | 'overruled' | 'decided' | 'trust' | 'current'>): string {
  if (r.overruled) return r.route === 'team' ? 'Sent back to the team by the creative director' : 'Kept by the creative director'
  if (r.decided) return r.decided === 'kept' ? 'Decided: kept' : 'Decided: returned'
  const base = r.brave ? BRAVE : ROUTE_NAME[r.route]
  return r.trust === 'earned' ? base : `${base}. Advice only`
}

export function kindName(kind: string): string {
  return ({ script: 'Script', idea_route: 'Idea route', visual_brief: 'Visual brief' } as Record<string, string>)[kind] ?? 'Work'
}
