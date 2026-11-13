// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Feedback by pointing at it, the shell's side (features/feedback-point.clan;
// mock feedback-point-v1): the account row and the F key, pointing started,
// cancelled and picked (in the shell and from a tool's frame), the event it
// records, and the thumbs-down note under an agent's result. The page side is
// in templates.test.ts.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { accountItems } from '../src/components/barMenus.ts'
import { ResultThumbs } from '../src/dogfood/Dogfood.tsx'
import { NoteCard } from '../src/dogfood/FeedbackPoint.tsx'
import { __test, noteFor, type ShellEvent } from '../src/dogfood/recorder.ts'
import {
  __resetPoint, aboutLine, cancelPointing, cardSpot, describeShell, feedbackOpener, fromFrame, isTyping, keyAction,
  pick, pointFeedbackData, pointState, sendNote, sentWithLine, setFeedbackDoc, setFeedbackFrame, startPointing,
  type FeedbackDoc,
} from '../src/dogfood/pointer.ts'

/** Enough of an element for closest/getAttribute/querySelector: it "matches" the selectors it lists. */
class El {
  children: El[] = []
  parent: El | null = null
  constructor(public tagName: string, public sels: string[] = [], public attrs: Record<string, string> = {}, public text = '') {}
  add(c: El) { c.parent = this; this.children.push(c); return this }
  getAttribute(n: string) { return this.attrs[n] ?? null }
  get textContent(): string { return this.text + this.children.map(c => c.textContent).join('') }
  closest(sel: string): El | null {
    const parts = sel.split(',').map(s => s.trim())
    const hit = (e: El): El | null => (parts.some(p => e.sels.includes(p)) ? e : e.parent ? hit(e.parent) : null)
    return hit(this)
  }
  querySelector(sel: string): El | null {
    const parts = sel.split(',').map(s => s.trim())
    for (const c of this.children) {
      if (parts.some(p => c.sels.includes(p))) return c
      const d = c.querySelector(sel)
      if (d) return d
    }
    return null
  }
}

const DOC: FeedbackDoc = {
  path: 'briefs/welcome.clan', title: 'Welcome Back, Barista', appId: 'brief-maker', tool: 'Brief', toolVersion: '1.4.0',
  version: 'sha256:abc123', noun: 'brief', jobs: ['job_7f3a'],
}

function recordingNow() {
  const sent: ShellEvent[][] = []
  __test({ on: true, consented: true }, b => { sent.push(b) })
  return sent
}

test('Feedback sits beside About this beta in the account menu, with its key, only with an opener', () => {
  const run = () => {}
  const on = accountItems(undefined, 'plu@pluto', run, run, run).map(i => [i.label, i.key ?? null, i.hint ?? ''])
  assert.deepEqual(on.map(x => x[0]), ['Feedback', 'About this beta', 'Sign out'])
  assert.equal(on[0][1], 'F')
  assert.equal(on[0][2], 'Point at what it is about, and tell us')
  assert.deepEqual(accountItems(undefined, 'plu@pluto', run, undefined, undefined).map(i => i.label), ['Sign out'])
  assert.equal(feedbackOpener(false), undefined, 'no row unless the build records and the person agreed')
  assert.equal(typeof feedbackOpener(true), 'function')
})

test('F starts pointing anywhere, but not while typing, with a modifier, or held', () => {
  const div = new El('DIV')
  assert.equal(keyAction({ key: 'f', target: div }, 'idle'), 'start')
  assert.equal(keyAction({ key: 'F', target: div }, 'sent'), 'start')
  for (const t of [
    Object.assign(new El('INPUT'), { type: 'text' }),
    Object.assign(new El('INPUT'), { type: '' }),
    new El('TEXTAREA'),
    new El('SELECT'),
    Object.assign(new El('DIV'), { isContentEditable: true }),
  ]) assert.equal(keyAction({ key: 'f', target: t }, 'idle'), null, `typing in ${t.tagName}`)
  const inEditable = new El('SPAN'); new El('P', ['[contenteditable="true"]']).add(inEditable)
  assert.equal(isTyping(inEditable), true, 'inside editable content is typing')
  assert.equal(isTyping(Object.assign(new El('INPUT'), { type: 'checkbox' })), false, 'a checkbox takes no text')
  assert.equal(keyAction({ key: 'f', ctrlKey: true, target: div }, 'idle'), null)
  assert.equal(keyAction({ key: 'f', metaKey: true, target: div }, 'idle'), null)
  assert.equal(keyAction({ key: 'f', repeat: true, target: div }, 'idle'), null)
  assert.equal(keyAction({ key: 'f', target: div }, 'pointing'), null, 'already pointing')
  assert.equal(keyAction({ key: 'f', target: div }, 'note'), null, 'a note is open')
  assert.equal(keyAction({ key: 'Escape', target: div }, 'pointing'), 'cancel')
  assert.equal(keyAction({ key: 'Escape', target: div }, 'note'), 'cancel')
  assert.equal(keyAction({ key: 'Escape', target: div }, 'idle'), null)
})

