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

interface Opts { card?: Json | null; versions?: Json; data?: Json; width?: number; post?: (path: string, body: Json) => Json; attention?: Json[]; mode?: boolean | null }

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
        else if (path === '/decisions') b = { document_id: 'd', version: 'v', decisions: [], attention: opts.attention ?? [], cites: {}, lock: { can_lock: true, blockers: 0, locked: false } }
        else if (path === '/upstream') b = { upstream: [] }
        else if (path === '/ideas/room') b = { data: {}, gate: { team_cards: 0, needed: 5, to_go: 5, open: false, creative_director: 'dara@wk', routes_out: [], chosen: null }, brief: null }
        else if (path === '/ideas/routes') b = { routes: {} }
        return Promise.resolve({ ok: b != null, status: b != null ? 200 : 404, json: () => Promise.resolve(b) })
      }
    },
  })
  windows.push(dom.window)
  // The shell says the mode on every load (AppRuntime.tsx, clan:clientmode); null leaves it unsaid.
  const w0 = dom.window as unknown as Record<string, any>
  if (opts.mode !== null) w0.dispatchEvent(new w0.MessageEvent('message', { data: { type: 'clan:clientmode', on: opts.mode ?? false }, source: w0.parent }))
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

// ── review: R1 to R6 (the coordinator's review of the folds), and who holds it ───────────────────────

const XSS = '<img src=x onerror="window.__pwn=1"><script>window.__pwn=1</' + 'script>"\'><b id=pwn>'

test('R1 verdict and version text is text, never HTML', async () => {
  const card = CARD({ why_not: XSS, setup: { ...CARD().setup, calibration: XSS }, older: [{ total: XSS }] })
  card.score.tests = [{ id: XSS, dim: XSS, value: 'fail', evidence: XSS, question: XSS }, { id: 'p', dim: 'constructor', value: XSS, evidence: XSS, question: XSS }]
  card.score.route_line = XSS; card.score.total = XSS; card.score.sub = { idea: XSS, craft: XSS, effect: XSS }
  card.score.overruled = { route: 'cd', at: 'x', reason: XSS }; card.score.route = XSS; card.score.trust = XSS
  const versions = { versions: [{ n: 2, decision: 'a2', signer: XSS, at: XSS, reason: XSS, locked: true, readable: true }, { n: 1, decision: 'a1', signer: XSS, at: '2026-11-12T09:00:00Z', reason: '', locked: false, readable: true }], draft: { changed: true, restored_from: XSS, edited_by: XSS, at: '2026-11-12T09:00:00Z', last_edit: null } }
  const kept = PARTS['1']
  PARTS['1'] = { n: 1, readable: true, parts: { [XSS]: XSS, list: [{ text: XSS, role: XSS }], deep: { [XSS]: [XSS] } } }
  try {
    const p = await open(SRC.script, { data: RADIO, card, versions, post: () => ({ ok: false, error: 'ai_off: ' + XSS }) })
    const fold = p.one('#side [data-testid="versions-fold"]'); fold.open = true; fold.dispatchEvent(new p.win.Event('toggle'))
    p.click('#side [data-testid="version-row"][data-version="1"] [data-bf-act="ver-compare"]')
    p.click('#side [data-testid="version-row"][data-version="2"] [data-bf-act="ver-compare"]')
    await p.settle()
    p.click('#side [data-testid="judge-again"]'); await p.settle()
    assert.ok(p.one('#side [data-testid="version-compare"]'), 'compare drawn')
    assert.ok(p.one('#side [data-testid="judge-refusal"]'), 'refusal drawn')
    assert.equal(p.all('[data-booth-fold] img, [data-booth-fold] script, #pwn').length, 0, 'no injected element')
    assert.equal(p.win.__pwn, undefined)
  } finally { PARTS['1'] = kept }
})

/** Two versions compared at 1440 px on the script editor; the desk measured as 1408 px. */
async function comparing() {
  const p = await open(SRC.script, { data: RADIO })
  const fold = p.one('#side [data-testid="versions-fold"]'); fold.open = true; fold.dispatchEvent(new p.win.Event('toggle'))
  const desk = p.one('.desk'); Object.defineProperty(desk, 'clientWidth', { value: 1408, configurable: true })
  p.click('#side [data-testid="version-row"][data-version="1"] [data-bf-act="ver-compare"]')
  p.click('#side [data-testid="version-row"][data-version="2"] [data-bf-act="ver-compare"]')
  await p.settle()
  assert.equal(desk.style.getPropertyValue('--trk'), '744px')
  return { p, desk }
}

