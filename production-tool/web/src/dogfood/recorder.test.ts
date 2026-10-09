// The beta's recorder (features/production-tool-dogfood.clan): one test per rule the owner set so
// the record is not noise (features/dogfood-log-quality.clan was Napkin OS's lesson).

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { BetaTag, DogfoodNotice, Thumbs } from './Dogfood'
import {
  __flush, __test, capture, errorShown, feedback, feedbackNote, jobState, nameOf, record, Recorder, setScreen, type ShellEvent,
} from './recorder'

// ── a few elements, enough for nameOf (vitest runs in node: no DOM here) ──

class El {
  readonly nodeType = 1
  parent: El | null = null
  readonly childNodes: (El | { nodeType: 3; textContent: string })[] = []
  readonly tagName: string
  readonly attrs: Record<string, string>
  constructor(tag: string, attrs: Record<string, string> = {}, kids: (El | string)[] = []) {
    this.tagName = tag.toUpperCase()
    this.attrs = attrs
    for (const k of kids) {
      if (typeof k === 'string') this.childNodes.push({ nodeType: 3, textContent: k })
      else { k.parent = this; this.childNodes.push(k) }
    }
  }
  getAttribute(n: string) { return this.attrs[n] ?? null }
  get type() { return this.attrs.type ?? '' }
  private matches(sel: string): boolean {
    return sel.split(',').some((one) => {
      const s = one.trim()
      const attr = s.match(/^\[([a-z-]+)(?:="([^"]*)")?\]$/)
      if (attr) return attr[2] === undefined ? attr[1] in this.attrs : this.attrs[attr[1]] === attr[2]
      if (s.startsWith('.')) return (this.attrs.class ?? '').split(' ').includes(s.slice(1))
      return s === this.tagName.toLowerCase()
    })
  }
  closest(sel: string): El | null {
    return this.matches(sel) ? this : this.parent?.closest(sel) ?? null
  }
}
const el = (tag: string, attrs: Record<string, string> = {}, ...kids: (El | string)[]) => new El(tag, attrs, kids)
const asEl = (e: El) => e as unknown as Element

let sent: ShellEvent[] = []
beforeEach(() => {
  sent = []
  __test({ on: true, consented: true }, (events) => { sent.push(...events) })
})

describe('the beta recorder', () => {
  it('records nothing when the build does not record or before the notice is read', () => {
    __test({ on: false, consented: false }, (events) => { sent.push(...events) })
    record('click', 'button: Go')
    __test({ on: true, consented: false }, (events) => { sent.push(...events) })
    record('click', 'button: Go')
    feedback({ kind: 'frame', id: 'frame_1' }, 'up')
    __flush()
    expect(sent).toEqual([])
  })

  it('folds a run of identical events into the first plus one repeat line', () => {
    for (let i = 0; i < 30; i++) record('click', 'in canvas: background')
    record('click', 'button: Generate')
    __flush()
    expect(sent.map((e) => [e.kind, e.name])).toEqual([
      ['click', 'in canvas: background'], ['repeat', 'in canvas: background'], ['click', 'button: Generate'],
    ])
    expect(sent[1].data).toMatchObject({ of: 'click', count: 29 })
  })

  it('a run still going at a flush sends its repeat line and keeps folding', () => {
    const r: ShellEvent[][] = []
    const rec = new Recorder((b) => r.push(b), 50, 60_000)
    const e = { kind: 'click', name: 'button: Retry', at: '2026-10-09T10:00:00.000Z' }
    rec.push(e); rec.push({ ...e, at: '2026-10-09T10:00:01.000Z' }); rec.flush(false)
    rec.push({ ...e, at: '2026-10-09T10:00:02.000Z' }); rec.flush(false)
    expect(r.map((b) => b.map((x) => x.kind))).toEqual([['click', 'repeat'], ['repeat']])
    expect(r[1][0].data).toMatchObject({ count: 1, first: '2026-10-09T10:00:02.000Z' })
  })

  it('a job polled every 2 s for a minute is recorded by its state changes only', () => {
    jobState('job_A', 'queued', { op: 'frame' })
    for (let i = 0; i < 30; i++) jobState('job_A', 'submitted', { op: 'frame', provider: 'runway', ms: i * 2000 })
    jobState('job_A', 'completed', { op: 'frame' })
    __flush()
    expect(sent.map((e) => e.name)).toEqual(['queued', 'submitted', 'completed'])
    expect(sent.every((e) => e.data?.jobId === 'job_A')).toBe(true)
  })

  it('records only the clicks a person made', () => {
    const button = el('button', {}, 'Export')
    capture('click', { isTrusted: false, target: asEl(button) as unknown as EventTarget })
    capture('click', { isTrusted: true, target: asEl(button) as unknown as EventTarget })
    __flush()
    expect(sent.map((e) => e.name)).toEqual(['button: Export'])
  })

  it('a thumb is recorded the moment it is chosen, the note only on Send', () => {
    feedback({ kind: 'frame', id: 'frame_1', jobId: 'job_F', provider: 'runway' }, 'down')
    expect(sent).toHaveLength(1) // sent at once, no Send pressed
    expect(sent[0]).toMatchObject({ kind: 'feedback', name: 'frame', data: { thumb: 'down', id: 'frame_1', jobId: 'job_F', provider: 'runway' } })
    feedbackNote({ kind: 'frame', id: 'frame_1', jobId: 'job_F' }, 'down', '  lost the red coat ')
    expect(sent[1]).toMatchObject({ kind: 'feedback-note', data: { note: 'lost the red coat' } })
    feedback({ kind: 'frame', id: 'frame_1' }, 'down')
    expect(sent.filter((e) => e.kind === 'feedback')).toHaveLength(2) // a person's statements never fold
  })

  it('an error shown on every render is recorded once', () => {
    for (let i = 0; i < 5; i++) errorShown('job', 'Runway refused it', { jobId: 'job_E', code: 'moderated' })
    __flush()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ kind: 'error-shown', name: 'job', data: { jobId: 'job_E', code: 'moderated' } })
  })

