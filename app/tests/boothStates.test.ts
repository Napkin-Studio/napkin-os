// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

/* eslint-disable @typescript-eslint/no-explicit-any -- the pages run in jsdom, another realm: what they return is untyped */

// features/align-booth.clan, the last stage: Run failed, Changed brief, Long run, Not right and Missing access are said in
// the Booth (the state line under its header, drawn by the one shared snippet), Failed save is said once, in the OS bar's
// save line, and the bar item kind state no longer exists. What the four bands did that nothing else did moved too: Judge's
// "answers from fixture scores" line and its reason for not scoring are in the Judge fold, and an undo's note is in the bar.

import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { after, test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createElement, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createSaveQueue } from '../src/components/states/saveQueue.ts'
import { CHANGED_BRIEF, FAILED_SAVE, LOADING, LONG_RUN, MISSING_ACCESS, NOT_RIGHT, runFailedLine } from '../src/components/states/words.ts'
import { barFrom } from '../src/shell/appBar.ts'
import SaveStatus, { SaveAlert } from '../src/components/SaveStatus.tsx'

let root = new URL('.', import.meta.url)
while (!existsSync(new URL('package.json', root))) root = new URL('..', root)
const read = (p: string) => readFileSync(new URL(p, root), 'utf8')
const BOOTH = read('templates/shared/booth.html').trimEnd()
const FOLDS = read('templates/shared/booth-folds.html').trimEnd()
const HOUSE = read('templates/script-editor/house-style.json')
const SRC = {
  script: read('templates/script-editor/index.html'),
  room: read('templates/idea-room/index.html'),
  visual: read('templates/visual-brief/index.html'),
}
type Json = Record<string, any>

