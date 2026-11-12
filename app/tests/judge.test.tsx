// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Judge in the shell (features/judge.clan): the score card (failed tests first, each with its evidence, the plain words that the
// 24 is advice until Judge is trusted), the Judge scores door (pieces, never people), and the dashboard's Judge tile (it reads as it did
// with no scores). The host does the arithmetic; these tests hold the words and what is drawn from what the host sends.

import './domFakes.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { DashboardView, JudgeCardView, JudgeTest, JobEntry, PieceScore } from '../src/host/types.ts'
import { tiles } from '../src/shell/home/dashboardModel.ts'
import { JudgeBand } from '../src/shell/judge/JudgeBand.tsx'
import { JudgeScoresBody } from '../src/shell/judge/JudgeScoresPage.tsx'
import { countsOf, failedFirst, headline, priceLine, refusalLine, rowsOf, standing, staleLine } from '../src/shell/judge/judgeModel.ts'
import type { Judge } from '../src/shell/judge/useJudge.ts'

const test_ = (id: string, value: 'pass' | 'fail', dim: JudgeTest['dim'] = 'idea'): JudgeTest => ({
  id, dim, method: 'llm', value, evidence: `The line for ${id}.`, reason_code: value === 'pass' ? 'pass' : `judge.fail.${id}`, question: `Question of ${id}?`,
})
const SETUP: JudgeCardView['setup'] = { backend: 'fixture', configured: true, price_eur: null, trust: 'none', not_trusted: 'Judge is not yet trusted here. Advice only.', calibration: 'The 24 is advice until Judge has earned trust: 60 decided pieces.', rubric_version: '1' }
const SCORE = (over: Partial<NonNullable<JudgeCardView['score']>> = {}): NonNullable<JudgeCardView['score']> => ({
  id: 'd_1', at: '2026-11-12T10:00:00Z', version: 'abc', current: true, out_of_date: false, total: 22, sub: { idea: 7, craft: 7, effect: 8 },
  tests: [test_('idea.a', 'pass'), test_('idea.b', 'fail'), test_('craft.c', 'fail', 'craft'), test_('effect.d', 'pass', 'effect')],
  advised_route: 'team', route: 'team', brave: false, route_line: 'Advised: back to the team with the notes. Judge is not yet trusted here. Advice only.', trust: 'none',
  judge_version: 'rubric-1/fixture/none/none', overruled: null, decided: null, ...over,
})
const CARD = (over: Partial<JudgeCardView> = {}): JudgeCardView => ({
  ok: true, kind: 'script', piece: 'script', pieces: ['script'], can_score: true, why_not: null, setup: SETUP, score: SCORE(), older: [], can_overrule: false, creative_director_named: true, ...over,
})
const JUDGE = (card: JudgeCardView | null, over: Partial<Judge> = {}): Judge => ({ card, line: null, busy: false, item: null, state: null, send: async () => {}, overrule: async () => true, ...over })
const band = (card: JudgeCardView | null, over: Partial<Judge> = {}) => renderToStaticMarkup(createElement(JudgeBand, { judge: JUDGE(card, over) }))

test('the score card says the number and why: the failed tests come first, each with its evidence', () => {
  const html = band(CARD())
  assert.match(html, /data-testid="score-card"/)
  assert.match(html, /<b>22<\/b>/)
  assert.match(html, /Idea<\/span><b>7<\/b>/)
  assert.deepEqual(failedFirst(SCORE().tests).map(t => t.value), ['fail', 'fail', 'pass', 'pass'])
  assert.match(headline(SCORE()), /^22 of 30\. Idea 7, craft 7, effect 8\. 2 tests not passed\.$/)
  assert.equal(headline(SCORE({ tests: [test_('a', 'pass')] })).endsWith('Every test passed.'), true)
  // closed by default; open, the failed tests are listed before the passed ones and each names its evidence
  assert.doesNotMatch(html, /data-testid="judge-test"/)
})

test('until Judge is trusted the card says so in plain words, in the header route and in the calibration line', () => {
  const html = band(CARD())
  assert.match(html, /Judge is not yet trusted here\. Advice only\./)
  assert.match(html, /data-testid="judge-calibration"/)
  assert.match(html, /60 decided pieces/)
  // earned: no advice line and no calibration line
  const earned = band(CARD({ score: SCORE({ trust: 'earned', route_line: 'Back to the team with the notes.' }) }))
  assert.doesNotMatch(earned, /Advice only/)
  assert.doesNotMatch(earned, /judge-calibration/)
})

