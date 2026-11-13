// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The nine screen states as shared components, and the save the shell knows has
// failed (features/screen-states.clan). Each `done_when` line has its test here:
//
//  1. nine components; the gallery in three modes; axe finds nothing
//  2. a failed write keeps the typed text; Try again saves once the network is back (pilot 13, in app/)
//  3. a failed run: one plain line, estimate returned, inputs kept, Try again works (pilot 15, in app/)
//  4. Empty shows a finished J001 example and one starting verb, for every door with no tool
//  5. no spinner for a wait under a second
//
// The end-to-end pilot file (e2e/j001-pilot.spec.ts) belongs to another record; these tests
// run the same behaviour against the real bridge and the real components, in jsdom.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { mock, test } from 'node:test'
import { createRequire } from 'node:module'
import { JSDOM } from 'jsdom'
import { createElement, act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// A page for the components that need one (react-dom/client, the bridge). Installed before they load.
const dom = new JSDOM('<!doctype html><html lang="en"><body><div id="root"></div></body></html>', { url: 'https://napkin.test/', runScripts: 'outside-only', pretendToBeVisual: true })
const g = globalThis as Record<string, unknown>
for (const k of ['window', 'document', 'HTMLElement', 'HTMLIFrameElement', 'Node', 'Element', 'Event', 'CustomEvent', 'MessageEvent', 'MouseEvent', 'KeyboardEvent', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  g[k] = (dom.window as unknown as Record<string, unknown>)[k === 'window' ? 'window' : k]
}
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
g.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')

const { STATES, STATE_NAMES, MODES, STATE_ACTIONS, FAILED_SAVE, RUN_FAILED, runFailedLine, CHANGED_BRIEF, MISSING_ACCESS, NOT_RIGHT, LONG_RUN, LOADING, J001_BRIEF_EXAMPLE } = await import('../src/components/states/words.ts')
const S = await import('../src/components/states/ScreenStates.tsx')
const { Gallery } = await import('../src/components/states/Gallery.tsx')
const { loadingPhase, RECTS_AFTER_MS, SPINNER_AFTER_MS } = await import('../src/components/states/loading.ts')
const { createSaveQueue, writeFrom } = await import('../src/components/states/saveQueue.ts')
const { StateStrip } = await import('../src/components/states/StateStrip.tsx')
const { DOORS, PHASE1_DOORS, ROLES, doorsWithoutTool, hasTool, doorById } = await import('../src/components/states/doors.ts')
const { barFrom, stateOf } = await import('../src/shell/appBar.ts')
const { TEASERS } = await import('../src/shell/comingSoon.ts')
const { SoonCard } = await import('../src/shell/SoonCard.tsx')

const require = createRequire(import.meta.url)
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')
let root = new URL('.', import.meta.url)
while (!existsSync(new URL('package.json', root))) root = new URL('..', root)
/** A file under app/, by its path from app/. */
const read = (p: string) => readFileSync(new URL(p, root), 'utf8')
/** The authored edit bridge, as the host puts it in the frame (src/shell/bridge/structuredEditBridge.js). */
const STRUCTURED_EDIT_BRIDGE = read('src/shell/bridge/structuredEditBridge.js')

/** Draw an element into the page and hand back its container. */
async function draw(el: ReturnType<typeof createElement>) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(el) })
  return { host, unmount: () => act(async () => { root.unmount(); host.remove() }) }
}
const click = (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

// ── 1. nine components, three modes, axe ────────────────────────────────────

test('there are nine states, each named, in the order v2 lists them', () => {
  assert.deepEqual([...STATES], ['normal', 'empty', 'loading', 'failed-save', 'missing-access', 'changed-brief', 'run-failed', 'not-right', 'long-run'])
  assert.deepEqual(STATES.map(s => STATE_NAMES[s]), ['Normal', 'Empty', 'Loading', 'Failed save', 'Missing access', 'Changed brief', 'Run failed', 'Not right', 'Long run'])
})

test('the gallery draws all nine in White, Grey and Black', () => {
  const html = renderToStaticMarkup(createElement(Gallery))
  const page = new JSDOM(html).window.document
  assert.deepEqual([...page.querySelectorAll('section[data-mode]')].map(m => m.getAttribute('data-mode')), [...MODES])
  for (const mode of MODES) {
    const inMode = [...page.querySelectorAll(`section[data-mode="${mode}"] [data-state]`)].map(e => e.getAttribute('data-state'))
    assert.deepEqual(inMode, [...STATES], `${mode} shows the nine, once each`)
  }
})

test('axe finds nothing in the gallery, in any of the three modes', async () => {
  for (const modes of [['white'], ['grey'], ['black'], [...MODES]] as const) {
    const page = new JSDOM(`<!doctype html><html lang="en"><head><title>The nine screen states</title></head><body>${renderToStaticMarkup(createElement(Gallery, { modes }))}</body></html>`, { runScripts: 'outside-only' })
    page.window.eval(axeSource)
    // Contrast needs real layout and real CSS; jsdom has neither, so the tokens are measured in the next test.
    const result = await (page.window as unknown as { axe: { run: (c: Document, o: object) => Promise<{ violations: { id: string; impact: string; nodes: unknown[] }[] }> } })
      .axe.run(page.window.document, { rules: { 'color-contrast': { enabled: false } } })
    assert.equal(result.violations.map(v => `${v.impact} ${v.id} x${v.nodes.length}`).join('; '), '', `${modes.join('+')}`)
    page.window.close()
  }
})

/** WCAG relative luminance contrast of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const lum = (h: string) => {
    const [r, g2, b2] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g2 + 0.0722 * b2
  }
  const [x, y] = [lum(a), lum(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

test('ink and muted text read on the paper and the grey rectangles in every mode (4.5 to 1)', () => {
  const css = read('src/components/states/states.css')
  for (const mode of MODES) {
    const block = new RegExp(`\\.ns-mode\\[data-mode='${mode}'\\][^{]*\\{([^}]*)\\}`).exec(css)?.[1] ?? ''
    const v = (name: string) => new RegExp(`--${name}: (#[0-9a-fA-F]{6})`).exec(block)?.[1] ?? ''
    for (const [name, on] of [['ink', 'paper'], ['muted', 'paper'], ['ink', 'paper-2'], ['muted', 'paper-2']] as const) {
      assert.ok(v(name) && v(on), `${mode} defines ${name} and ${on}`)
      assert.ok(contrast(v(name), v(on)) >= 4.5, `${mode}: ${name} on ${on} is ${contrast(v(name), v(on)).toFixed(2)}`)
    }
  }
})

test('the states use the shell\'s own buttons and tokens, and define no colour of their own', () => {
  const css = read('src/components/states/states.css')
  assert.doesNotMatch(css.split('/* The gallery')[0], /#[0-9a-fA-F]{3,6}\b/, 'no hard-coded colour outside the gallery')
  const page = new JSDOM(renderToStaticMarkup(createElement(Gallery))).window.document
  for (const b of page.querySelectorAll('.ns-btn')) assert.ok(b.classList.contains('ch-btn'))
})

test('every state has at most one primary button, and the buttons are real buttons', () => {
  const page = new JSDOM(renderToStaticMarkup(createElement(Gallery))).window.document
  for (const s of page.querySelectorAll('[data-state]')) {
    assert.ok(s.querySelectorAll('.ns-primary, .ns-dashed').length <= 1, `${s.getAttribute('data-state')} has one primary`)
    for (const b of s.querySelectorAll('.ns-btn:not(.ns-dashed)')) assert.equal(b.tagName, 'BUTTON')
  }
})

test('the words follow the rules: no em dashes, none of the banned words', () => {
  const all = [
    renderToStaticMarkup(createElement(Gallery)),
    JSON.stringify([FAILED_SAVE, RUN_FAILED, J001_BRIEF_EXAMPLE, NOT_RIGHT, LOADING.what('x'), LONG_RUN.left(4), LONG_RUN.needsYou, CHANGED_BRIEF.first('v4', 'v3'), CHANGED_BRIEF.moved, CHANGED_BRIEF.update('v4'), CHANGED_BRIEF.update(), MISSING_ACCESS.line('x', 'y'), MISSING_ACCESS.ask('y'), MISSING_ACCESS.asked('y')]),
    read('src/components/states/doors.ts'),
  ].join('\n')
  assert.doesNotMatch(all, /—|–/, 'no em or en dash')
  assert.doesNotMatch(all, /magic|stunning|effortless|sparkle|\bAI-powered\b/i)
})

test('the five smaller states say what v2 says they say', async () => {
  const a = await draw(createElement(S.MissingAccess, { what: 'the J001 scope', who: 'Account service' }))
  assert.match(text(a.host), /Account service can give you access/)
  assert.equal(a.host.querySelectorAll('button').length, 1)
  assert.equal(text(a.host.querySelector('button')!), 'Ask Account service')
  await a.unmount()
  const c = await draw(createElement(S.ChangedBrief, { from: 'v3', to: 'v4', changes: 'The measure now has a number.' }))
  assert.equal(text(c.host.querySelector('button')!), 'Update to brief v4')
  assert.equal(c.host.querySelectorAll('p').length, 2, 'two lines')
  await c.unmount()
  const fixed: string[] = []
  const n = await draw(createElement(S.NotRight, { onFix: (f: string) => fixed.push(f) }))
  assert.equal(n.host.querySelectorAll('button').length, 3, 'three quick fixes')
  await click(n.host.querySelectorAll('button')[1])
  assert.deepEqual(fixed, [NOT_RIGHT.fixes[1]])
  await n.unmount()
  const l = await draw(createElement(S.LongRun, { minutes: 4 }))
  assert.match(text(l.host), /About 4 minutes left\.\s*Needs you tells you when it is done/)
  assert.equal(l.host.querySelectorAll('button').length, 0)
  await l.unmount()
  const w = await draw(createElement(S.Normal, { work: createElement('p', null, 'The work'), next: { label: 'Save as PDF' } }))
  assert.equal(w.host.querySelectorAll('button').length, 1, 'the work and one obvious next button')
  await w.unmount()
})

// ── 2. a failed write keeps the text; Try again saves once (pilot 13) ───────

interface Host { applied: string[]; online: boolean; calls: number; status: number }
/** The bridge in a page of its own, talking to a fake host that can lose its network or refuse as stale. */
function frame(host: Host) {
  const win = new JSDOM('<!doctype html><body><p id="brief" data-clan-field="brief.line">Client A, an Irish whiskey</p></body>', { runScripts: 'outside-only', url: 'https://app.test/' }).window as unknown as Window & Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  win.fetch = (url: string, init?: { body?: string }) => {
    if (/\/patch-data$/.test(url)) {
      host.calls++
      if (!host.online) return Promise.reject(new TypeError('Failed to fetch'))
      if (host.status !== 200) return Promise.resolve({ status: host.status, json: () => Promise.resolve({ ok: false, error: 'stale' }) })
      host.applied.push(String(init?.body))
      return Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true }) })
    }
    if (/\/capabilities$/.test(url)) return Promise.resolve({ status: 200, json: () => Promise.resolve({ allowed: [] }) })
    return Promise.resolve({ status: 200, text: () => Promise.resolve('false') })
  }
  const heard: { id: string; state: string; field: string; text: string }[] = []
  win.addEventListener('clan:write', ((e: CustomEvent) => heard.push(e.detail)) as EventListener)
  win.eval(STRUCTURED_EDIT_BRIDGE)
  const retry = (id: string) => win.dispatchEvent(new win.MessageEvent('message', { data: { type: 'clan:retry', id }, source: win.parent }))
  const settle = () => new Promise(r => setTimeout(r, 5))
  return { win, heard, retry, settle }
}