test('R2 leaving the compare by any way gives the Booth its own width back: a beat selected', async () => {
  const { p, desk } = await comparing()
  p.one('[data-beat="b1"]').dispatchEvent(new p.win.MouseEvent('click', { bubbles: true }))
  await p.settle()
  assert.equal(p.one('#side [data-testid="version-compare"]'), null, 'the compare is not on screen')
  assert.equal(desk.classList.contains('booth-wide'), false, 'so the Booth is back to its own width')
  assert.equal(desk.style.getPropertyValue('--trk'), '')
  p.click('#side [data-whole]'); await p.settle()
  assert.equal(p.one('#side [data-testid="version-compare"]'), null, 'and the compare does not come back by itself')
  assert.equal(desk.classList.contains('booth-wide'), false)
})

test('R2 leaving the compare: the Versions fold closed, the Booth hidden, the Judge fold opened', async () => {
  const closed = await comparing()
  const vf = closed.p.one('#side [data-testid="versions-fold"]'); vf.open = false; vf.dispatchEvent(new closed.p.win.Event('toggle'))
  await closed.p.settle()
  assert.equal(closed.desk.classList.contains('booth-wide'), false, 'fold closed')
  const hidden = await comparing()
  hidden.p.click('#side .booth-hide'); await hidden.p.settle()
  assert.equal(hidden.desk.classList.contains('booth-wide'), false, 'Booth hidden')
  const other = await comparing()
  const jf = other.p.one('#side [data-testid="judge-fold"]'); jf.open = false; jf.dispatchEvent(new other.p.win.Event('toggle')); await other.p.settle()
  const jf2 = other.p.one('#side [data-testid="judge-fold"]'); jf2.open = true; jf2.dispatchEvent(new other.p.win.Event('toggle')); await other.p.settle()
  assert.equal(other.p.one('#side [data-testid="version-compare"]'), null, 'another fold opened')
  assert.equal(other.desk.classList.contains('booth-wide'), false)
})

test('R3 a restore that changed nothing tells the shell nothing, and says so', async () => {
  const p = await open(SRC.script, { data: RADIO, post: path => (path === '/restore' ? { ok: true, noop: true, keys: [] } : { ok: true }) })
  p.click('#side [data-testid="version-row"][data-version="1"] [data-bf-act="ver-restore"]')
  await p.settle()
  assert.equal(p.parent.filter(m => m.type === 'clan:write').length, 0, 'no write happened, so none is reported')
  const fold = p.one('#side [data-testid="versions-fold"]'); fold.open = true; fold.dispatchEvent(new p.win.Event('toggle')); await p.settle()
  assert.match(p.one('#side [data-testid="restore-note"]').textContent, /already has the words of v1\. Nothing changed\./)
})

test('R3 after a restore the fold says what Cmd Z does: takes it back on a script, nothing on a visual brief', async () => {
  const restored = { ok: true, clan: { data: RADIO, version: 'v9' } }
  const s = await open(SRC.script, { data: RADIO, post: path => (path === '/restore' ? restored : { ok: true }) })
  s.click('#side [data-testid="version-row"][data-version="1"] [data-bf-act="ver-restore"]'); await s.settle()
  assert.equal(s.parent.filter(m => m.type === 'clan:write').length, 1, 'the script\'s undo stack hears it')
  const sf = s.one('#side [data-testid="versions-fold"]'); sf.open = true; sf.dispatchEvent(new s.win.Event('toggle')); await s.settle()
  assert.match(s.one('#side [data-testid="restore-note"]').textContent, /Cmd Z takes it back/)
  const v = await open(SRC.visual, { data: VISUAL, post: path => (path === '/restore' ? { ok: true, clan: { data: VISUAL, version: 'v9' } } : { ok: true }) })
  v.click('#side [data-testid="version-row"][data-version="1"] [data-bf-act="ver-restore"]'); await v.settle()
  assert.equal(v.parent.filter(m => m.type === 'clan:write').length, 0, 'no undo stack for a visual brief: nothing told')
  const vf = v.one('#side [data-testid="versions-fold"]'); vf.open = true; vf.dispatchEvent(new v.win.Event('toggle')); await v.settle()
  assert.match(v.one('#side [data-testid="restore-note"]').textContent, /To go back, restore the version you want\./)
  assert.doesNotMatch(v.one('#side [data-testid="restore-note"]').textContent, /Cmd Z/)
})