function packed(src: string): string {
  return src.replace('@napkin:house-style', HOUSE.replace(/<\//g, '<\\/'))
    .replace('<!-- @napkin:booth -->', () => BOOTH).replace('<!-- @napkin:booth-folds -->', () => FOLDS)
    .replace(/<link[^>]*>/g, '').replace('<!-- @napkin:clan-fields -->', '').replace('<!-- @napkin:agent-sphere -->', '')
}

const windows: { close: () => void }[] = []
after(() => { for (const w of windows) w.close() })

const RADIO: Json = {
  format: 'radio', slot_s: 30, proposition: 'The whiskey that waits for you.',
  script: { beats: [{ id: 'b1', kind: 'voice', role: 'FVO', text: 'The room goes quiet.' }], proposals: [], seq: 1 },
  checks: { mandatory: [], banned: [] }, handoffs: {}, upstream: { doc_brief: { mandatories: [], signers: [{ role: 'creative_director', person: 'dara@wk' }] } },
}
const VISUAL: Json = { territory: { name: 'The long pour', source: 'territories' }, proposition: 'The whiskey that waits.' }
const MOVED = { upstream: [{ direct: true, in_store: true, status: 'changed', title: 'The brief', version: 'bbbbbbb2222' }], carried: { last_decision: 'aaaaaaa1111' } }

interface Opts { width?: number; html?: string; data?: Json; card?: Json | null; up?: Json; locked?: boolean; room?: Json; post?: (path: string, body: Json) => Json }
async function open(src: string, opts: Opts = {}) {
  const posts: { path: string; body: Json }[] = []
  const parent: Json[] = []
  const dom = new JSDOM(opts.html ?? packed(src), {
    url: 'https://napkin.test/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      const win = w as unknown as Record<string, any>
      Object.defineProperty(w, 'innerWidth', { value: opts.width ?? 1440, configurable: true })
      win.__CLAN__ = { data: structuredClone(opts.data ?? {}) }
      win.clan = { me: () => Promise.resolve({ actor: 'human:dara@wk', id: 'dara@wk', name: 'Dara' }), patchData: () => Promise.resolve({ ok: true }) }
      win.NapkinRoles = { tag: () => '<span class="nk-ag"></span>', auto: () => {}, ofDecision: () => null }
      Object.defineProperty(win, 'parent', { value: { postMessage: (m: Json) => parent.push(m) } })
      win.fetch = (url: string, init?: { method?: string; body?: string }) => {
        const path = String(url).replace(/^.*localhost/, '')
        if (init?.method === 'POST') {
          const body = init.body ? JSON.parse(init.body) : {}
          posts.push({ path, body })
          const out = opts.post?.(path, body) ?? { ok: true }
          return Promise.resolve({ ok: out.ok !== false, status: 200, json: () => Promise.resolve(out) })
        }
        let b: unknown = null
        if (path === '/judge') b = opts.card === undefined ? null : opts.card
        else if (path === '/versions') b = { versions: [], draft: null }
        else if (path === '/decisions') b = { document_id: 'd', version: 'v', decisions: [], attention: [], cites: {}, lock: { can_lock: true, blockers: 0, locked: !!opts.locked } }
        else if (path === '/upstream') b = opts.up ?? { upstream: [] }
        else if (path === '/ideas/room') b = opts.room ?? { data: {}, gate: { team_cards: 0, needed: 5, to_go: 5, open: false, creative_director: 'dara@wk', routes_out: [], chosen: null }, brief: null }
        else if (path === '/ideas/routes') b = { routes: {} }
        return Promise.resolve({ ok: b != null, status: b != null ? 200 : 404, json: () => Promise.resolve(b) })
      }
    },
  })
  windows.push(dom.window)
  const w0 = dom.window as unknown as Record<string, any>
  w0.dispatchEvent(new w0.MessageEvent('message', { data: { type: 'clan:clientmode', on: false }, source: w0.parent }))
  await new Promise(r => setTimeout(r, 80))
  const d = dom.window.document
  return {
    d, win: dom.window as unknown as Record<string, any>, posts, parent,
    one: (sel: string) => d.querySelector(sel) as any,
    all: (sel: string) => [...d.querySelectorAll(sel)] as any[],
    settle: () => new Promise(r => setTimeout(r, 80)),
  }
}
const words = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

test('the state line is one piece of code: the snippet draws it under the Booth\'s header, in every tool, and no template defines it', () => {
  assert.equal(BOOTH.split('function boothSay(').length - 1, 1)
  for (const t of readdirSync(new URL('templates/', root))) {
    const f = new URL(`templates/${t}/index.html`, root)
    if (t === 'shared' || !statSync(new URL(`templates/${t}`, root)).isDirectory() || !existsSync(f)) continue
    assert.doesNotMatch(readFileSync(f, 'utf8'), /function boothSay\(|kind:\s*'state'|m\.id\s*===?\s*'state-(retry|update)'/, `${t} sends no state to the bar and draws none itself`)
  }
})

for (const [name, src, data] of [['script editor', SRC.script, RADIO], ['idea room', SRC.room, {}], ['visual brief', SRC.visual, VISUAL]] as const) {
  test(`${name}: each of the six states is said in the Booth in the shell's words, under the header, with its buttons`, async () => {
    const p = await open(src, { data })
    const panel = p.one('[data-booth-panel]')
    const line = () => p.one('[data-testid="booth-state"]')
    assert.ok(line(), 'the Booth has a state line')
    assert.equal(panel.contains(line()), true, 'inside the Booth')
    assert.equal(line().previousElementSibling.classList.contains('booth-hd'), true, 'directly under the Booth header')
    assert.equal(line().hidden, true, 'Normal says nothing')
    const heard: string[] = []
    const say = (s: Json | null) => p.win.boothSay(s, (id: string) => heard.push(id))

    say({ name: 'run-failed', why: 'provider' })
    assert.equal(line().getAttribute('data-state'), 'run-failed')
    assert.equal(words(line().querySelector('.bs-line')), runFailedLine('provider'))
    assert.equal(line().querySelectorAll('.bs-line').length, 1, 'one plain line')
    line().querySelector('button').click()
    assert.deepEqual(heard, ['state-retry'])
    assert.equal(words(line().querySelector('button')), 'Try again')

    say({ name: 'changed-brief', from: 'v1', to: 'v2', changes: 'Your cards stay as they are.' })
    assert.equal(line().getAttribute('data-state'), 'changed-brief')
    assert.equal(words(line().querySelector('.bs-line')), CHANGED_BRIEF.first('v2', 'v1'))
    assert.match(words(line()), /Your cards stay as they are\./)
    assert.equal(words(line().querySelector('button')), CHANGED_BRIEF.update('v2'))
    line().querySelector('button').click()
    assert.equal(heard.at(-1), 'state-update')

    say({ name: 'long-run', minutes: 4, step: 'Reading the research' })
    assert.equal(line().getAttribute('data-state'), 'long-run')
    assert.match(words(line()), new RegExp(`${LONG_RUN.left(4)} ${LONG_RUN.needsYou}`.replace(/\./g, '\\.')))
    assert.match(words(line()), /Reading the research/)
    assert.equal(line().querySelectorAll('button').length, 0)

    say({ name: 'missing-access', what: 'the brief', who: 'Aoife' })
    assert.equal(words(line().querySelector('.bs-line')), MISSING_ACCESS.line('the brief', 'Aoife'))
    assert.equal(words(line().querySelector('button')), MISSING_ACCESS.ask('Aoife'))
    line().querySelector('button').click()
    assert.equal(heard.at(-1), 'state-ask')

    say({ name: 'not-right' })
    assert.equal(words(line().querySelector('.bs-line')), NOT_RIGHT.ask)
    assert.deepEqual(p.all('[data-testid="booth-state"] button').map(b => words(b)), [...NOT_RIGHT.fixes])
    p.all('[data-testid="booth-state"] button')[1].click()
    assert.equal(heard.at(-1), 'state-fix-2')

    say({ name: 'loading', what: 'the room' })
    assert.equal(words(line().querySelector('.bs-line')), LOADING.what('the room'))

    say(null)
    assert.equal(line().hidden, true, 'Normal again: nothing is said')
    assert.equal(line().innerHTML, '')
    // text, never markup
    say({ name: 'missing-access', what: '<img src=x onerror=1>', who: '<b>A</b>' })
    assert.equal(line().querySelector('img'), null)
    assert.equal(line().querySelector('b'), null)
    assert.doesNotMatch(line().innerHTML, /—/, 'no em dash')
  })
}

test('script editor and visual brief say Changed brief from the page\'s own read of /upstream; an approved version has no Update', async () => {
  for (const [src, data] of [[SRC.script, RADIO], [SRC.visual, VISUAL]] as const) {
    const quiet = await open(src, { data })
    assert.equal(quiet.one('[data-testid="booth-state"]').hidden, true, 'the brief has not moved: nothing is said')
    const open_ = await open(src, { data, up: MOVED, post: path => (path === '/upstream/update' ? { ok: true } : { ok: true }) })
    const line = open_.one('[data-testid="booth-state"]')
    assert.equal(line.getAttribute('data-state'), 'changed-brief')
    assert.match(words(line), /The brief changed to bbbbbbb\. This work was made from aaaaaaa\./)
    assert.match(words(line), /Updating takes the new brief into this page\. What you wrote here stays\./)
    line.querySelector('button').click()
    await open_.settle()
    assert.deepEqual(open_.posts.find(x => x.path === '/upstream/update')?.body, {}, 'the update goes through the frame\'s own route')
    const sealed = await open(src, { data, up: MOVED, locked: true })
    const s = sealed.one('[data-testid="booth-state"]')
    assert.match(words(s), /This version is approved and stays as it is\. Start a new version to take the new brief into it\./)
    assert.equal(s.querySelectorAll('button').length, 0, 'nothing to press on an approved version')
  }
})

test('idea room says Changed brief in the Booth from the room\'s brief, and Update takes the newer brief', async () => {
  const room = { data: {}, gate: { team_cards: 0, needed: 5, to_go: 5, open: false, creative_director: 'dara@wk', routes_out: [], chosen: null }, brief: { changed: true, from: '1', to: '2', insight: 'i', proposition: 'p', name: 'n' } }
  const p = await open(SRC.room, { room })
  const line = p.one('[data-testid="booth-state"]')
  assert.equal(line.getAttribute('data-state'), 'changed-brief')
  assert.match(words(line), /The brief changed to v2\. This work was made from v1\./)
  assert.equal(words(line.querySelector('button')), 'Update to brief v2')
  line.querySelector('button').click()
  await p.settle()
  assert.ok(p.posts.find(x => x.path === '/upstream/update'))
})

test('Judge\'s fold keeps what its band said: the fixture line, not set up, and why it cannot score yet, and no price', async () => {
  const setup = (over: Json) => ({ backend: 'fixture', configured: true, price_eur: 0.04, trust: 'none', not_trusted: 'n', calibration: 'c', rubric_version: '1', ...over })
  const card = (over: Json) => ({ ok: true, kind: 'script', piece: 'script', pieces: ['script'], can_score: true, why_not: null, setup: setup({}), score: null, older: [], can_overrule: false, creative_director_named: true, ...over })
  const text = async (c: Json) => words((await open(SRC.script, { data: RADIO, card: c })).one('#side [data-testid="judge-empty"]'))
  assert.match(await text(card({})), /Judge answers from fixture scores here\. No model is called\./)
  assert.match(await text(card({ setup: setup({ backend: null, configured: false }) })), /Judge is not set up here, so nothing can be scored yet\./)
  assert.match(await text(card({ why_not: 'Choose a route first. Judge scores the chosen route.', can_score: false })), /Choose a route first\. Judge scores the chosen route\./)
  assert.doesNotMatch(await text(card({ setup: setup({ backend: 'llm-judge' }) })), /price|cost|euro|\bcents?\b|spend/i, 'a priced setup says nothing of a price')
})

test('Failed save is said once, in the OS bar, with Try again; Changed (409) says Update there; the quiet line steps aside', () => {
  const bar = (state: 'failed' | 'changed' | 'idle', extra: object = {}) => renderToStaticMarkup(createElement('div', null,
    createElement(SaveStatus, { state, updatedAt: null }), createElement(SaveAlert, { state, ...extra })))
  const failed = bar('failed', { onRetry: () => {} })
  assert.equal(failed.split('data-state="failed-save"').length - 1, 1, 'said once')
  assert.equal(failed.split('Not saved').length - 1, 1, 'the words are in one place')
  assert.doesNotMatch(failed, /ch-saved/, 'the quiet "saved" line does not say saved while a write has not landed')
  assert.match(failed, new RegExp(FAILED_SAVE.line.replace(/\./g, '\\.')))
  assert.equal(failed.split('<button').length - 1, 1)
  assert.match(failed, />Try again</)
  const moved = bar('changed', { onRefresh: () => {} })
  assert.match(moved, /The brief changed while you were typing\./)
  assert.match(moved, />Update to the new brief</)
  const fine = bar('idle')
  assert.doesNotMatch(fine, /failed-save|<button|Not saved|tb-alert/)
  assert.match(fine, /ch-saved/)
})

test('an undo\'s note, which only the bands said, is said by the bar, for a moment', () => {
  const html = renderToStaticMarkup(createElement(SaveAlert, { state: 'idle', note: 'The audience changed after you wrote it, so nothing was undone.' }))
  assert.match(html, /role="status" data-testid="undo-note">The audience changed after you wrote it, so nothing was undone\./)
})

test('a bar item of kind state is dropped, as on develop; the status item and its tone are how a tool reports its state', () => {
  const got = barFrom({ v: 1, items: [{ kind: 'state', state: 'run-failed', why: 'provider' }, { kind: 'status', label: 'Stopped', tone: 'warn', locked: false }, { kind: 'button', id: 'a', label: 'Go' }] })
  assert.deepEqual(got.map(i => i.kind), ['status', 'button'])
  assert.equal((got[0] as { tone: string }).tone, 'warn')
})

// ── item 1 of the review: a state said while the Booth is hidden is brought to the person ──────────────────────

/** A bare page with only the Booth snippet and the call every tool makes: what Brief Maker and Research are to the snippet. */
const BARE = `<!doctype html><html><head><style>:root{--booth-line:#ddd;--booth-paper:#fff;--booth-ink:#111;--booth-ink-soft:#333;--booth-muted:#666;--booth-warn:#b40;--booth-desk:#eee}</style>${BOOTH}</head><body>
<div id="desk"><main id="doc"><p id="p1">The document</p></main><aside id="panel"><div id="body"></div></aside></div>
<script>boothStart({panel:'panel', desk:function(){return document.getElementById('desk');}, size:function(d){d.style.setProperty('--bw','380px');}, whole:function(){}, fold:function(){return true;}, inert:function(){return true;}, key:function(){return true;}}); boothApply(true);</script></body></html>`

const STATES: Json[] = [
  { name: 'run-failed', why: 'provider' },
  { name: 'changed-brief', from: 'v1', to: 'v2', changes: 'Your work stays.' },
  { name: 'long-run', minutes: 3, step: 'Reading' },
  { name: 'missing-access', what: 'the brief', who: 'Aoife' },
  { name: 'not-right' },
  { name: 'loading', what: 'the room' },
]
const PAGES: [string, Opts][] = [
  ['script editor', { data: RADIO }], ['idea room', {}], ['visual brief', { data: VISUAL }], ['a page with only the snippet (Brief Maker, Research)', { html: BARE }],
]
const SRC_OF: Record<string, string> = { 'script editor': SRC.script, 'idea room': SRC.room, 'visual brief': SRC.visual, 'a page with only the snippet (Brief Maker, Research)': '' }

for (const [name, o] of PAGES) {
  test(`${name}: every state said while the Booth is hidden shows the dot on the tab, then the Booth comes in on it`, async () => {
    for (const st of STATES) {
      const p = await open(SRC_OF[name], o)
      p.one('[data-booth="hide"]').click(); await p.settle()
      const desk = p.one('.booth-desk'), edge = p.one('#boothEdge')
      assert.equal(desk.classList.contains('booth-off'), true, `${st.name}: hidden`)
      p.win.boothSay(st, () => {})
      assert.equal(edge.classList.contains('has'), true, `${st.name}: the tab shows the dot at once`)
      assert.match(edge.getAttribute('aria-label') ?? '', /1 question|1 waiting|waiting/i)
      assert.equal(desk.classList.contains('booth-off'), true, `${st.name}: not yet in, the person is not startled`)
      await new Promise(r => setTimeout(r, 1200))
      assert.equal(desk.classList.contains('booth-off'), false, `${st.name}: the Booth is in after one second`)
      assert.equal(p.one('[data-testid="booth-state"]').hidden, false, `${st.name}: and says it`)
      assert.equal(p.parent.filter(m => m.type === 'clan:booth' && m.open === false).length, 1, 'the shell was told of the hide only')
    }
  })
  test(`${name}: a state that goes away takes its dot with it; a state cleared before the Booth came in leaves it hidden`, async () => {
    const p = await open(SRC_OF[name], o)
    p.one('[data-booth="hide"]').click(); await p.settle()
    p.win.boothSay(null)
    assert.equal(p.one('#boothEdge').classList.contains('has'), false)
    p.win.boothSay(STATES[1], () => {}); assert.equal(p.one('#boothEdge').classList.contains('has'), true)
    p.win.boothSay(null); assert.equal(p.one('#boothEdge').classList.contains('has'), false, 'cleared before the Booth came in: no dot, no surprise')
    await new Promise(r => setTimeout(r, 1200))
    assert.equal(p.one('.booth-desk').classList.contains('booth-off'), true, 'and the Booth stayed hidden')
  })
  test(`${name}: at 390 px, where the Booth follows the document, the state is the first thing above the document, not at the bottom`, async () => {
    const p = await open(SRC_OF[name], { ...o, width: 390 })
    p.win.boothSay(STATES[0], () => {})
    const line = p.one('[data-testid="booth-state"]'), desk = p.one('.booth-desk')
    assert.equal(line.hidden, false)
    assert.equal(!!(line.compareDocumentPosition(desk) & 4), true, 'it comes before the desk (document and Booth) in the page')
    assert.equal(p.one('[data-booth-panel]').contains(line), false, 'it is not inside the Booth, which is below the document')
    p.win.boothSay(null)
    assert.equal(line.hidden, true)
    p.win.boothSay(STATES[1], () => {})
    Object.defineProperty(p.win, 'innerWidth', { value: 1440, configurable: true }); p.win.dispatchEvent(new p.win.Event('resize'))
    assert.equal(p.one('[data-booth-panel]').contains(p.one('[data-testid="booth-state"]')), true, 'wide again: back in the Booth under its header')
  })
}

// ── item 3: the 409 alert says what happens to the typed words, clears once settled, and sits where it hides neither the Booth's Hide nor the page's first lines ──
test('the 409 alert keeps the line about the typed words, and Update settles it', () => {
  const q = createSaveQueue()
  q.report({ id: 'w1', state: 'saving', field: 'audience', text: 'My unsaved words.' })
  q.report({ id: 'w1', state: 'changed', field: 'audience', text: 'My unsaved words.' })
  const html = () => renderToStaticMarkup(createElement(SaveAlert, { state: q.state(), onRefresh: () => {} }))
  assert.match(html(), /What you typed stays on the page until you update\./)
  assert.match(html(), /The brief changed while you were typing\./)
  q.forgetChanged() // Update: the page reads the document again
  assert.equal(q.state(), 'idle')
  assert.equal(html(), '', 'the alert is gone once settled')
  q.report({ id: 'w2', state: 'failed', field: 'x', text: 'kept' })
  q.forgetChanged()
  assert.equal(q.state(), 'failed', 'a write that failed to save is not forgotten by Update')
})
test('the alert sits at the bottom of the window: it never covers the Booth\'s header or the first lines of the page', () => {
  const css = read('src/shell/nui/nui.css')
  const rule = /\.nui \.tb-alert \{([^}]*)\}/.exec(css)![1]
  assert.match(rule, /position: fixed/)
  assert.match(rule, /bottom:/)
  assert.doesNotMatch(rule, /top:/)
})

// ── item 4: a failed Judge run sent from the shell says its reason as text on screen ──
test('a failed Judge run is said in the bar as readable text with a role, not in a title, and can be dismissed', () => {
  let dismissed = 0
  const html = renderToStaticMarkup(createElement(SaveAlert, { state: 'idle', judge: 'Judge could not score this just now. Nothing was changed.', onJudgeDismiss: () => { dismissed++ } }))
  assert.match(html, /data-state="run-failed"/)
  assert.match(html, /role="alert"/)
  assert.match(html, />Judge could not score this just now\. Nothing was changed\.</)
  assert.doesNotMatch(html, /title=/)
  assert.match(html, />Dismiss</)
  assert.equal(dismissed, 0)
  assert.equal(renderToStaticMarkup(createElement(SaveAlert, { state: 'idle' })), '')
  assert.doesNotMatch(read('src/shell/judge/useJudge.ts'), /kind: 'chip'/, 'no chip with the reason hidden in its title')
})

// ── item 5: no price or cost anywhere in what the Booth and the Judge files say ──
test('the Booth snippets and the shell\'s Judge files name no cost, price, charge, credit or currency', () => {
  const files = ['templates/shared/booth.html', 'templates/shared/booth-folds.html', ...readdirSync(new URL('src/shell/judge/', root)).filter(f => /\.(ts|tsx)$/.test(f)).map(f => `src/shell/judge/${f}`)]
  const found: string[] = []
  for (const f of files) {
    const text = read(f)
    for (const m of text.matchAll(/\b(costs?|prices?|priced|charg\w*|credits?|euros?|cents?)\b|\$\d|[€£]/gi)) found.push(`${f}: ${m[0]}`)
  }
  assert.deepEqual(found, [])
  assert.equal(existsSync(new URL('src/shell/judge/judgeModel.ts', root)), true)
  assert.doesNotMatch(read('src/shell/judge/judgeModel.ts'), /priceLine/)
})

// ── item 6: an undo note said again is said again ──
test('the same undo note, said twice, is shown each time (the note carries a count)', () => {
  const html = (key: number) => renderToStaticMarkup(createElement(SaveAlert, { state: 'idle', note: 'Nothing to undo.', noteKey: key }))
  assert.match(html(1), /Nothing to undo\./)
  assert.match(html(2), /Nothing to undo\./)
  const hook = read('src/shell/versions/useBriefUndo.ts')
  assert.match(hook, /noteKey/)
  void useState
})
