// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Territories redesign (features/territories-redesign.clan; owner, 2026-11-24): the house patterns of Brief, Research and Production.
// One primary per step, top right of its step header, with its reason or its effect beside it; the Booth's agent Brief's size; cites in
// plain words; the look-up box folded and not on Greenlight; a route's World with its primary in its header and a dark palette in dark.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

let root = new URL('.', import.meta.url)
while (!existsSync(new URL('package.json', root))) root = new URL('..', root)
const dir = new URL('templates/territories/', root)
const html = readFileSync(new URL('index.html', dir), 'utf8')
const block = (id: string) => new RegExp(`<script id="${id}">([\\s\\S]*?)</script>`).exec(html)![1]
const sphereDir = new URL('templates/shared/agent-sphere/', root)
const engine = `(function (window) {\n${['finish.js', 'agent-view.js', 'extra.js', 'roles.js'].map(f => readFileSync(new URL(f, sphereDir), 'utf8')).join('\n')}\n})(globalThis);\n`
const helper = /<script>([\s\S]*?var NapkinSource[\s\S]*?)<\/script>/.exec(readFileSync(new URL('templates/shared/source-card.html', root), 'utf8'))![1]
type Doc = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const L = vm.runInNewContext(`${engine}${helper}\n${block('territories-logic')};\n${block('territories-lookups-logic')};\n${block('territories-world-logic')};\n${block('territories-pictures-logic')}; TerritoriesLogic`) as {
  view(d: Doc, ui?: Doc): string
  citeWords(c: string, d: Doc): string
  palDark(p: Doc): Doc
  stageOf(d: Doc, ui: Doc): string | null
}
const json = (rel: string) => JSON.parse(readFileSync(new URL(rel, dir), 'utf8')) as Doc
const plain = (h: string) => h.replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
const head = (h: string) => /<header class="sheet-head act">[\s\S]*?<\/header>/.exec(h)?.[0] ?? ''
const primaries = (h: string) => (h.match(/class="b pri lg[^"]*"/g) ?? []).length

test('every step has its one primary in the step header, with what it does or why it cannot beside it', () => {
  const pick = json('example/states/pick.json')
  const arrived = { ...pick, focus: { ...pick.focus, insights: [] }, run: {} }
  for (const [d, label, words] of [
    [arrived, 'Find the insights', /About 40 seconds/],
    [pick, 'Explore \\d+ insights? →', /Usually 2 to 3 minutes/],
    [json('example/states/explore_back.json'), 'Review and greenlight →', /optional/],
    [json('example/states/greenlight_open.json'), 'Send →', /Greenlight at least one route to send it/],
  ] as [Doc, string, RegExp][]) {
    const page = L.view(d, {}), h = head(page)
    assert.equal(primaries(page), 1, `${label}: one primary on the page`)
    assert.match(h, new RegExp(`class="b pri lg"[^>]*>${label}</button>`), `${label} sits in the step header`)
    assert.match(plain(h), words)
  }
  // disabled keeps its place and says why
  const none = json('example/states/pick.json'); none.focus.insights.forEach((i: Doc) => { i.ticked = false })
  assert.match(head(L.view(none, {})), /disabled>Explore →<\/button><span class="why lock">Tick at least one insight/)
})

test('the stage while the engine works: no Booth, the agent big, the step honest, and Back leaves the job running', () => {
  const d = json('example/states/pick.json'); d.focus.insights = []; d.run = {}
  assert.equal(L.stageOf(d, { job: { state: 'running' } }), 'finding')
  assert.equal(L.stageOf(d, { job: { state: 'running' }, view: 0 }), null)
  assert.equal(L.stageOf(d, { job: { state: 'done' } }), null)
  const page = L.view(d, { job: { state: 'running', started: Date.now() - 12000 } })
  assert.doesNotMatch(page, /class="booth-col/); assert.match(page, /data-nk-size="230"/); assert.match(plain(page), /Finding the insights/)
  assert.match(plain(page), /Usually about 40 seconds · 1[12] s so far/)
  assert.match(page, /class="lnk" data-step="pick">← Back to what arrived/)
})

test('the Booth\'s agent is Brief\'s size, still when nothing runs, and the Booth no longer repeats the crew list', () => {
  const page = L.view(json('example/states/pick.json'), {})
  const booth = /<aside class="booth-col[\s\S]*?<\/aside>/.exec(page)![0]
  assert.match(booth, /<div class="side-agent bt-side idle"><div class="nk-job">/)
  assert.match(booth, /data-nk-size="110"/, 'NapkinRoles.side at SIDE 88: its box is 110')
  assert.match(booth, /data-nk-state="idle"/)
  const back = L.view(json('example/states/explore_back.json'), {})
  const eb = /<aside class="booth-col[\s\S]*?<\/aside>/.exec(back)![0]
  assert.doesNotMatch(eb, /class="crewlist"/, 'the crew is on the sheet, not again in the Booth')
})

test('cites read as plain words; the id stays only in the title and the window', () => {
  const d = json('example/states/pick.json'), page = L.view(d, {})
  const chips = [...page.matchAll(/<button type="button" class="ref[^"]*" data-src="([^"]+)" title="([^"]*)">([^<]*)<\/button>/g)]
  assert.ok(chips.length > 0)
  for (const [, id, title, label] of chips) {
    assert.ok(!label.includes(id), `${id} shows as words, not the id`)
    assert.match(label, /^(Fact|Finding|Find|Brief: [a-z -]+|Source)( \d+)?$/)
    assert.ok(title.includes(id), 'the id is still in the title')
  }
  assert.doesNotMatch(plain(page), /\bfi_[A-Z0-9]{4,}|\bf_[A-Z0-9]{4,}/, 'no raw id in the words on the page')
})

test('the look-up box is a closed fold on Pick and Explore, not on Greenlight; nothing before the engine has written', () => {
  assert.match(L.view(json('example/states/pick.json'), {}), /<details class="fold lqfold"><summary>/)
  assert.match(L.view(json('example/states/pick.json'), { lq: 'Which pubs pour it?' }), /<details class="fold lqfold" open>/)
  assert.doesNotMatch(L.view(json('example/states/greenlight_open.json'), {}), /lqfold|data-lq-draft/)
  // a typed question makes Look it up the primary style (CSS on the live button, the runtime only toggles disabled)
  assert.match(html, /\.bt-box \.btn\[data-act="lookup"\]:not\(:disabled\)\{background:var\(--ag-act\)/)
})

test('a route\'s World: its primary in its header, the toggle as a link, and a dark palette for the dark theme', () => {
  const d = json('example/states/greenlight_open.json'), id = 't_started'
  const off = L.view(d, { world: id })
  assert.match(/<header class="whead2">[\s\S]*?<\/header>/.exec(off)![0], /class="b pri lg" data-green="t_started" aria-pressed="false">Greenlight this route/)
  assert.doesNotMatch(off, /class="big" data-green/, 'no second toggle in the Booth')
  const on = JSON.parse(JSON.stringify(d)); on.greenlit = [{ territory_id: id, by: 'Shrey', at: '2026-11-24T10:00:00Z' }]
  const wh = /<header class="whead2">[\s\S]*?<\/header>/.exec(L.view(on, { world: id }))![0]
  assert.match(wh, /data-send>Send 1 greenlit →/); assert.match(wh, /class="lnk" data-green="t_started" aria-pressed="true">Take it off the list/)
  assert.match(off, /--t-bg-d:#[0-9a-f]{6};--t-ink-d:#[0-9a-f]{6}/)
  const dk = L.palDark({ bg: '#F4B942', ink: '#141413', soft: '#C9C0AE' })
  const lum = (h: string) => { const n = parseInt(h.slice(1), 16); return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255 }
  assert.ok(lum(dk.bg) < 0.25 && lum(dk.ink) > 0.6, 'a dark ground and a light ink')
  eq(L.palDark({ bg: '#12321F', ink: '#F2EBD3', soft: '#1E4A30' }), { bg: '#12321F', ink: '#F2EBD3', soft: '#1E4A30' })
  assert.match(html, /:root\[data-color-scheme="dark"\] \.sheet\.world\{--t-bg:var\(--t-bg-d\)!important/)
})

test('Greenlight has no floating dock over the cards: its tools are a row above the ranked list', () => {
  const page = L.view(json('example/states/greenlight_open.json'), {})
  assert.doesNotMatch(page, /class="dock"/)
  assert.match(page, /<div class="toolrow" role="toolbar" aria-label="Gallery tools">[\s\S]*data-dock="present"[\s\S]*data-dock="compare"[\s\S]*data-dock="rank"[\s\S]*data-dock="export"/)
  assert.ok(page.indexOf('class="toolrow"') < page.indexOf('class="rrows"'))
})

function eq(a: unknown, b: unknown) { assert.deepEqual(JSON.parse(JSON.stringify(a)), b) }