test('pointing starts only while recording, tells the frame, and Esc stops both', () => {
  __resetPoint()
  const posted: unknown[] = []
  setFeedbackFrame({ postMessage: m => { posted.push(m) } })
  __test({ on: true, consented: false })
  startPointing()
  assert.equal(pointState().phase, 'idle', 'nothing before the person agreed')
  assert.equal(posted.length, 0)

  recordingNow()
  startPointing()
  assert.equal(pointState().phase, 'pointing')
  assert.deepEqual(posted, [{ type: 'clan:feedback-pick', on: true }])
  cancelPointing()
  assert.equal(pointState().phase, 'idle')
  assert.deepEqual(posted.at(-1), { type: 'clan:feedback-pick', on: false })

  // a frame that loads while pointing is told at once
  startPointing()
  const late: unknown[] = []
  setFeedbackFrame({ postMessage: m => { late.push(m) } })
  assert.deepEqual(late, [{ type: 'clan:feedback-pick', on: true }])
  cancelPointing()
})

test('a pick in the shell names a button by its label, else the area it is in', () => {
  const bar = new El('HEADER', ['header'], { 'aria-label': 'The OS bar' })
  const btn = new El('BUTTON', ['button'], { 'data-dogfood': 'menu: Share' }, ' Share ')
  const label = new El('SPAN', [], {}, 'Share'); btn.text = ''; btn.add(label)
  bar.add(btn)
  const d = describeShell(label)
  assert.deepEqual(d?.target, { kind: 'control', id: 'menu: Share', label: 'Share' })
  assert.equal(d?.el, btn)
  const blank = new El('DIV'); bar.add(blank)
  assert.deepEqual(describeShell(blank)?.target, { kind: 'section', id: 'header', label: 'The OS bar' })
  const loose = new El('DIV')
  assert.deepEqual(describeShell(loose)?.target, { kind: 'section', id: 'screen', label: 'This screen' })

  __resetPoint()
  const posted: unknown[] = []
  setFeedbackFrame({ postMessage: m => { posted.push(m) } })
  recordingNow()
  startPointing()
  pick({ target: d!.target, in: 'shell', rect: { x: 10, y: 20, w: 80, h: 30 } })
  const st = pointState()
  assert.equal(st.phase, 'note')
  assert.deepEqual(posted.at(-1), { type: 'clan:feedback-pick', on: false }, 'the frame stops pointing too')
  cancelPointing()
  assert.equal(pointState().phase, 'idle', 'Cancel closes the note')
})

test("a pick inside the tool's frame lands next to it; Esc there cancels; F there starts", () => {
  __resetPoint()
  recordingNow()
  assert.equal(fromFrame({ type: 'clan:feedback-key' }, { x: 0, y: 0 }), true)
  assert.equal(pointState().phase, 'pointing', 'F in the page starts pointing')
  fromFrame({ type: 'clan:feedback-picked', target: null, rect: null }, { x: 0, y: 0 })
  assert.equal(pointState().phase, 'idle', 'Esc in the page cancels')

  startPointing()
  fromFrame({ type: 'clan:feedback-picked', target: { kind: 'part', id: 'barrier', label: 'The barrier' }, rect: { x: 40, y: 100, w: 600, h: 44 }, version: 'v1', title: 'Welcome Back, Barista' }, { x: 0, y: 52 })
  const st = pointState()
  assert.equal(st.phase, 'note')
  if (st.phase !== 'note') return
  assert.deepEqual(st.picked, { target: { kind: 'part', id: 'barrier', label: 'The barrier' }, in: 'app', rect: { x: 40, y: 152, w: 600, h: 44 }, page: { version: 'v1', title: 'Welcome Back, Barista' } })
  cancelPointing()

  startPointing()
  fromFrame({ type: 'clan:feedback-picked', target: { kind: 'nonsense', label: 'x' } }, { x: 0, y: 0 })
  assert.equal(pointState().phase, 'idle', 'a target that is not one cancels rather than guess')
  assert.equal(fromFrame({ type: 'clan:bar' }, { x: 0, y: 0 }), false, 'other messages are not ours')
})

