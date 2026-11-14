// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

/* eslint-disable @typescript-eslint/no-explicit-any -- the pages run in jsdom, another realm: what they return is untyped */

// The Booth's shared folds (features/align-booth.clan, the Judge and Versions stage): Judge is an agent in the Booth,
// not a band; Versions live in the Booth. One piece of code, app/templates/shared/booth-folds.html, spliced by the
// packer at its marker; each tool that needs a fold puts a mount point in its Booth and names the folds it uses.
// The pages run as they ship, in jsdom, against the host's own shapes (GET /judge, GET /versions, GET /version).

import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { JSDOM } from 'jsdom'

let root = new URL('.', import.meta.url)
while (!existsSync(new URL('package.json', root))) root = new URL('..', root)
const read = (p: string) => readFileSync(new URL(p, root), 'utf8')
const BOOTH = read('templates/shared/booth.html').trimEnd()
const FOLDS = read('templates/shared/booth-folds.html').trimEnd()
const FOLDS_MARKER = '<!-- @napkin:booth-folds -->'
const SRC = {
  script: read('templates/script-editor/index.html'),
  room: read('templates/idea-room/index.html'),
  visual: read('templates/visual-brief/index.html'),
  brief: read('templates/brief-maker/index.html'),
  research: read('templates/campaign-research/index.html'),
}
const HOUSE = read('templates/script-editor/house-style.json')

type Json = Record<string, any>

// ── the host's shapes ──────────────────────────────────────────────────────────────────────────────
const TESTS = [
  { id: 'idea.single', dim: 'idea', method: 'llm', value: 'pass', evidence: 'One thought, said once.', reason_code: 'ok', question: 'Is there one idea?' },
  { id: 'craft.voice', dim: 'craft', method: 'llm', value: 'fail', evidence: 'The second line repeats the first.', reason_code: 'craft.repeat', question: 'Does every line earn its place?' },
  { id: 'effect.brand', dim: 'effect', method: 'code', value: 'pass', evidence: 'Client A is named in line 3.', reason_code: 'ok', question: 'Is the brand there?' },
  { id: 'idea.fresh', dim: 'idea', method: 'llm', value: 'fail', evidence: 'A pour shot, as every whiskey ad.', reason_code: 'idea.default', question: 'Is it fresh?' },
]
const CALIBRATION = 'The 24 is advice until Judge has earned trust: 60 decided pieces.'
const CARD = (extra: Json = {}): Json => ({
  ok: true, kind: 'script', piece: 'script', pieces: ['script'], can_score: true, why_not: null,
  // A price is set here on purpose: the fold must not say it.
  setup: { backend: 'fixture', configured: true, price_eur: 0.04, trust: 'shadow', not_trusted: 'Advice only.', calibration: CALIBRATION, rubric_version: 'r1' },
  score: {
    id: 'd1', at: '2026-11-13T10:00:00Z', version: 'h1', current: true, out_of_date: false, total: 22, sub: { idea: 7, craft: 6, effect: 9 },
    tests: TESTS, advised_route: 'team', route: 'team', brave: false, route_line: 'Back to the team with the notes', trust: 'shadow', judge_version: 'judge_work@1', overruled: null, decided: null,
  },
  older: [], can_overrule: true, creative_director_named: true, ...extra,
})
const VERSIONS: Json = {
  versions: [
    { n: 2, decision: 'a2', signer: 'dara@wk', at: '2026-11-13T09:00:00Z', reason: '', locked: true, readable: true },
    { n: 1, decision: 'a1', signer: 'dara@wk', at: '2026-11-12T09:00:00Z', reason: '', locked: false, readable: true },
  ],
  draft: { changed: false, restored_from: null, edited_by: null, at: null, last_edit: null },
}
const PARTS: Record<string, Json> = {
  '1': { n: 1, readable: true, parts: { audience: 'Drinkers who think Irish whiskey is for someone else.', insight: 'The first pour is the hard one.' } },
  '2': { n: 2, readable: true, parts: { audience: 'Drinkers who go out midweek.', insight: 'The first pour is the hard one.' } },
  draft: { n: 'draft', readable: true, parts: { audience: 'Drinkers who go out midweek.', insight: 'The first pour is the hard one.' } },
}
const RADIO: Json = {
  format: 'radio', slot_s: 30, proposition: 'The whiskey that waits for you.',
  script: { beats: [{ id: 'b1', kind: 'voice', role: 'FVO', text: 'The room goes quiet.' }, { id: 'b2', kind: 'voice', role: 'MVO', text: 'Take your time. Client A does.' }], proposals: [], seq: 2 },
  checks: { mandatory: [], banned: [] }, handoffs: {}, upstream: { doc_brief: { mandatories: [], signers: [{ role: 'creative_director', person: 'dara@wk' }] } },
}
const VISUAL: Json = { territory: { name: 'The long pour', source: 'territories' }, proposition: 'The whiskey that waits.' }