test('a write that works says saving then saved, and changes nothing else', async () => {
  const h: Host = { applied: [], online: true, calls: 0, status: 200 }
  const f = frame(h)
  const res = await f.win.clan.patchData('brief.line', 'Client A, an Irish whiskey, in a bar that waits.', { action: 'edit field' })
  assert.equal(res.ok, true)
  assert.deepEqual(f.heard.map(w => w.state), ['saving', 'saved'])
  assert.equal(f.win.clan.data().brief.line, 'Client A, an Irish whiskey, in a bar that waits.')
  f.win.close()
})

test('network cut while editing: the text stays, the shell is told, Try again saves it once when the network is back', async () => {
  const h: Host = { applied: [], online: false, calls: 0, status: 200 }
  const f = frame(h)
  const typed = 'The whiskey that waits for you, said slower.'
  const line = f.win.document.getElementById('brief')!
  line.textContent = typed
  await assert.rejects(f.win.clan.patchData('brief.line', typed, { action: 'edit field' }), /Failed to fetch/)
  assert.deepEqual(f.heard.map(w => w.state), ['saving', 'failed'])
  assert.equal(f.heard[1].text, typed, 'the queue is given the text')
  assert.equal(line.textContent, typed, 'the typed text is still on the page')
  assert.equal(h.applied.length, 0)

  // the shell's queue hears it, shows Failed save, and Try again goes back to the frame
  const queue = createSaveQueue()
  const sent: string[] = []
  queue.attach(id => sent.push(id))
  for (const w of f.heard) queue.report(w)
  assert.equal(queue.state(), 'failed')
  assert.equal(queue.unsaved()[0].text, typed)
  const strip = await draw(createElement(StateStrip, { queue, app: null, onAction: () => {}, onRefresh: () => {} }))
  assert.match(text(strip.host), /This change did not save\. What you typed is still here\.Try again/)
  assert.equal(strip.host.querySelectorAll('button').length, 1)

  // still no network: Try again is pressed, the frame is asked, it fails again, the line comes back, the text is kept
  await click(strip.host.querySelector('button')!)
  assert.deepEqual(sent, [f.heard[0].id])
  assert.equal(strip.host.innerHTML, '', 'while the write is out again the line steps aside')
  f.retry(sent[0]); await f.settle()
  assert.equal(f.heard.at(-1)!.state, 'failed')
  await act(async () => { queue.report(f.heard.at(-1)!) })
  assert.equal(queue.state(), 'failed')
  assert.equal(strip.host.querySelectorAll('button').length, 1, 'the line is back with Try again')

  // network back: pressed twice, saved once
  h.online = true
  await click(strip.host.querySelector('button')!)
  assert.equal(queue.retry(), 0, 'a second press while the first is out asks for nothing more')
  assert.equal(sent.length, 2)
  f.retry(sent[1]); f.retry(sent[1]); await f.settle(); f.retry(sent[1]); await f.settle()
  assert.equal(h.applied.length, 1, 'one decision reaches the host however often Try again is pressed')
  assert.equal(JSON.parse(h.applied[0]).patch.brief.line, typed)
  assert.equal(f.heard.at(-1)!.state, 'saved')
  await act(async () => { queue.report(f.heard.at(-1)!) })
  assert.equal(queue.state(), 'idle')
  assert.equal(strip.host.innerHTML, '', 'the line is gone once it saved')
  assert.equal(f.win.clan.data().brief.line, typed, 'reopening reads what the host now holds')
  await strip.unmount()
  f.win.close()
})

