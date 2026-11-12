// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Edit mode is pushed to the page, not polled (features/edit-mode-pushed.clan).
// Every open document's bridge used to ask clan://edit-mode every 0.4 s (the
// legacy one every 0.3 s), about 150 requests a minute per open document. The
// shell now posts { type: 'clan:edit-mode', active } on every load and every
// change, and the bridges apply it exactly as the poll did.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { editModeMessage } from '../src/shell/editMode.ts'

function appRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'src', 'shell', 'bridge'))) return dir
    dir = dirname(dir)
  }
  return process.cwd()
}
const read = (rel: string) => readFileSync(join(appRoot(), rel), 'utf8')
// The composer drops the leading `//` lines first (napkin-host frame.rs script_body).
const bridge = (name: string) => read(`src/shell/bridge/${name}`).replace(/^(\/\/[^\n]*\n)+/, '')

interface FakeEl {
  attrs: Record<string, string>
  dataset: Record<string, string>
  style: Record<string, string>
  listeners: Record<string, () => void>
  getAttribute(k: string): string | null
  setAttribute(k: string, v: string): void
  removeAttribute(k: string): void
  addEventListener(k: string, f: () => void): void
  focus(): void
  textContent: string
}
function el(field: string): FakeEl {
  const e: FakeEl = {
    attrs: { 'data-clan-field': field }, dataset: {}, style: {}, listeners: {}, textContent: 'words',
    getAttribute: k => e.attrs[k] ?? null,
    setAttribute: (k, v) => { e.attrs[k] = v },
    removeAttribute: k => { delete e.attrs[k] },
    addEventListener: (k, f) => { e.listeners[k] = f },
    focus: () => {},
  }
  return e
}

/** A frame page running one bridge, with a parent that can post to it. */
function page(file: string) {
  const fields: FakeEl[] = []
  const fetched: string[] = []
  const events: { type: string; active: boolean }[] = []
  const timers: { fn: () => void; ms: number; repeat: boolean }[] = []
  const messageListeners: ((e: { source: unknown; data: unknown }) => void)[] = []
  let observer: { cb: () => void; on: boolean } | null = null
  const parent = { postMessage: () => {} }
  const win: Record<string, unknown> = {
    parent,
    navigator: { userAgent: 'test' },
    fetch: (url: string) => { fetched.push(url); return new Promise(() => {}) },
    addEventListener: (type: string, l: (e: { source: unknown; data: unknown }) => void) => { if (type === 'message') messageListeners.push(l) },
    removeEventListener: () => {},
    dispatchEvent: (ev: { type: string; detail?: { active?: boolean } }) => {
      if (ev.type === 'clan:editmode') events.push({ type: ev.type, active: !!ev.detail?.active })
      return true
    },
  }
  const doc = {
    documentElement: { setAttribute() {}, style: {}, outerHTML: '' },
    querySelectorAll: (sel: string) => (sel === '[data-clan-field]' || sel === '[data-adf-id]' ? fields : []),
  }
  class CE { type: string; detail: unknown; constructor(t: string, o?: { detail?: unknown }) { this.type = t; this.detail = o?.detail } }
  class MO {
    cb: () => void
    constructor(cb: () => void) { this.cb = cb }
    observe() { observer = { cb: this.cb, on: true } }
    disconnect() { if (observer) observer.on = false }
  }
  const setInterval = (fn: () => void, ms: number) => { timers.push({ fn, ms, repeat: true }); return timers.length }
  const setTimeout = (fn: () => void, ms: number) => { timers.push({ fn, ms, repeat: false }); return timers.length }
  new Function('window', 'document', 'CustomEvent', 'MutationObserver', 'setInterval', 'setTimeout', 'clearTimeout', 'fetch', bridge(file))(
    win, doc, CE, MO, setInterval, setTimeout, () => {}, win.fetch,
  )
  const post = (data: unknown, source: unknown = parent) => { for (const l of messageListeners) l({ source, data }) }
  const runTimers = () => { for (const t of timers.splice(0).filter(t => !t.repeat)) t.fn() }
  return { win, fields, fetched, events, timers, post, parent, runTimers, observer: () => observer }
}