/** A tool page as the packer ships it: the Booth and its folds spliced at their markers; fields and figures left out. */
function packed(src: string): string {
  return src.replace('@napkin:house-style', HOUSE.replace(/<\//g, '<\\/'))
    .replace('<!-- @napkin:booth -->', () => BOOTH).replace(FOLDS_MARKER, () => FOLDS)
    .replace(/<link[^>]*>/g, '').replace('<!-- @napkin:clan-fields -->', '').replace('<!-- @napkin:agent-sphere -->', '')
}

const windows: { close: () => void }[] = []
after(() => { for (const w of windows) w.close() })

interface Opts { card?: Json | null; versions?: Json; data?: Json; width?: number; post?: (path: string, body: Json) => Json }

/** Run a tool page with the host's answers; resolves once it has read them. */
async function open(src: string, opts: Opts = {}) {
  const posts: { path: string; body: Json }[] = []
  const parent: Json[] = []
  const dom = new JSDOM(packed(src), {
    url: 'https://napkin.test/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      const win = w as unknown as Record<string, any>
      Object.defineProperty(w, 'innerWidth', { value: opts.width ?? 1440, configurable: true })
      win.__CLAN__ = { data: structuredClone(opts.data ?? {}) }
      win.clan = { me: () => Promise.resolve({ actor: 'human:dara@wk', id: 'dara@wk', name: 'Dara' }), patchData: () => Promise.resolve({ ok: true }) }
      // Judge's real figure is the agent engine's (the agent-sphere marker); a stand-in with its class here.
      win.NapkinRoles = { tag: (k: string, o: Json) => `<span class="nk-ag" data-nk-agent="${k === 'judge' ? 'review' : k}" data-nk-state="${o?.state ?? 'idle'}"></span>`, auto: () => {}, ofDecision: () => null }
      Object.defineProperty(win, 'parent', { value: { postMessage: (m: Json) => parent.push(m) } })
      win.fetch = (url: string, init?: { method?: string; body?: string }) => {
        const path = String(url).replace(/^.*localhost/, '')
        if (init?.method === 'POST') {
          const body = init.body ? JSON.parse(init.body) : {}
          posts.push({ path, body })
          const out = opts.post?.(path, body) ?? { ok: true }
          return Promise.resolve({ ok: out.ok !== false, status: out.ok === false ? 400 : 200, json: () => Promise.resolve(out) })
        }
        let b: unknown = null
        if (path === '/judge') b = opts.card === undefined ? CARD() : opts.card
        else if (path === '/versions') b = opts.versions ?? VERSIONS
        else if (path.startsWith('/version?n=')) b = PARTS[path.slice('/version?n='.length)]
        else if (path === '/decisions') b = { document_id: 'd', version: 'v', decisions: [], attention: [], cites: {}, lock: { can_lock: true, blockers: 0, locked: false } }
        else if (path === '/upstream') b = { upstream: [] }
        else if (path === '/ideas/room') b = { data: {}, gate: { team_cards: 0, needed: 5, to_go: 5, open: false, creative_director: 'dara@wk', routes_out: [], chosen: null }, brief: null }
        else if (path === '/ideas/routes') b = { routes: {} }
        return Promise.resolve({ ok: b != null, status: b != null ? 200 : 404, json: () => Promise.resolve(b) })
      }
    },
  })
  windows.push(dom.window)
  await new Promise(r => setTimeout(r, 60))
  const d = dom.window.document
  const win = dom.window as unknown as Record<string, any>
  return {
    d, win, posts, parent,
    one: (sel: string) => d.querySelector(sel) as any,
    all: (sel: string) => [...d.querySelectorAll(sel)] as any[],
    click: (sel: string) => (d.querySelector(sel) as any).click(),
    settle: () => new Promise(r => setTimeout(r, 60)),
  }
}

const TOOLS = [
  { name: 'script editor', src: SRC.script, panel: '#side', desk: '.desk', doc: '#sheet', data: RADIO },
  { name: 'idea room', src: SRC.room, panel: '#booth', desk: '#idesk', doc: '#doc', data: {} },
  { name: 'visual brief', src: SRC.visual, panel: '#side', desk: '.desk', doc: '.sheet', data: VISUAL },
]

// ── one piece of code ──────────────────────────────────────────────────────────────────────────────

test('the folds are one piece of code: defined once in shared/booth-folds.html, spliced by the packer, never in a template', () => {
  for (const name of ['boothFolds', 'boothFoldHtml', 'bfJudgeHtml', 'bfVersionsHtml', 'bfCompare', 'bfRestore', 'bfSize']) {
    assert.equal(FOLDS.split(`function ${name}(`).length - 1, 1, `${name} is defined once, in the snippet`)
  }
  const dir = new URL('templates/', root)
  const using: string[] = []
  for (const t of readdirSync(dir)) {
    const f = join(dir.pathname, t, 'index.html')
    if (t === 'shared' || !statSync(join(dir.pathname, t)).isDirectory() || !existsSync(f)) continue
    const html = readFileSync(f, 'utf8')
    assert.doesNotMatch(html, /function (boothFolds|boothFoldHtml|bfJudgeHtml|bfVersionsHtml)\(/, `${t} does not define a fold itself`)
    if (html.includes(FOLDS_MARKER)) {
      using.push(t)
      assert.equal(html.split(FOLDS_MARKER).length - 1, 1, `${t} has the marker once`)
      assert.ok(html.indexOf(FOLDS_MARKER) > html.indexOf('<!-- @napkin:booth -->'), `${t}: the folds come after the Booth`)
      assert.match(html, /boothFolds\(\{/, `${t} names the folds it uses`)
    }
  }
  assert.deepEqual(using.sort(), ['brief-maker', 'idea-room', 'script-editor', 'visual-brief'])
  // Each fold is drawn by the snippet: a template's Judge or Versions words are not its own.
  for (const src of [SRC.script, SRC.room, SRC.visual, SRC.brief]) assert.doesNotMatch(src, /data-testid="score-card"|Version history/)
  const packer = read('../crates/clan-sdk/examples/shared/app_ui.rs')
  assert.match(packer, /BOOTH_FOLDS_MARKER[^\n]*@napkin:booth-folds/)
  assert.match(packer, /shared\/booth-folds\.html/)
  // Judge's figure is the real agent engine in every tool that has the Judge fold.
  for (const src of [SRC.script, SRC.room, SRC.visual]) assert.match(src, /<!-- @napkin:agent-sphere -->/)
  assert.match(read('../crates/clan-sdk/examples/make_idea_room.rs'), /inline_sphere/)
  assert.doesNotMatch(FOLDS, /<\/body/i)
})

test('Brief Maker and Research keep their Booth where a fold does not apply: no Judge in the brief, no fold in Research', () => {
  assert.ok(!SRC.research.includes(FOLDS_MARKER), 'Research takes no fold')
  assert.doesNotMatch(SRC.brief, /data-booth-fold="judge"|judge:\s*true/, 'the brief has no Judge fold')
  assert.match(SRC.brief, /data-booth-fold="versions"/)
  // The Versions fold sits in the whole brief's view, out of Needs you and the client's answer.
  const view = SRC.brief.slice(SRC.brief.indexOf('id="briefView"'), SRC.brief.indexOf('id="selPart"'))
  assert.match(view, /data-booth-fold="versions"/)
  const lock = SRC.brief.slice(SRC.brief.indexOf('id="lockList"'), SRC.brief.indexOf('id="review"'))
  assert.doesNotMatch(lock, /data-booth-fold/, 'nothing of the folds in #lockList or the client answer')
})

// ── Judge is an agent in the Booth, not a band ─────────────────────────────────────────────────────

for (const tool of TOOLS) {
  test(`${tool.name}: the whole document's Booth has a Judge fold with the score card, failed tests first, and no price`, async () => {
    const p = await open(tool.src, { data: tool.data })
    const fold = p.one(`${tool.panel} [data-booth-fold="judge"] [data-testid="judge-fold"]`)
    assert.ok(fold, 'the Judge fold is in the Booth')
    assert.equal(p.one(`${tool.doc} [data-testid="judge-fold"]`), null, 'and not in the document')
    assert.equal(fold.querySelector('summary').firstChild.textContent, 'Judge', 'its name on screen is Judge')
    assert.ok(fold.querySelector('.bf-sign .nk-ag[data-nk-agent]'), 'signed with Judge\'s own figure')
    const card = fold.querySelector('[data-testid="score-card"]')
    assert.match(card.querySelector('.bf-total').textContent, /^22\s*of 30$/)
    assert.deepEqual([...card.querySelectorAll('.bf-dims li')].map((li: any) => li.textContent), ['Idea7of 10', 'Craft6of 10', 'Effect9of 10'])
    const shown = [...card.querySelectorAll('[data-testid="judge-test"]')]
    assert.deepEqual(shown.map((t: any) => t.getAttribute('data-value')), ['fail', 'fail'], 'the failed tests first, each with its evidence')
    assert.match(shown[0].textContent, /Does every line earn its place\?.*The second line repeats the first\./)
    assert.match(card.textContent, /advice until Judge has earned trust/)
    assert.match(card.querySelector('[data-testid="judge-route"]').textContent, /Back to the team with the notes/)
    assert.doesNotMatch(fold.textContent, /price|cost|euro|\bcents?\b|charg|credit|spend/i, 'no price or cost line')
    // The passed tests are a click away.
    p.click(`${tool.panel} [data-bf-act="judge-passed"]`)
    assert.deepEqual(p.all(`${tool.panel} [data-testid="judge-test"]`).map(t => t.getAttribute('data-value')), ['fail', 'fail', 'pass', 'pass'])
  })
}

test('Judge with nothing scored says why, still with no price; Score again and the overrule go to the host\'s own routes', async () => {
  const none = await open(SRC.script, { data: RADIO, card: CARD({ score: null, setup: { ...CARD().setup, backend: null, price_eur: 1.5 } }) })
  assert.match(none.one('#side [data-testid="judge-empty"]').textContent, /not scored this version yet/)
  assert.doesNotMatch(none.one('#side [data-testid="judge-fold"]').textContent, /price|cost|euro|\bcents?\b|charg|credit/i)
  const p = await open(SRC.script, { data: RADIO, post: (path) => (path === '/judge' ? CARD() : { ok: true }) })
  p.click('#side [data-testid="judge-again"]')
  await p.settle()
  assert.deepEqual(p.posts.find(x => x.path === '/judge'), { path: '/judge', body: { target: 'script' } })
  p.click('#side [data-testid="judge-overrule"]')
  const why = p.one('#bfReason')
  assert.ok(why, 'the overrule asks for a written reason')
  assert.equal(p.one('#side [data-testid="judge-overrule-send"]').disabled, true, 'and waits for one')
  why.value = 'It is braver than Judge reads.'; why.dispatchEvent(new p.win.Event('input', { bubbles: true }))
  p.click('#side [data-testid="judge-overrule-send"]')
  await p.settle()
  assert.deepEqual(p.posts.find(x => x.path === '/judge/overrule')?.body, { reason: 'It is braver than Judge reads.', route: 'cd' })
})

test('a selected part shows its own Booth: the Judge fold is the whole document\'s', async () => {
  const p = await open(SRC.script, { data: RADIO })
  p.one('[data-beat="b1"]').dispatchEvent(new p.win.MouseEvent('click', { bubbles: true }))
  assert.equal(p.one('#side [data-testid="judge-fold"]'), null)
  p.click('#side [data-whole]')
  assert.ok(p.one('#side [data-testid="judge-fold"]'))
})

// ── Versions live in the Booth ─────────────────────────────────────────────────────────────────────

for (const tool of TOOLS.filter(t => t.name !== 'idea room')) {
  test(`${tool.name}: a Versions fold lists them with Restore; two compared widen the Booth to 744 px beside the document`, async () => {
    const p = await open(tool.src, { data: tool.data })
    const fold = p.one(`${tool.panel} [data-booth-fold="versions"] [data-testid="versions-fold"]`)
    assert.ok(fold, 'the Versions fold is in the Booth')
    assert.equal(fold.querySelector('summary').firstChild.textContent, 'Versions')
    const rows = p.all(`${tool.panel} [data-testid="version-row"]`)
    assert.equal(rows.length, 3, 'the draft, v2, v1')
    assert.match(rows[1].textContent, /v2.*Locked.*Signed by dara@wk/)
    assert.equal(rows[1].querySelector('[data-bf-act="ver-restore"]'), null, 'the newest, unchanged since, has nothing to restore')
    assert.ok(rows[2].querySelector('[data-bf-act="ver-restore"]'), 'v1 can be restored')
    // Compare two: both side by side in the Booth, and the Booth's column widens in the page's grid.
    fold.open = true; fold.dispatchEvent(new p.win.Event('toggle'))
    const desk = p.one(tool.desk)
    Object.defineProperty(desk, 'clientWidth', { value: 1408, configurable: true })
    p.click(`${tool.panel} [data-testid="version-row"][data-version="1"] [data-bf-act="ver-compare"]`)
    p.click(`${tool.panel} [data-testid="version-row"][data-version="2"] [data-bf-act="ver-compare"]`)
    await p.settle()
    const cmp = p.one(`${tool.panel} [data-testid="version-compare"]`)
    assert.ok(cmp, 'two side by side')
    assert.equal(cmp.querySelectorAll('[data-testid="compare-part"]').length, 1, 'only the part that differs')
    assert.deepEqual([...cmp.querySelectorAll('.bf-colhead')].map((x: any) => x.textContent), ['v1', 'v2'], 'the older on the left')
    assert.ok(desk.classList.contains('booth-wide'))
    assert.equal(desk.style.getPropertyValue('--trk'), '744px')
    assert.equal(desk.style.getPropertyValue('--bw'), '744px')
    // Never over the document: the Booth is a column of the page's grid, beside the document, not laid over it.
    const panel = p.one(tool.panel)
    assert.equal(panel.parentElement, desk)
    assert.equal(p.one(tool.doc).contains(panel), false)
    assert.doesNotMatch(FOLDS, /position:\s*(fixed|absolute)[^}]*bf-cmp|\.bf-cmp\{[^}]*position/, 'the compare is not laid over anything')
    // A narrow desk leaves the document at least 360 px.
    Object.defineProperty(desk, 'clientWidth', { value: 1000, configurable: true })
    p.win.boothApply(false)
    const narrow = parseFloat(desk.style.getPropertyValue('--trk'))
    assert.ok(narrow < 744 && narrow <= 1000 - 360, `the Booth gives way: ${narrow}px`)
    // Closing the compare gives the page its own width back.
    p.click(`${tool.panel} [data-bf-act="ver-close"]`)
    assert.equal(desk.classList.contains('booth-wide'), false)
    assert.equal(desk.style.getPropertyValue('--trk'), '')
  })
}

test('at 1100 px and below the Booth follows the document in one column: a compare does not widen it', async () => {
  const p = await open(SRC.script, { data: RADIO, width: 390 })
  const fold = p.one('#side [data-testid="versions-fold"]'); fold.open = true; fold.dispatchEvent(new p.win.Event('toggle'))
  p.click('#side [data-testid="version-row"][data-version="1"] [data-bf-act="ver-compare"]')
  p.click('#side [data-testid="version-row"][data-version="2"] [data-bf-act="ver-compare"]')
  await p.settle()
  assert.ok(p.one('#side [data-testid="version-compare"]'))
  assert.equal(p.one('.desk').classList.contains('booth-wide'), false)
})

test('Restore writes through the host\'s route, the page redraws from its reply, and the shell\'s undo hears a saved write', async () => {
  const restored = { ...RADIO, script: { ...RADIO.script, beats: [{ id: 'b1', kind: 'voice', role: 'FVO', text: 'Version one said this.' }, RADIO.script.beats[1]] } }
  const p = await open(SRC.script, { data: RADIO, post: path => (path === '/restore' ? { ok: true, clan: { data: restored, version: 'v9' } } : { ok: true }) })
  p.click('#side [data-testid="version-row"][data-version="1"] [data-bf-act="ver-restore"]')
  await p.settle()
  assert.deepEqual(p.posts.find(x => x.path === '/restore')?.body, { version: 1 })
  assert.equal(p.one('textarea[data-id="b1"][data-field="text"]').value, 'Version one said this.')
  const w = p.parent.find(m => m.type === 'clan:write')
  assert.ok(w && w.v === 1 && w.state === 'saved' && typeof w.id === 'string' && w.id.length <= 64, 'a saved write, in the shell\'s shape')
})

test('Cmd Z and Shift Cmd Z stay the shell\'s, through clan:undo-key: no fold takes the key', () => {
  assert.doesNotMatch(FOLDS, /keydown|metaKey|ctrlKey/)
  assert.match(SRC.script, /type: 'clan:undo-key', dir: e\.shiftKey \? 'redo' : 'undo'/)
})

test('in client review mode the folds draw nothing', async () => {
  const p = await open(SRC.visual, { data: VISUAL })
  assert.ok(p.one('#side [data-testid="judge-fold"]'))
  p.win.dispatchEvent(new p.win.MessageEvent('message', { data: { type: 'clan:clientmode', on: true }, source: p.win.parent }))
  assert.equal(p.one('#side [data-testid="judge-fold"]'), null)
  assert.equal(p.one('#side [data-testid="versions-fold"]'), null)
})

test('no em dash in the folds\' words', () => {
  const words = FOLDS.slice(FOLDS.indexOf('<script')).replace(/\/\/[^\n]*/g, '')
  assert.ok(!words.includes('—'))
})