test('R4 one Judge run at a time: the page\'s Send to Judge, then the fold\'s Score again, sends one POST', async () => {
  const release: (() => void)[] = []
  const p = await open(SRC.script, { data: RADIO })
  const real = p.win.fetch
  p.win.fetch = (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === 'POST' && String(url).endsWith('/judge')) { p.posts.push({ path: '/judge', body: JSON.parse(init.body || '{}') }); return new Promise(r => release.push(() => r({ ok: true, status: 200, json: () => Promise.resolve(CARD()) }))) }
    return real(url, init)
  }
  p.one('#side [data-send="judge"]').click(); await p.settle()
  assert.equal(p.one('#side [data-testid="judge-again"]').disabled, true, 'the fold\'s button waits')
  assert.equal(p.one('#side [data-send="judge"]').getAttribute('aria-disabled'), 'true', 'and the page\'s own')
  const bar = p.parent.filter(m => m.type === 'clan:bar').at(-1)
  assert.equal(bar.items.find((i: Json) => i.id === 'send-judge').disabled, true, 'and the bar\'s')
  p.click('#side [data-testid="judge-again"]'); await p.settle()
  p.win.dispatchEvent(new p.win.MessageEvent('message', { data: { type: 'clan:bar-action', id: 'send-judge' }, source: p.win.parent })); await p.settle()
  p.one('#side [data-send="judge"]').click(); await p.settle()
  assert.equal(p.posts.filter(x => x.path === '/judge').length, 1, 'one POST /judge while the first is unanswered')
  release.forEach(f => f()); await p.settle()
  assert.equal(p.one('#side [data-testid="judge-again"]').disabled, false, 'free again once it answered')
})

test('R5 a closed Versions fold reads nothing on the poll; the fold polls only GETs', async () => {
  const p = await open(SRC.script, { data: RADIO })
  const seen: string[] = []
  const real = p.win.fetch
  p.win.fetch = (url: string, init?: { method?: string }) => { seen.push((init?.method || 'GET') + ' ' + String(url).replace(/^.*localhost/, '')); return real(url, init) }
  await new Promise(r => setTimeout(r, 4300))
  assert.equal(seen.filter(s => s.startsWith('POST')).length, 0)
  assert.equal(seen.filter(s => s === 'GET /versions').length, 0, 'a closed Versions fold reads nothing on the poll')
  p.win.dispatchEvent(new p.win.CustomEvent('clan:dataupdated'))
  await p.settle()
  assert.equal(seen.filter(s => s === 'GET /versions').length, 1, 'but a data change is read')
})

test('R6 nothing is drawn before the shell says the mode; then the folds draw', async () => {
  const p = await open(SRC.visual, { data: VISUAL, mode: null })
  assert.equal(p.one('#side [data-testid="judge-fold"]'), null)
  assert.equal(p.one('#side [data-testid="versions-fold"]'), null)
  p.win.dispatchEvent(new p.win.MessageEvent('message', { data: { type: 'clan:clientmode', on: false }, source: p.win.parent }))
  await p.settle()
  assert.ok(p.one('#side [data-testid="judge-fold"]'))
})

// ── who holds it: one line under the status pill, from the decisions view's lock-blocking items ─────

const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const weekday = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return WEEK[d.getDay()] }
const BOOTH_ONLY = BOOTH