test('a score for older work or an older brief says so and offers Score again', () => {
  assert.equal(staleLine(SCORE()), null)
  assert.match(staleLine(SCORE({ out_of_date: true }))!, /out of date/)
  assert.match(staleLine(SCORE({ current: false }))!, /earlier version/)
  const html = band(CARD({ score: SCORE({ out_of_date: true }) }))
  assert.match(html, /data-testid="judge-stale"/)
  assert.match(html, /data-testid="judge-again" data-primary=""/)
  assert.doesNotMatch(band(CARD()), /judge-again" data-primary/)
})

test('only the creative director is offered the overrule, and an overruled score says whose word stands', () => {
  assert.doesNotMatch(band(CARD()), /judge-overrule"/)
  assert.match(band(CARD({ can_overrule: true })), /data-testid="judge-overrule"/)
  const over = band(CARD({ can_overrule: true, score: SCORE({ overruled: { route: 'cd', at: 't', reason: 'The thought is the one we want.' } }) }))
  assert.match(over, /The creative director overruled Judge: The thought is the one we want\./)
  assert.doesNotMatch(over, /data-testid="judge-overrule"/)
})

test('with no score it says what a run costs before it starts, or that Judge is not set up, or why it cannot score yet', () => {
  assert.match(band(CARD({ score: null })), /Judge answers from fixture scores here\. Nothing is charged/)
  assert.match(priceLine({ ...SETUP, backend: 'llm-judge', price_eur: 0.04 }), /About 4 cents|costs about 4 cents/)
  assert.match(priceLine({ ...SETUP, backend: 'llm-judge', price_eur: null }), /price of a run is not set/)
  assert.match(priceLine({ ...SETUP, backend: null, configured: false }), /not set up here/)
  assert.match(band(CARD({ score: null, why_not: 'Choose a route first. Judge scores the chosen route.' })), /Choose a route first/)
  assert.equal(band(null), '')
  // a refusal is said in the host's words
  assert.equal(refusalLine('ai_off: AI is switched off for this client, so Judge cannot read its work.'), 'AI is switched off for this client, so Judge cannot read its work.')
  assert.match(refusalLine('judge_malformed: nope'), /nope/)
  assert.match(refusalLine('something else'), /Nothing was changed/)
  assert.match(band(CARD({ score: null }), { line: 'Judge is not set up here.' }), /data-testid="judge-refusal"[^>]*>Judge is not set up here\./)
})

const piece = (over: Partial<PieceScore> = {}): PieceScore => ({
  doc: 'documents/s.clan', title: 'J001 radio script', piece: 'script', kind: 'script', score: 'd_1', at: '2026-11-12T10:00:00Z', total: 22, idea: 7, craft: 7, effect: 8,
  advised_route: 'team', route: 'team', brave: false, trust: 'none', overruled: false, decided: null, current: true, ...over,
})
const job = (number: string, scores: PieceScore[]) => ({ number, title: number, client: { id: 'c1', name: 'Client A' }, scores }) as unknown as JobEntry

test('the Judge scores door lists pieces by job and counts pieces, never people', () => {
  const jobs = [job('J001', [piece(), piece({ score: 'd_2', total: 28, idea: 10, advised_route: 'cd', route: 'cd', at: '2026-11-12T11:00:00Z' })]), job('J002', [piece({ score: 'd_3', total: 22, idea: 9, brave: true, advised_route: 'cd_brave', route: 'cd_brave', overruled: true })])]
  const html = renderToStaticMarkup(createElement(JudgeScoresBody, { jobs, ready: true, go: () => {} }))
  assert.equal((html.match(/data-testid="judge-piece"/g) ?? []).length, 3)
  assert.match(html, /data-testid="js-calibration"/)
  const c = countsOf(rowsOf(jobs))
  assert.deepEqual(c, { scored: 3, average: 24, under24: 2, at27: 1, brave: 1, overruled: 1 })
  // nothing groups, totals or orders by who made a piece, and nothing here names a person
  assert.doesNotMatch(html, /per person|by person|per writer|leaderboard|\bwriter\b|\bauthor\b|maeve|dara/i)
  assert.equal(standing(piece({ overruled: true, route: 'team' })), 'Sent back to the team by the creative director')
  assert.match(standing(piece()), /Back to the team with the notes\. Advice only/)
  assert.match(standing(piece({ brave: true, route: 'cd_brave' })), /Brave, fix the craft\. Advice only/)
  assert.equal(standing(piece({ trust: 'earned', route: 'cd' })), 'To the creative director')
})

test('the Judge scores door with nothing scored is the Empty state it always was', () => {
  const html = renderToStaticMarkup(createElement(JudgeScoresBody, { jobs: [job('J001', [])], ready: true, go: () => {} }))
  assert.match(html, /data-state="empty"/)
  assert.match(html, /Each piece of work and its score out of 30 goes here\./)
  assert.match(html, />Score a piece</)
})

const DASH = (scores: DashboardView['scores']): DashboardView => ({ live_jobs: 1, by_stage: [], at_risk: [], hours: { budget: 0, confirmed: null, jobs: [] }, waiting_on_client: [], scores, results: null })

test('the dashboard tile keeps its wording, reads as before with no scores, and shows pieces and jobs with scores', () => {
  const none = tiles(DASH(null)).find(t => t.id === 'scores')!
  assert.equal(none.label, 'Work scoring 27 or more')
  assert.deepEqual(none.numbers, [])
  assert.match(none.line, /No scores yet/)
  const some = tiles(DASH({ scored: 3, average: 24, under_24: 2, at_27: 1, brave: 1, overruled: 1, awaiting_set: 57, jobs: [{ number: 'J001', client: 'Client A', client_id: 'c1', scored: 3, average: 24, under_24: 2, at_27: 1, brave: 1, overruled: 1 }] })).find(t => t.id === 'scores')!
  assert.equal(some.label, 'Work scoring 27 or more')
  assert.deepEqual(some.numbers.map(n => n.text), ['1 of 3 pieces', '2 under 24'])
  assert.match(some.line, /Average 24 out of 30\. 1 Brave, 1 overruled\. 57 more decided pieces before Judge's 24 is more than advice\./)
  assert.equal(some.jobs[0].job.number, 'J001')
  assert.doesNotMatch(JSON.stringify(some), /person|author|writer/i)
})