test('a write the host refuses as stale shows Changed and is never forced over the newer version', async () => {
  const h: Host = { applied: [], online: true, calls: 0, status: 409 }
  const f = frame(h)
  const res = await f.win.clan.patchData('brief.line', 'my words', {})
  assert.equal(res.ok, false)
  assert.equal(f.heard.at(-1)!.state, 'changed')
  assert.equal(h.applied.length, 0)
  const queue = createSaveQueue()
  for (const w of f.heard) queue.report(w)
  assert.equal(queue.state(), 'changed')
  let refreshed = 0
  const strip = await draw(createElement(StateStrip, { queue, app: null, onAction: () => {}, onRefresh: () => { refreshed++ } }))
  assert.match(text(strip.host), /The brief changed while you were typing\./)
  assert.match(text(strip.host.querySelector('button')!), /^Update to the new brief$/)
  await click(strip.host.querySelector('button')!)
  assert.equal(refreshed, 1)
  await strip.unmount()
  f.win.close()
})

test('the queue refuses anything that is not a write report', () => {
  for (const m of [null, 'x', {}, { type: 'clan:write' }, { type: 'clan:write', v: 1, id: '', state: 'saved' }, { type: 'clan:write', v: 1, id: 'a', state: 'lost' }, { type: 'clan:write', v: 2, id: 'a', state: 'saved' }]) assert.equal(writeFrom(m), null)
  assert.deepEqual(writeFrom({ type: 'clan:write', v: 1, id: 'a', state: 'failed', field: 'x', text: 'hello' }), { id: 'a', state: 'failed', field: 'x', text: 'hello' })
})