test('the note card says what it is about and what goes with it', () => {
  const t = { kind: 'part' as const, id: 'barrier', label: 'The barrier' }
  const page = { version: 'v1', title: 'Welcome Back, Barista' }
  assert.equal(aboutLine(t, DOC, page), 'ABOUT · The barrier · Brief v1 · Welcome Back, Barista', "the document's own version")
  assert.equal(aboutLine(t, DOC), 'ABOUT · The barrier · Brief · Welcome Back, Barista', "a pick in the shell: no version, never the tool's")
  assert.doesNotMatch(aboutLine(t, DOC), /1\.4\.0/)
  assert.equal(sentWithLine(t, DOC), "Sent with: your name, this part, the brief's version, and the job running now (job_7f3a).")
  assert.equal(sentWithLine({ ...t, kind: 'control' }, { ...DOC, jobs: [] }), "Sent with: your name, this button, the brief's version, and the job running now (none).")
  assert.equal(sentWithLine(t, null), 'Sent with: your name, this part, and the screen you are on.')
  setFeedbackDoc(DOC)
  const html = renderToStaticMarkup(createElement(NoteCard, { picked: { target: t, in: 'app', rect: { x: 0, y: 0, w: 1, h: 1 }, page }, at: { left: 10, top: 20 } }))
  for (const w of ['ABOUT', 'The barrier · Brief v1 · Welcome Back, Barista', '>Wrong<', '>Unclear<', '>Idea<', '>Cancel<', '>Send<', 'job running now (job_7f3a)'])
    assert.ok(html.includes(w), w)
  assert.doesNotMatch(html, /screenshot/i, 'no screenshot is offered: the frame cannot be captured')
  const spot = cardSpot({ x: 40, y: 100, w: 600, h: 44 }, { w: 1280, h: 800 })
  assert.deepEqual(spot, { left: 280, top: 152 })
  assert.deepEqual(cardSpot({ x: 1200, y: 700, w: 60, h: 40 }, { w: 1280, h: 800 }), { left: 912, top: 392 }, 'kept on screen: left and above')
})

test('Send records one feedback-point event with what was pointed at', () => {
  __resetPoint()
  const sent = recordingNow()
  setFeedbackDoc(DOC)
  startPointing()
  pick({ target: { kind: 'finding', id: 'fi_12', label: 'Finding 3 · Lapsed buyers' }, in: 'app', rect: { x: 0, y: 0, w: 1, h: 1 }, page: { version: 'v2', title: 'Report title' } })
  sendNote('unclear', '  Which buyers?  ')
  assert.equal(pointState().phase, 'sent')
  const events = sent.flat()
  assert.equal(events.length, 1, 'sent at once, not left in the queue')
  const e = events[0]
  assert.equal(e.kind, 'feedback-point')
  assert.equal(e.name, 'finding: Finding 3 · Lapsed buyers')
  assert.deepEqual({ ...e.data, screen: undefined }, {
    screen: undefined,
    kind: 'unclear', text: 'Which buyers?',
    target: { kind: 'finding', id: 'fi_12', label: 'Finding 3 · Lapsed buyers', in: 'app' },
    doc_version: 'sha256:abc123', doc_version_label: 'v2', doc_title: 'Report title', tool: 'Brief', tool_version: '1.4.0', job: 'job_7f3a',
  })
  assert.deepEqual(pointFeedbackData('idea', 'x', { target: { kind: 'control', id: 'Share', label: 'Share' }, in: 'shell', rect: { x: 0, y: 0, w: 0, h: 0 } }, null),
    { kind: 'idea', text: 'x', target: { kind: 'control', id: 'Share', label: 'Share', in: 'shell' }, doc_version: null, doc_version_label: null, doc_title: null, tool: null, tool_version: null, job: null })
  __test({ on: false, consented: false })
  __resetPoint()
})

test("under an agent's result, 👎 opens the optional line and 👍 does not", () => {
  assert.equal(noteFor('down', null), null)
  assert.equal(noteFor('down', 'up'), null)
  assert.equal(noteFor('down', 'down'), 'What was off? (optional)')
  assert.equal(noteFor('any', 'up'), 'Anything to add? (optional)')
  __test({ on: true, consented: true })
  const fresh = renderToStaticMarkup(createElement(ResultThumbs, { extra: { action: 'set' } }))
  assert.match(fresh, /Was this useful\?/)
  assert.match(fresh, /👍/); assert.match(fresh, /👎/)
  assert.doesNotMatch(fresh, /<input/)
  assert.match(renderToStaticMarkup(createElement(ResultThumbs, { extra: {}, initial: 'down' })), /placeholder="What was off\? \(optional\)"/)
  assert.doesNotMatch(renderToStaticMarkup(createElement(ResultThumbs, { extra: {}, initial: 'up' })), /<input/)
  __test({ on: false, consented: false })
})