test('the structured bridge applies clan:edit-mode as the poll did', () => {
  const p = page('structuredEditBridge.js')
  const f = el('insight')
  p.fields.push(f)
  p.post(editModeMessage(true))
  assert.equal(p.win.__clan_edit_mode, true)
  assert.deepEqual(p.events, [{ type: 'clan:editmode', active: true }])
  assert.equal(f.dataset.clanFieldSetup, 'true', 'the field is wired')
  assert.match(f.style.outline, /solid/, 'and shows it is editable')
  f.listeners.click()
  assert.equal(f.attrs.contenteditable, 'true', 'a click opens it for typing')

  // A field the app draws later is wired too (the old poll's every-tick activate()).
  const later = el('summary')
  p.fields.push(later)
  p.observer()!.cb()
  p.runTimers()
  assert.equal(later.dataset.clanFieldSetup, 'true')

  // The same value again (a reload's post) changes nothing and fires no event.
  p.post(editModeMessage(true))
  assert.equal(p.events.length, 1)

  p.post(editModeMessage(false))
  assert.equal(p.win.__clan_edit_mode, false)
  assert.deepEqual(p.events[1], { type: 'clan:editmode', active: false })
  assert.equal(f.style.outline, '', 'the outline goes')
  assert.equal(f.attrs.contenteditable, undefined)
  assert.equal(p.observer()!.on, false, 'and the page stops watching for new fields')
})

test('only the shell is heard', () => {
  const p = page('structuredEditBridge.js')
  p.post(editModeMessage(true), {})
  assert.equal(p.win.__clan_edit_mode, false)
  p.post({ type: 'clan:edit-mode', active: 'yes' })
  assert.equal(p.win.__clan_edit_mode, false, 'only a real true turns it on')
})

test('neither bridge asks clan://edit-mode, and no 0.4 s poll remains', () => {
  for (const file of ['structuredEditBridge.js', 'legacyEditBridge.js']) {
    const p = page(file)
    for (const t of p.timers.filter(t => t.repeat)) for (let i = 0; i < 5; i++) t.fn()
    assert.ok(!p.fetched.some(u => u.includes('/edit-mode')), `${file} fetched ${p.fetched.join(', ')}`)
    assert.ok(!bridge(file).includes("'/edit-mode'"), file)
  }
  const structured = page('structuredEditBridge.js')
  assert.deepEqual(structured.timers.filter(t => t.repeat), [], 'the structured bridge keeps no interval at all')
})

test('the legacy bridge applies clan:edit-mode too', () => {
  const p = page('legacyEditBridge.js')
  const f = el('x')
  f.attrs = { 'data-adf-id': 'p-1' }
  p.fields.push(f)
  p.post(editModeMessage(true))
  assert.equal(p.win.__clan_edit_mode, true)
  assert.equal(f.dataset.clanEditSetup, 'true')
  p.post(editModeMessage(false))
  assert.equal(p.win.__clan_edit_mode, false)
  assert.equal(f.attrs.contenteditable, undefined)
})

test('the shell posts edit mode to the frame on every load and every change', () => {
  assert.deepEqual(editModeMessage(true), { type: 'clan:edit-mode', active: true })
  const rt = read('src/shell/AppRuntime.tsx')
  assert.match(rt, /contentWindow\?\.postMessage\(editModeMessage\(editModeRef\.current\), '\*'\)/)
  assert.match(rt, /editModeRef\.current = editMode\s+host\.setEditMode\(editMode\)\.catch\(console\.error\)\s+postEditMode\(\)\s+\}, \[editMode, postEditMode\]\)/)
  assert.match(rt, /onLoad=\{\(\) => \{[\s\S]*postEditMode\(\)[\s\S]*DOC_LOADED/)
})