test('a saved report arriving after another write does not bring a failed one back', () => {
  const q = createSaveQueue()
  q.report({ id: 'a', state: 'saving', field: 'f', text: 't' })
  q.report({ id: 'a', state: 'saved', field: 'f', text: 't' })
  q.report({ id: 'a', state: 'failed', field: 'f', text: 't' })
  assert.equal(q.state(), 'failed', 'a saved write is forgotten, so a stray report of it counts as new')
  q.clear()
  assert.equal(q.state(), 'idle')
})

// ── 3. a failed run (pilot 15) ──────────────────────────────────────────────

test('a failed run says one plain line, returns the estimate, keeps the inputs, and Try again works', async () => {
  for (const why of ['provider', 'refused', 'timeout', 'other'] as const) {
    const line = runFailedLine(why)
    assert.match(line, /reserved estimate is returned/)
    assert.match(line, /your inputs are kept/)
    assert.equal(line.split('. ').length, 2, 'two short sentences, one line')
  }
  let tried = 0
  const r = await draw(createElement(S.RunFailed, { why: 'provider', onRetry: () => { tried++ } }))
  assert.equal(text(r.host.querySelector('p')!), runFailedLine('provider'))
  assert.equal(r.host.querySelectorAll('p').length, 1, 'one plain line')
  await click(r.host.querySelector('button')!)
  assert.equal(tried, 1)
  await r.unmount()
})

