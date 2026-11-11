// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The timesheet in the shell (features/timesheet-sessions.clan): what the beacon sends over a
// simulated hour, that nothing is sent without a yes, the words of the day, a gap with its guess,
// the consent card, and no score of any person. De-identified: Client A, an Irish whiskey.

import './domFakes.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { Beacon, BLUR_GRACE_MS, capturing, HEARTBEAT_MS, type WorkEvent } from '../src/timesheet/beacon.ts'
import { Ask } from '../src/timesheet/Ask.tsx'
import { builtFrom, confirmWords, dayTitle, gapWords, hm, localDate } from '../src/timesheet/words.ts'
import { formatRoute, parseRoute } from '../src/shell/route.ts'

/** A beacon on a clock the test moves, and the events it sent. */
function rig() {
  let t = 1_000_000
  const sent: { e: WorkEvent; doc: string; at: number }[] = []
  const b = new Beacon((e, doc) => sent.push({ e, doc, at: t }), () => t)
  const advance = (ms: number, step = 2000) => { for (let i = 0; i < ms; i += step) { t += step; b.tick() } }
  return { b, sent, advance, now: () => t }
}

test('an hour in one document sends at most one event per 30 seconds, plus its open and close', () => {
  const { b, sent, advance } = rig()
  b.open('doc-brief')
  advance(3_600_000)
  b.close()
  const beats = sent.filter(s => s.e === 'focus')
  assert.equal(sent[0].e, 'open')
  assert.equal(sent[sent.length - 1].e, 'close')
  assert.ok(sent.length <= 3_600_000 / HEARTBEAT_MS + 2, `${sent.length} events`)
  for (let i = 1; i < beats.length; i++) assert.ok(beats[i].at - beats[i - 1].at >= HEARTBEAT_MS)
})

test('flicking between windows inside the grace sends nothing', () => {
  const { b, sent, advance } = rig()
  b.open('doc-brief')
  for (let i = 0; i < 100; i++) { b.setFocused(false); advance(2000); b.setFocused(true) }
  assert.deepEqual(sent.filter(s => s.e === 'blur'), [])
  assert.ok(sent.length <= 1 + 200_000 / HEARTBEAT_MS + 1)
})

test('a window lost for longer than the grace says blur once, and focus again when it returns', () => {
  const { b, sent, advance } = rig()
  b.open('doc-brief')
  b.setFocused(false)
  advance(BLUR_GRACE_MS + 4000)
  advance(120_000) // the window stays away: no heartbeat while it is
  b.setFocused(true)
  assert.deepEqual(sent.map(s => s.e), ['open', 'blur', 'focus'])
})

test('only the document in focus speaks: opening a second one closes the first', () => {
  const { b, sent } = rig()
  b.open('doc-brief')
  b.open('doc-research')
  assert.deepEqual(sent.map(s => `${s.e} ${s.doc}`), ['open doc-brief', 'close doc-brief', 'open doc-research'])
  b.close()
  assert.equal(sent[sent.length - 1].e, 'close')
})

test('leaving a document straight away still says close, so a short stay is a session', () => {
  const { b, sent, advance } = rig()
  b.open('doc-brief')
  advance(3000)
  b.close()
  assert.deepEqual(sent.map(s => s.e), ['open', 'close'])
})

test('nothing is sent before a yes: not signed in, not asked, no, or not in a document', () => {
  assert.equal(capturing(true, 'yes', 'doc-brief'), true)
  for (const c of ['not_asked', 'no', null] as const) assert.equal(capturing(true, c, 'doc-brief'), false, String(c))
  assert.equal(capturing(false, 'yes', 'doc-brief'), false)
  assert.equal(capturing(true, 'yes', null), false)
})

test('the day reads in hours and minutes, and each line says what it was built from', () => {
  assert.equal(hm(130), '2 h 10')
  assert.equal(hm(45), '0 h 45')
  assert.equal(hm(0), '0 h 00')
  assert.equal(confirmWords(340), 'Confirm today, 5 h 40')
  assert.equal(builtFrom({ source: 'sessions', session_ids: ['a', 'b', 'c'], edits: 6 }), 'Built from 3 work sessions and 6 edits you made.')
  assert.equal(builtFrom({ source: 'sessions', session_ids: ['a'], edits: 0 }), 'Built from 1 work session.')
  assert.equal(builtFrom({ source: 'hand', session_ids: [], edits: 0 }), 'You added this by hand.')
  assert.equal(dayTitle('2025-11-11'), 'Tuesday 11 November')
  assert.equal(localDate(new Date(2025, 10, 11, 23, 59)), '2025-11-11')
})

test('a gap says when it was and guesses the job only when the same job was open either side', () => {
  const at = (h: number, m: number) => new Date(2025, 10, 11, h, m).getTime()
  const name = (j: string, l: string) => `${j} Client A · ${l}`
  const guessed = gapWords({ from: at(14, 0), to: at(15, 15), minutes: 75, guess: { job: 'J001', label: 'Brief' }, session_ids: ['a', 'b'] }, name)
  assert.equal(guessed.head, 'Not accounted for, 14:00 to 15:15.')
  assert.equal(guessed.guess, 'Best guess: J001 Client A · Brief. You had it open before and after.')
  assert.equal(gapWords({ from: at(14, 0), to: at(15, 15), minutes: 75, guess: null, session_ids: [] }, name).guess, null)
})

test('the consent card asks once in plain words, offers yes and no equally, and promises no tracking', () => {
  const card = renderToStaticMarkup(createElement(Ask, { variant: 'card', onTimesheet: () => {} }))
  assert.match(card, /Should Napkin OS draft your timesheet\?/)
  assert.match(card, /Yes, draft my day/)
  assert.match(card, /No, I will fill it in/)
  const page = renderToStaticMarkup(createElement(Ask, { variant: 'page' }))
  for (const line of ['Nothing is captured until you say yes.', 'No keystrokes, no screen capture, no hidden tracking.', 'Your manager never sees your corrections.', 'If you say no, you fill in your day by hand. Nothing else changes.']) {
    assert.ok(page.includes(line), line)
  }
})

test('no word of the timesheet screens scores, ranks or warns a person, and none uses an em dash', () => {
  const text = [
    renderToStaticMarkup(createElement(Ask, { variant: 'page' })),
    hm(5), confirmWords(5), builtFrom({ source: 'guess', session_ids: ['a'], edits: 0 }),
  ].join(' ').toLowerCase()
  for (const w of ['score', 'rank', 'rating', 'productiv', 'utilis', 'penal', 'behind', 'warning', '—']) assert.ok(!text.includes(w), w)
})

test('the timesheet is its own place in the shell, and the route reads back as written', () => {
  assert.deepEqual(parseRoute('#timesheet'), { level: 'timesheet' })
  assert.equal(formatRoute({ level: 'timesheet' }), '#timesheet')
})
