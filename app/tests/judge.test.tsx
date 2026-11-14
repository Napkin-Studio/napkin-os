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
import { JudgeScoresBody } from '../src/shell/judge/JudgeScoresPage.tsx'
import { countsOf, failedFirst, headline, refusalLine, rowsOf, standing, staleLine } from '../src/shell/judge/judgeModel.ts'

const test_ = (id: string, value: 'pass' | 'fail', dim: JudgeTest['dim'] = 'idea'): JudgeTest => ({
  id, dim, method: 'llm', value, evidence: `The line for ${id}.`, reason_code: value === 'pass' ? 'pass' : `judge.fail.${id}`, question: `Question of ${id}?`,
})
const SCORE = (over: Partial<NonNullable<JudgeCardView['score']>> = {}): NonNullable<JudgeCardView['score']> => ({
  id: 'd_1', at: '2026-11-12T10:00:00Z', version: 'abc', current: true, out_of_date: false, total: 22, sub: { idea: 7, craft: 7, effect: 8 },
  tests: [test_('idea.a', 'pass'), test_('idea.b', 'fail'), test_('craft.c', 'fail', 'craft'), test_('effect.d', 'pass', 'effect')],
  advised_route: 'team', route: 'team', brave: false, route_line: 'Advised: back to the team with the notes. Judge is not yet trusted here. Advice only.', trust: 'none',
  judge_version: 'rubric-1/fixture/none/none', overruled: null, decided: null, ...over,
})

// The score card itself is the Booth's Judge fold (templates/shared/booth-folds.html; tests/boothFolds.test.ts reads it
// against the host's shapes). What stays here is the shell's model: the words the host's answers are said in.
test('the failed tests come first, and the headline says the number and why', () => {
  assert.deepEqual(failedFirst(SCORE().tests).map(t => t.value), ['fail', 'fail', 'pass', 'pass'])
  assert.match(headline(SCORE()), /^22 of 30\. Idea 7, craft 7, effect 8\. 2 tests not passed\.$/)
  assert.equal(headline(SCORE({ tests: [test_('a', 'pass')] })).endsWith('Every test passed.'), true)
})

test('a score for older work or an older brief is stale', () => {
  assert.equal(staleLine(SCORE()), null)
  assert.match(staleLine(SCORE({ out_of_date: true }))!, /out of date/)
  assert.match(staleLine(SCORE({ current: false }))!, /earlier version/)
})

test('a refusal is said in the host\'s words (the fold\'s own words for no score are tested in boothStates)', () => {
  // a refusal is said in the host's words
  assert.equal(refusalLine('ai_off: AI is switched off for this client, so Judge cannot read its work.'), 'AI is switched off for this client, so Judge cannot read its work.')
  assert.match(refusalLine('judge_malformed: nope'), /nope/)
  assert.match(refusalLine('something else'), /Nothing was changed/)
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