test('an app that reports a failed run gets the shell\'s line, and Try again comes back to the app as state-retry', async () => {
  const bar = barFrom({ v: 1, items: [{ kind: 'mode', mode: 'working', label: 'Stopped' }, { kind: 'state', state: 'run-failed', why: 'refused' }] })
  const app = stateOf(bar)
  assert.deepEqual(app, { name: 'run-failed', why: 'refused' })
  const sent: string[] = []
  const s = await draw(createElement(StateStrip, { queue: createSaveQueue(), app, onAction: (id: string) => sent.push(id), onRefresh: () => {} }))
  assert.equal(text(s.host.querySelector('p')!), runFailedLine('refused'))
  await click(s.host.querySelector('button')!)
  assert.deepEqual(sent, [STATE_ACTIONS.retry])
  await s.unmount()
})

test('an app that sends no state is Normal: the strip shows nothing, so nothing is left loading for ever', async () => {
  assert.equal(stateOf(barFrom({ v: 1, items: [{ kind: 'status', label: 'Draft' }] })), null)
  assert.equal(stateOf([]), null)
  const s = await draw(createElement(StateStrip, { queue: createSaveQueue(), app: null, onAction: () => {}, onRefresh: () => {} }))
  assert.equal(s.host.innerHTML, '')
  await s.unmount()
})

test('a state an app sends is text only, cut to length, and an unknown one is left out', () => {
  const got = barFrom({ v: 1, items: [
    { kind: 'state', state: 'loading', what: '<b>the brief</b>'.padEnd(300, 'z') },
    { kind: 'state', state: 'long-run', minutes: 4 },
  ] })
  assert.equal(got.filter(i => i.kind === 'state').length, 1, 'one state at most')
  const s = stateOf(got)
  assert.ok(s?.name === 'loading' && s.what.length <= 140 && s.what.startsWith('<b>the brief</b>'))
  for (const bad of ['sparkle', 7, null]) assert.equal(stateOf(barFrom({ v: 1, items: [{ kind: 'state', state: bad }] })), null)
  assert.equal(stateOf(barFrom({ v: 1, items: [{ kind: 'state', state: 'changed-brief', from: 'v3' }] })), null, 'a changed brief with no version to update to is left out')
  assert.deepEqual(stateOf(barFrom({ v: 1, items: [{ kind: 'state', state: 'long-run', minutes: -5, step: 'Step 2' }] })), { name: 'long-run', minutes: 1, step: 'Step 2' })
})

test('Brief Maker and Research report a failed run and answer state-retry', () => {
  for (const f of ['templates/brief-maker/index.html', 'templates/campaign-research/index.html']) {
    const src = read(f)
    assert.match(src, /kind:'state', state:'run-failed'/, `${f} reports it`)
    assert.match(src, /state-retry/, `${f} handles Try again`)
  }
})

// ── 4. Empty: a finished example and one verb, for every door with no tool ──

const INSTALLED = ['ie.napkin.brief-maker', 'ie.napkin.campaign-research', 'ie.napkin.deck-maker', 'ie.napkin.landing']

test('each of the nine homes has five doors, as the doors table says', () => {
  assert.equal(ROLES.length, 9)
  for (const home of ROLES) {
    assert.equal(DOORS.filter(d => d.homes.includes(home)).length, 5, home)
  }
  assert.equal(PHASE1_DOORS, DOORS, 'the old name stays as an alias')
  assert.equal(new Set(DOORS.map(d => d.id)).size, DOORS.length, 'one entry per door')
  assert.ok(doorById('script-editor'), 'every door of the table has its own content')
})