test('who holds it is one piece of code, in the Booth snippet, with a mount in every template with a Booth', () => {
  assert.equal(BOOTH_ONLY.split('function boothHolderHtml(').length - 1, 1)
  for (const [k, src] of Object.entries(SRC)) {
    assert.equal(src.split('data-booth-holder').length - 1, 1, `${k} has one holder line`)
    assert.doesNotMatch(src, /function boothHolderHtml\(/, `${k} does not draw it itself`)
  }
  // Brief Maker: right under the status pill's row.
  const head = SRC.brief.slice(SRC.brief.indexOf('id="bState"'), SRC.brief.indexOf('id="lockList"'))
  assert.match(head, /id="statusPill"[\s\S]*data-booth-holder/)
  const rbox = SRC.research.slice(SRC.research.indexOf('id="rbox-status"'), SRC.research.indexOf('class="rbox-acts"'))
  assert.match(rbox, /data-booth-holder/)
})

for (const tool of TOOLS) {
  test(`${tool.name}: who holds it, from the route's open step: "With Aoife, due <day>"`, async () => {
    const p = await open(tool.src, { data: tool.data, attention: [
      { code: 'gate', text: 'x', blocks_lock: false, due: day(1), for: { person: 'dara@wk' } },
      { code: 'sign', text: 'x', blocks_lock: true, due: day(3), for: { person: 'aoife@wk' }, job: 'J001' },
    ] })
    const line = p.one(`${tool.panel} [data-booth-holder]`)
    assert.ok(line, 'the line is in the Booth')
    assert.equal(line.textContent, `With Aoife, due ${weekday(3)}`)
    assert.equal(line.hasAttribute('data-late'), false)
    assert.doesNotMatch(line.textContent, /since|score|fast|slow|\d+ (hours|minutes)/i, 'no since, and nothing scores a person')
  })
}

test('who holds it: days late in the warn tone; a role when no one is named; only the date for a client step; nothing with no route', async () => {
  const late = await open(SRC.script, { data: RADIO, attention: [{ code: 'sign', text: 'x', blocks_lock: true, due: day(-2), for: { person: 'aoife@wk' } }] })
  const l = late.one('#side [data-booth-holder]')
  assert.equal(l.textContent, `With Aoife, due ${weekday(-2)}, 2 days late`)
  assert.equal(l.querySelector('.booth-late').textContent, '2 days late')
  assert.ok(l.hasAttribute('data-late'))
  assert.match(BOOTH, /\.booth-late\{color:var\(--booth-warn\)/)
  const role = await open(SRC.script, { data: RADIO, attention: [{ code: 'sign', text: 'x', blocks_lock: true, due: day(1), for: { role: 'creative_director' } }] })
  assert.equal(role.one('#side [data-booth-holder]').textContent, 'With the creative director, due tomorrow')
  const client = await open(SRC.script, { data: RADIO, attention: [{ code: 'sign', text: 'x', blocks_lock: true, due: day(0) }] })
  assert.equal(client.one('#side [data-booth-holder]').textContent, 'Due today')
  const none = await open(SRC.script, { data: RADIO, attention: [{ code: 'sign', text: 'x', blocks_lock: true }] })
  assert.equal(none.one('#side [data-booth-holder]').textContent, '')
})

// ── review items 2 and 7 ──
test('a restore that brought a mark back (Confidential) does not say Cmd Z takes it back, and tells the shell nothing', async () => {
  const withMarks: Json = { ...VERSIONS, draft: { changed: true, restored_from: 1, edited_by: 'dara@wk', at: '2026-11-14T09:00:00Z', last_edit: { decision: 'd9', person: 'dara@wk', keys: ['audience', 'confidential_fields'], before: {} } } }
  const s = await open(SRC.script, { data: RADIO, versions: withMarks, post: path => (path === '/restore' ? { ok: true, clan: { data: RADIO, version: 'v9' } } : { ok: true }) })
  s.click('#side [data-testid="version-row"][data-version="1"] [data-bf-act="ver-restore"]'); await s.settle()
  const f = s.one('#side [data-testid="versions-fold"]'); f.open = true; f.dispatchEvent(new s.win.Event('toggle')); await s.settle()
  assert.match(s.one('#side [data-testid="restore-note"]').textContent, /To go back, restore the version you want\./)
  assert.doesNotMatch(s.one('#side [data-testid="restore-note"]').textContent, /Cmd Z/)
  assert.equal(s.parent.filter(m => m.type === 'clan:write').length, 0, 'the undo stack is not told of what it would refuse')
})

test('the Judge fold keeps what the band said of a stale score, an earned trust and the overrule', async () => {
  const stale = await open(SRC.script, { data: RADIO, card: CARD({ score: { ...CARD().score, out_of_date: true } }) })
  assert.match(stale.one('#side [data-testid="judge-stale"]').textContent, /out of date/)
  assert.match(stale.one('#side [data-testid="judge-again"]').className, /primary/, 'Score again is the one primary on a stale score')
  const older = await open(SRC.script, { data: RADIO, card: CARD({ score: { ...CARD().score, current: false } }) })
  assert.match(older.one('#side [data-testid="judge-stale"]').textContent, /earlier version/)
  const fresh = await open(SRC.script, { data: RADIO })
  assert.equal(fresh.one('#side [data-testid="judge-stale"]'), null)
  assert.doesNotMatch(fresh.one('#side [data-testid="judge-again"]').className, /primary/)
  // trust: until earned the number is advice, with the host's calibration line; earned, neither
  assert.ok(fresh.one('#side [data-testid="judge-calibration"]'))
  const earned = await open(SRC.script, { data: RADIO, card: CARD({ score: { ...CARD().score, trust: 'earned', route_line: 'Back to the team with the notes.' } }) })
  assert.equal(earned.one('#side [data-testid="judge-calibration"]'), null)
  // the overrule: only the creative director's, and an overruled score says whose word stands
  const nobody = await open(SRC.script, { data: RADIO, card: CARD({ can_overrule: false }) })
  assert.equal(nobody.one('#side [data-testid="judge-overrule"]'), null)
  const cd = await open(SRC.script, { data: RADIO })
  assert.ok(cd.one('#side [data-testid="judge-overrule"]'))
  const over = await open(SRC.script, { data: RADIO, card: CARD({ score: { ...CARD().score, overruled: { route: 'cd', at: 't', reason: 'The thought is the one we want.' } } }) })
  assert.match(over.one('#side [data-testid="judge-overruled"]').textContent, /The creative director overruled Judge: The thought is the one we want\./)
  assert.equal(over.one('#side [data-testid="judge-overrule"]'), null)
})