  it('carries the screen: stage and project', () => {
    setScreen({ stage: 'storyboard', project: 'proj_1' })
    record('click', 'button: Plan shots')
    __flush()
    expect(sent.map((e) => [e.kind, e.name, e.stage, e.project])).toEqual([
      ['nav', 'stage', 'storyboard', 'proj_1'], ['click', 'button: Plan shots', 'storyboard', 'proj_1'],
    ])
  })
})

describe('nameOf', () => {
  it('stays the same when a date, time, count or price in it changes', () => {
    const a = el('button', {}, el('b', {}, 'Bulmers'), ' · ', el('span', {}, 'Yesterday, 00:54'), el('span', {}, '3 shots · $1.20'))
    const b = el('button', {}, el('b', {}, 'Bulmers'), ' · ', el('span', {}, 'Today, 15:22'), el('span', {}, '12 shots · $0.40'))
    expect(nameOf(asEl(a))).toBe(nameOf(asEl(b)))
    expect(nameOf(asEl(a))).toBe('button: Bulmers · shots')
  })

  it('takes data-dogfood, aria-label or title first', () => {
    expect(nameOf(asEl(el('button', { 'data-dogfood': 'beta tag', title: 'x' }, 'Beta')))).toBe('button: beta tag')
    expect(nameOf(asEl(el('button', { 'aria-label': 'Delete' }, '🗑')))).toBe('button: Delete')
    const inner = el('span', {}, 'Retry')
    el('button', { title: 'Send it again as it was' }, inner)
    expect(nameOf(asEl(inner))).toBe('button: Send it again as it was')
  })

  it('names a click on no control by its area, never by the page text', () => {
    const text = el('p', {}, 'Write what happens in your ad, a secret client line')
    el('div', { 'data-dogfood-area': 'canvas' }, el('div', {}, text))
    expect(nameOf(asEl(text))).toBe('in canvas: background')
    expect(nameOf(asEl(el('div', { class: 'excalidraw' }, 'x')))).toBe('in canvas: background')
  })

  it('never names a key field by its value', () => {
    expect(nameOf(asEl(el('input', { type: 'password', value: 'fal-SECRET' })))).toBe('input: key')
  })
})

describe('what people see', () => {
  it('the notice says this beta logs what you do, and where to write', () => {
    const html = renderToStaticMarkup(createElement(DogfoodNotice, { onAgree: () => {} }))
    expect(html).toContain('This beta logs what you do')
    expect(html).toContain('We record what you click, what you ask for and what comes back')
    expect(html).toContain('hello@napkin.ie')
    expect(html).toContain('I understand')
  })

  it('the Beta tag and thumbs show only when the build records', () => {
    expect(renderToStaticMarkup(createElement(BetaTag, { screen: { stage: 'home' } }))).toContain('>Beta<')
    const thumbs = renderToStaticMarkup(createElement(Thumbs, { target: { kind: 'clip', id: 'take_1' } }))
    expect(thumbs).toContain('This is right')
    expect(thumbs).toContain('This is wrong')
    __test({ on: false, consented: false })
    expect(renderToStaticMarkup(createElement(BetaTag, { screen: { stage: 'home' } }))).toBe('')
    expect(renderToStaticMarkup(createElement(Thumbs, { target: { kind: 'clip' } }))).toBe('')
  })
})