test('each door with no tool yet renders Empty with its J001 example and one starting verb', async () => {
  const empty = doorsWithoutTool(INSTALLED)
  assert.ok(empty.length >= 30, 'most doors have no tool yet')
  assert.ok(!empty.some(d => hasTool(d, INSTALLED)))
  for (const door of empty) {
    const r = await draw(createElement(S.Empty, { line: door.line, example: door.example, verb: door.verb, reason: 'Comes with its tool' }))
    const section = r.host.querySelector('[data-state="empty"]')!
    assert.ok(section, door.id)
    assert.match(text(section), /Client A, an Irish whiskey/, `${door.id} shows a de-identified example`)
    assert.ok(section.querySelectorAll('.ns-example .ns-small').length >= 1, `${door.id} example has content`)
    assert.ok(text(section.querySelector('.ns-line')!).length > 0, `${door.id} says what goes here`)
    assert.equal(section.querySelectorAll('button').length, 1, `${door.id} has exactly one starting verb`)
    assert.equal(text(section.querySelector('button')!), door.verb)
    await r.unmount()
  }
})

test('Empty with the default example shows the finished J001 brief lines, and a startable verb is a live button', async () => {
  let started = 0
  const r = await draw(createElement(S.Empty, { line: 'The brief for a job goes here.', verb: 'Start a brief', onStart: () => { started++ } }))
  assert.match(text(r.host), /The whiskey that waits for you\./)
  assert.match(text(r.host), /People do not want more time\. They want permission to stop\./)
  await click(r.host.querySelector('button')!)
  assert.equal(started, 1)
  await r.unmount()
})

test('example content is de-identified: no real client or brand name anywhere in the states', () => {
  const all = read('src/components/states/doors.ts') + read('src/components/states/words.ts') + renderToStaticMarkup(createElement(Gallery))
  assert.doesNotMatch(all, /jameson|pernod|irish distillers|tbwa|guinness|diageo|bushmills|powers/i)
})

test('the launcher\'s coming-soon cards show Empty: an example and the starting verb, and open nothing', () => {
  for (const teaser of TEASERS) {
    const html = renderToStaticMarkup(createElement(SoonCard, { teaser }))
    assert.match(html, /data-state="empty"/)
    assert.match(html, /Client A, an Irish whiskey/)
    assert.ok(html.includes(teaser.example.lines[0]))
    assert.match(html, /Coming soon/)
    assert.doesNotMatch(html, /<button|<a /)
  }
})

// ── 5. no spinner under a second ────────────────────────────────────────────

test('what a wait shows: nothing under 300 ms, grey rectangles from 300, the mark from one second', () => {
  assert.equal(loadingPhase(0), 'quiet')
  assert.equal(loadingPhase(RECTS_AFTER_MS - 1), 'quiet')
  assert.equal(loadingPhase(RECTS_AFTER_MS), 'rects')
  assert.equal(loadingPhase(SPINNER_AFTER_MS - 1), 'rects')
  assert.equal(loadingPhase(SPINNER_AFTER_MS), 'spinner')
})

test('a loading state that resolves in 300 ms renders no spinner', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(createElement(S.Loading, { what: 'the J001 brief' })) })
  assert.match(text(host), /Loading the J001 brief/, 'says what is loading, in place, at once')
  await act(async () => { t.mock.timers.tick(SPINNER_AFTER_MS - 700) })
  const during = host.querySelector('.logo-spinner, [role="progressbar"], svg')
  assert.equal(during, null, 'no spinner at 300 ms')
  assert.equal(host.querySelector('.ns-rects')?.getAttribute('data-phase'), 'rects', 'grey rectangles stand in')
  await act(async () => { root.unmount() }) // the wait resolved: the content replaces it
  assert.equal(host.innerHTML, '')
  mock.timers.reset()
})

test('a wait that lasts a second gets the mark, and only then', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(createElement(S.Loading, { what: 'the J001 brief' })) })
  await act(async () => { t.mock.timers.tick(SPINNER_AFTER_MS - 1) })
  assert.equal(host.querySelector('.logo-spinner'), null, 'none at 999 ms')
  await act(async () => { t.mock.timers.tick(1) })
  assert.ok(host.querySelector('.logo-spinner'), 'the mark at one second')
  await act(async () => { root.unmount() })
  mock.timers.reset()
})
