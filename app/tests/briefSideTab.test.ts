// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Brief side tab, "one thing at a time" (features/brief-new-ui.clan, the
// side tab design): the BRIEF view while nothing is selected, the PART view
// while a part is, never both; Place on page one fixed row with no Width;
// writing a part in place on the sheet, Done saving with the reason, Esc
// putting the words back, a reopened part needing its reason; no Pin & lock;
// and the panel never quoting the sheet back. The brief's own functions are
// lifted out of its script and run against just enough of a page.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

function templates(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 6; i++) {
    const t = join(dir, 'templates')
    if (existsSync(join(t, 'shared', 'clan-fields.html'))) return t
    dir = dirname(dir)
  }
  return join(process.cwd(), 'templates')
}
const page = (rel: string) => readFileSync(join(templates(), rel), 'utf8')
const BM = page('brief-maker/index.html')
const CLF = page('shared/clan-fields.html')

function balanced(src: string, start: number): number {
  let depth = 0
  for (let i = start; i < src.length; i++) {
    const c = src[i]
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue }
    if (c === "'" || c === '"' || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++
      continue
    }
    if (c === '{') depth++
    else if (c === '}' && --depth === 0) return i + 1
  }
  throw new Error('unbalanced')
}
function fn(src: string, name: string): string {
  const at = src.indexOf(`function ${name}(`)
  assert.ok(at >= 0, `function ${name} is in the page`)
  return src.slice(at, balanced(src, src.indexOf('{', at)))
}
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
const flush = () => new Promise(r => setTimeout(r, 0))

// ── just enough of a page ────────────────────────────────────────────────
class El {
  html = ''
  text = ''
  hidden = false
  contentEditable = 'inherit'
  attrs: Record<string, string> = {}
  classes = new Set<string>()
  kids: El[] = []
  scrollTop = 0
  focused = 0
  constructor(public tag = 'div', public parts: Record<string, El> = {}) {}
  get innerHTML() { return this.html }
  set innerHTML(v: string) { this.html = String(v); this.kids = []; this.text = String(v).replace(/<[^>]*>/g, '') }
  get textContent() { return this.text }
  set textContent(v: string) { this.text = String(v); this.kids = [] }
  get innerText() { return this.text }
  set innerText(v: string) { this.text = String(v) }
  get className() { return [...this.classes].join(' ') }
  set className(v: string) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)) }
  classList = {
    add: (...c: string[]) => c.forEach(x => this.classes.add(x)),
    remove: (...c: string[]) => c.forEach(x => this.classes.delete(x)),
    contains: (c: string) => this.classes.has(c),
    toggle: (c: string, on?: boolean) => { if (on ?? !this.classes.has(c)) this.classes.add(c); else this.classes.delete(c) },
  }
  setAttribute(k: string, v: string) { this.attrs[k] = v }
  getAttribute(k: string) { return this.attrs[k] ?? null }
  removeAttribute(k: string) { delete this.attrs[k] }
  appendChild(n: El) { this.kids.push(n); return n }
  querySelector(sel: string) { return this.parts[sel] ?? null }
  querySelectorAll() { return [] }
  addEventListener() {}
  contains(n: unknown) { return n === this || this.kids.includes(n as El) }
  focus() { this.focused++ }
  scrollIntoView() {}
  set spellcheck(_v: boolean) {}
}

const FIELDS = [
  { key: 'background', label: 'Background', type: 'text' },
  { key: 'mandatories', label: 'Mandatories', type: 'list' },
  { key: 'open_questions', label: 'Open questions', type: 'list' },
  { key: 'project_name', label: 'Project name', type: 'text' },
]

/** The side tab and its editor, lifted together over one part of a stand-in brief. */
function sideTab(o: { sel?: string | null; locked?: boolean; reopened?: Record<string, { answers: string; reason?: string }>; data?: Record<string, unknown>; kept?: string[]; docLocked?: boolean } = {}) {
  const data: Record<string, unknown> = { background: 'Pubs are quiet on Mondays.', mandatories: ['No price promotion', 'Under-18s never shown'], open_questions: ['Does outdoor include Northern Ireland?'], project_name: 'First Round', ...o.data }
  const ids: Record<string, El> = { selPart: new El(), briefView: new El(), sideHint: new El(), stab: new El(), spSaved: new El(), spRat: new El('textarea') }
  const vals: Record<string, El> = {}, rows: Record<string, El> = {}
  for (const f of FIELDS) { vals[f.key] = new El(); rows[f.key] = new El('div', { '.val': vals[f.key] }) }
  const calls: string[] = [], patches: unknown[][] = [], posts: unknown[][] = [], toasts: string[] = []
  const store = new Map<string, string>()
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) }, removeItem: (k: string) => { store.delete(k) } }
  const env: Record<string, unknown> = {
    $: (id: string) => ids[id] ?? null,
    window: { localStorage: storage, getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
      clan: { patchData: (...a: unknown[]) => { patches.push(a); data[a[0] as string] = a[1]; return Promise.resolve({ ok: true }) }, setTitle: () => {} } },
    document: { createElement: (t: string) => new El(t), createRange: () => { throw new Error('no ranges here') }, execCommand: () => true, querySelectorAll: () => [] },
    phase: 'doc', SEL: o.sel === undefined ? 'background' : o.sel, SEL_ITEM: null, PROV_INSPECT: false, HIST: null, EDIT: null,
    REGEN: {}, FIX: null, SAVED_T: null, REGEN_OPEN: null, REGEN_NOTE: '', REGEN_PRESETS: ['Shorter'], NEEDS_N: 2, READY_NUDGE: false, reduce: true,
    CHAIN: { state: 'ok' }, IC: { lock: '', unlock: '' }, WRITER: 'the Brief agent',
    AS_KINDS: ['prose', 'bullets', 'callout', 'statement', 'cell'], AS_WORDS: { prose: 'Prose', bullets: 'Bullets', callout: 'Callout', statement: 'Statement', cell: 'Field' },
    TONES: ['plain', 'tint', 'inverse'], TONE_WORDS: { plain: 'Plain', tint: 'Tint', inverse: 'Inverse' },
    get: (k: string) => data[k], esc, fieldOf: (k: string) => FIELDS.find(f => f.key === k) ?? null, headOf: (f: { label: string }) => f.label, partLabel: (f: { label: string }) => f.label,
    rowOf: (k: string) => rows[k] ?? null, docId: () => 'doc_1',
    valToText: (v: unknown, t: string) => (v == null ? '' : t === 'list' ? (Array.isArray(v) ? v.join('\n') : String(v)) : String(v)),
    short: (s: string) => String(s).slice(0, 48),
    approveLocked: () => !!o.locked, docLocked: () => !!(o.locked || o.docLocked), isLocked: (k: string) => (o.kept ?? []).includes(k), isConf: () => false,
    reopenedOf: (k: string) => o.reopened?.[k] ?? null, reopenReason: (r: { reason?: string }) => r.reason ?? '', canWrite: (k: string) => !o.locked || !!o.reopened?.[k],
    layoutItems: () => FIELDS.map(f => ({ key: f.key })), layoutIndex: (items: { key: string }[], k: string) => items.findIndex(i => i.key === k), layoutCanStep: () => [true, true],
    kindOf: () => 'prose', notesHtml: () => '', openQs: () => (data.open_questions as string[]).map((q, i) => ({ i, raw: q, q, kind: null, a: '' })),
    ownVerdictOf: () => null, crossVerdictsOf: () => [], proposalOf: () => null, noMiddleware: () => false,
    OSF: () => null, markItem: () => {}, bindNotes: () => {}, bindAnswers: () => {}, renderProv: () => { calls.push('renderProv') },
    renderStructured: () => { calls.push('renderStructured') }, toast: (m: string) => { toasts.push(m) },
    hostPost: (...a: unknown[]) => { posts.push(a); return Promise.resolve({ ok: true }) }, hostErrText: () => '',
    select: (k: string | null) => { calls.push(`select:${k}`) },
  }
  const names = ['renderSelPart', 'keepBtn', 'confBtn', 'chipsHtml', 'regenHtml', 'lineCrumb', 'hintShown', 'isLine', 'canType', 'draftKey', 'draftGet', 'draftPut', 'editText', 'editValue', 'startEdit', 'editKeys', 'endEdit', 'cancelEdit', 'commitEdit', 'savedTick']
  const body = `${names.map(n => fn(BM, n)).join('\n')}
    return { ${names.join(',')}, edit: function(){ return EDIT; }, setSel: function(k){ SEL=k; } };`
  const T = new Function(...Object.keys(env), body)(...Object.values(env)) as Record<string, (...a: unknown[]) => unknown> & { edit(): null | { el: El; reason: string; err: string; saving: boolean } }
  return { T, ids, vals, rows, calls, patches, posts, toasts, store, data }
}

// ── 1. the brief view or the part view, never both, each in its order ────

test('the side tab holds the brief view and the part view apart, the brief view in the design’s order', () => {
  const tab = BM.slice(BM.indexOf('<aside class="stab"'), BM.indexOf('</aside>'))
  const bv = tab.slice(tab.indexOf('id="briefView"'), tab.indexOf('id="selPart"'))
  assert.ok(tab.indexOf('id="selPart"') > tab.indexOf('id="briefView"'), 'the part view is not inside the brief view')
  // 1 header, 2 the research changed, 3 Needs you, 4 Lock (with the locked states), 5 Review, 6 client and Made from, 7 Look, 8 Logos, 9 the hint
  const order = ['id="bState"', 'id="upNote"', 'id="lockList"', 'id="lockBtn"', 'id="lockedBadge"', 'id="crOpen"', 'id="reopenBtn"', 'id="review"', 'id="brandLine"', 'id="madeFrom"', 'id="lookFold"', 'id="logoFold"', 'id="sideHint"']
  const at = order.map(o => bv.indexOf(o))
  at.forEach((x, i) => assert.ok(x >= 0, `${order[i]} is in the brief view`))
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'in the design’s order')
  // Look and Logos are folded, each with its summary line.
  assert.match(bv, /<details class="b-fold look" id="lookFold"[^>]*><summary>Look<small id="lookSum"><\/small><\/summary>/)
  assert.match(bv, /<details class="b-fold" id="logoFold"><summary>Logos<small id="logoSum"><\/small><\/summary>/)
  assert.doesNotMatch(bv, /id="(lookFold|logoFold)"[^>]* open/, 'folded until opened')
  for (const k of ['data-look="frame"', 'data-look="headings"', 'data-look="cover"', 'data-look="why"', 'id="swatches"', 'id="resetLook"']) assert.ok(bv.slice(bv.indexOf('id="lookFold"'), bv.indexOf('id="logoFold"')).includes(k), `${k} is in Look`)
  const L = new Function('$', 'layoutData', 'get', 'derivedTitle', 'SWATCHES', 'window', 'agencyName', 'esc', 'patch', 'renderLogos', 'renderBrandLine', 'document',
    `${fn(BM, 'renderLook')} return renderLook;`)
  const ids: Record<string, El> = { sheet: new El(), sheetTab: new El(), swatches: new El('div', { input: new El() }), lookSum: new El() }
  ;(ids.sheet as unknown as { style: object }).style = { setProperty() {}, removeProperty() {} }
  ;(ids.sheetTab as unknown as { style: object }).style = { removeProperty() {} }
  L((id: string) => ids[id] ?? null, () => ({ frame: 'boxed' }), () => '', () => '', [['', 'x']], {}, () => '', esc, () => {}, () => {}, () => {}, { querySelectorAll: () => [] })()
  assert.equal(ids.lookSum.textContent, 'Boxed · Label · Plain', '▸ Look · Boxed · Label · Plain')
  assert.match(fn(BM, 'renderLogos'), /if\(sm\) sm\.textContent=on\?String\(on\):'· none on the sheet';/, '▸ Logos · 2, counting what the sheet shows (briefLogos.test.ts)')
  // A part selected: the brief view goes (in the script, and in CSS for a drill-down with nothing selected).
  assert.match(BM, /#stab:has\(> #selPart:not\(\[hidden\]\)\) > #briefView\{display:none!important\}/)
})

test('nothing selected shows the brief view only; a part selected shows the part view only', () => {
  const none = sideTab({ sel: null })
  none.T.renderSelPart()
  assert.equal(none.ids.selPart.hidden, true)
  assert.equal(none.ids.briefView.hidden, false)
  const one = sideTab()
  one.T.renderSelPart()
  assert.equal(one.ids.selPart.hidden, false)
  assert.equal(one.ids.briefView.hidden, true, 'never one stacked on the other')
  one.T.setSel(null); one.T.renderSelPart()
  assert.equal(one.ids.selPart.hidden, true)
  assert.equal(one.ids.briefView.hidden, false, 'back to the brief')
})

test('the part view runs crumb, chips, actions, Place on page, Your call, Built from, History', () => {
  const t = sideTab({ sel: 'open_questions' })
  t.T.renderSelPart()
  const h = t.ids.selPart.innerHTML
  const order = ['class="sp-crumb"', 'class="sp-chips"', 'data-sp="edit"', 'class="sp-l"', 'class="needs-box sp-call"', 'id="spProv"', 'id="spHist"']
  const at = order.map(o => h.indexOf(o))
  at.forEach((x, i) => assert.ok(x >= 0, `${order[i]} is drawn`))
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'in the design’s order')
  // the crumb: ← Brief › the part, and the brief-wide calls; the part's words are never quoted
  assert.match(h, /<button type="button" class="sp-back" data-sp="back"[^>]*>← Brief<\/button><span aria-hidden="true">›<\/span><span class="sp-name">Open questions<\/span>/)
  assert.match(h, />2 calls<\/button>/)
  assert.doesNotMatch(h, /Selected part|This line/)
  // one primary: Edit; the rest the shell's set
  assert.equal((h.match(/class="btn-primary/g) || []).length, 1)
  assert.match(h, /<button type="button" class="btn-primary sp-edit" data-sp="edit"[^>]*>Edit<\/button><button type="button" class="sp-btn" data-sp="regen"[^>]*>Redraft…<\/button>/)
  assert.match(h, /data-sp="keep"[\s\S]*data-sp="conf"/)
  // a list line: the crumb says which, no quote of it
  const L = sideTab({ sel: 'mandatories' })
  assert.equal(L.T.lineCrumb(FIELDS[1]), '')
  const src = fn(BM, 'lineCrumb')
  assert.match(src, /'line '\+\(SEL_ITEM\+1\)\+' of '\+list\.length/)
  assert.ok(!BM.includes('function lineHtml('), 'the This line quote is gone')
  // locked: Edit and Redraft become one primary, Reopen this part…
  const lk = sideTab({ locked: true })
  lk.T.renderSelPart()
  assert.match(lk.ids.selPart.innerHTML, /<button type="button" class="btn-primary" data-sp="reopen"[^>]*>Reopen this part…<\/button>/)
  assert.doesNotMatch(lk.ids.selPart.innerHTML, /data-sp="edit"|data-sp="regen"/)
  // Redraft… opens in the tab, under the actions, never on the sheet
  assert.match(fn(BM, 'regenHtml'), /class="sp-regen" id="spRegen"/)
  assert.doesNotMatch(fn(BM, 'startRegen'), /openInline|row\.querySelector|insertAdjacent/)
})

// ── 2. Place on page: one fixed row, always there, no Width ───────────────

test('Place on page is one fixed row that never folds, with Show as, Tone, ↑ and ↓, and no Width', () => {
  for (const state of ['part', 'editing'] as const) {
    const t = sideTab()
    if (state === 'editing') t.T.startEdit(t.rows.background, FIELDS[0])
    else t.T.renderSelPart()
    const h = t.ids.selPart.innerHTML
    const row = h.slice(h.indexOf('<div class="sp-l"'), h.indexOf('</span></div>', h.indexOf('<div class="sp-l"')))
    assert.ok(row.length > 0, `${state}: the row is there`)
    assert.doesNotMatch(h, /<details class="sp-l"|<summary>Place on page/, 'never folded')
    assert.doesNotMatch(row, /Width|data-w=|Third|Half|Two-thirds/, 'no Width')
    assert.ok(row.indexOf('aria-label="Show as"') < row.indexOf('aria-label="Tone"') && row.indexOf('aria-label="Tone"') < row.indexOf('data-sp="up"') && row.indexOf('data-sp="up"') < row.indexOf('data-sp="down"'))
    assert.match(row, /<option value="prose" selected>Prose<\/option>/)
    assert.match(row, /<option value="plain" selected>Plain<\/option>/)
  }
  const lk = sideTab({ docLocked: true })
  lk.T.renderSelPart()
  assert.doesNotMatch(lk.ids.selPart.innerHTML, /class="sp-l"/, 'locked: not offered')
})

// ── 3. writing in place ───────────────────────────────────────────────────

test('Edit writes the part in place on the sheet, in its own type; the tab turns Edit into Done', () => {
  const t = sideTab()
  t.T.startEdit(t.rows.background, FIELDS[0])
  const ed = t.vals.background.kids[0]
  assert.ok(ed, 'an editable element in the part’s own place')
  assert.ok(ed.classes.has('ined'))
  assert.equal(ed.contentEditable, 'plaintext-only')
  assert.equal(ed.textContent, 'Pubs are quiet on Mondays.')
  assert.ok(t.vals.background.classes.has('editing'))
  assert.ok(t.rows.background.classes.has('is-editing'))
  assert.equal(ed.focused, 1)
  // no form on the paper
  assert.ok(!t.vals.background.kids.some(k => /textarea|input/.test(k.tag)))
  assert.doesNotMatch(t.vals.background.innerHTML, /editrow|textarea|Save|checkbox/)
  // the tab: Done (the one primary) where Edit was, Cancel, the keys, why (optional)
  const h = t.ids.selPart.innerHTML
  assert.match(h, /<button type="button" class="btn-primary sp-done" data-sp="done">Done<\/button><button type="button" class="sp-btn" data-sp="cancel">Cancel<\/button><span class="sp-keys">⌘↵ done · Esc cancel<\/span>/)
  assert.match(h, /Why this change\? \(optional\)/)
  assert.doesNotMatch(h, /data-sp="edit"|The rest of the brief stays/)
  assert.match(h, /<span class="sp-name">Background · editing<\/span>/)
  // a list is one item per line; a name is one line
  const L = sideTab({ sel: 'mandatories' })
  L.T.startEdit(L.rows.mandatories, FIELDS[1])
  assert.equal(L.vals.mandatories.kids[0].textContent, 'No price promotion\nUnder-18s never shown')
  assert.ok(L.vals.mandatories.kids[0].classes.has('ined-list'))
  assert.deepEqual(L.T.editValue(FIELDS[1], ' a \nb\n\n c\n'), ['a', 'b', 'c'])
  assert.equal(L.T.editValue(FIELDS[3], 'First\nRound '), 'First Round')
  // double-click and Enter on a selected part start it too
  assert.match(fn(BM, 'placeRow'), /row\.addEventListener\('dblclick'[\s\S]*startEdit\(row, f\);/)
  assert.match(BM, /if\(e\.key==='Enter'&&SEL&&!EDIT&&!PROV_INSPECT&&[\s\S]{0,240}?startEdit\(r,f\);/)
})

test('Done saves through the edit path with the reason; ⌘↵ is Done', async () => {
  const t = sideTab()
  t.T.startEdit(t.rows.background, FIELDS[0])
  t.T.edit()!.el.innerText = 'Pubs are quiet on Mondays, busy on Fridays.'
  t.T.edit()!.reason = 'The client said Fridays matter'
  assert.equal(t.T.commitEdit(), true)
  assert.deepEqual(t.patches[0], ['background', 'Pubs are quiet on Mondays, busy on Fridays.', { actor: 'human', pinned: false, action: 'edit background', rationale: 'The client said Fridays matter' }])
  await flush()
  assert.equal(t.T.edit(), null, 'the edit is over')
  assert.ok(t.calls.includes('renderStructured'), 'the sheet is drawn again from the record')
  // with no reason the change says what changed; Keep as is rides along as the one hold flag
  const k = sideTab({ kept: ['background'] })
  k.T.startEdit(k.rows.background, FIELDS[0])
  k.T.edit()!.el.innerText = 'New words.'
  ;(k.T.editKeys as (e: unknown) => void)({ key: 'Enter', metaKey: true, preventDefault() {}, stopPropagation() {}, target: k.T.edit()!.el })
  const opts = k.patches[0][2] as { pinned: boolean; rationale: string }
  assert.equal(opts.pinned, true)
  assert.equal(opts.rationale, 'Changed from "Pubs are quiet on Mondays." to "New words."')
  // nothing changed: nothing is written
  const n = sideTab()
  n.T.startEdit(n.rows.background, FIELDS[0])
  n.T.commitEdit()
  assert.equal(n.patches.length, 0)
  assert.equal(n.T.edit(), null)
  // a click elsewhere saves: the one save model
  assert.match(BM, /document\.addEventListener\('pointerdown', function\(e\)\{\s*if\(!EDIT\|\|EDIT\.saving\) return;[\s\S]*?commitEdit\(\);\s*\}, true\);/)
})

test('Esc or Cancel puts back exactly what was there, and drops the kept draft', () => {
  const t = sideTab()
  t.T.startEdit(t.rows.background, FIELDS[0])
  const ed = t.T.edit()!.el
  ed.innerText = 'Half-typed words'
  t.T.draftPut(FIELDS[0], { text: 'Half-typed words', reason: '' })
  assert.ok(t.store.has('napkin.brief.draft:doc_1:background'), 'an unsent edit is kept on this device')
  ;(t.T.editKeys as (e: unknown) => void)({ key: 'Escape', preventDefault() {}, stopPropagation() {}, target: ed })
  assert.equal(t.T.edit(), null)
  assert.equal(t.patches.length, 0, 'nothing written')
  assert.ok(t.calls.includes('renderStructured'), 'the sheet is drawn again from the record: the old words')
  assert.ok(!t.store.has('napkin.brief.draft:doc_1:background'))
  // a kept draft comes back when the part is written again
  const d = sideTab()
  d.T.draftPut(FIELDS[0], { text: 'Where I got to', reason: 'why' })
  d.T.startEdit(d.rows.background, FIELDS[0])
  assert.equal(d.T.edit()!.el.textContent, 'Where I got to')
  assert.equal(d.T.edit()!.reason, 'why')
  // storage that refuses is no error
  assert.match(fn(BM, 'draftGet'), /try\{[\s\S]*\}catch\(e\)\{ return null; \}/)
  assert.match(fn(BM, 'draftPut'), /try\{[\s\S]*\}catch\(e\)\{\}/)
})

test('a reopened part needs its reason: Done waits for it, and the rest of the brief stays as the client saw it', async () => {
  const t = sideTab({ locked: true, reopened: { background: { answers: 'd_client_1' } } })
  t.T.startEdit(t.rows.background, FIELDS[0])
  const h = t.ids.selPart.innerHTML
  assert.match(h, /Why this change\? \(needed\)/)
  assert.match(h, /<button type="button" class="btn-primary sp-done" data-sp="done" disabled>Done<\/button>/)
  assert.match(h, /The rest of the brief stays as the client saw it\./)
  t.T.edit()!.el.innerText = 'Pubs are quiet on Mondays and Tuesdays.'
  assert.equal(t.T.commitEdit(), false, 'no reason: it stays open')
  assert.equal(t.posts.length, 0)
  assert.match(t.T.edit()!.err, /Say why/)
  t.T.edit()!.reason = 'The client asked for Tuesdays'
  assert.equal(t.T.commitEdit(), true)
  assert.deepEqual(t.posts[0], ['/edit', { path: 'background', value: 'Pubs are quiet on Mondays and Tuesdays.', rationale: 'The client asked for Tuesdays', answers: 'd_client_1' }])
  assert.equal(t.patches.length, 0, 'through the host’s edit, not a plain patch')
  await flush()
  assert.equal(t.T.edit(), null)
  // a reason filled in for you still works, and Done is ready
  const f = sideTab({ locked: true, reopened: { background: { answers: 'd_2', reason: 'Client: say Tuesdays too' } } })
  f.T.startEdit(f.rows.background, FIELDS[0])
  assert.match(f.ids.selPart.innerHTML, /Reason, filled in for you/)
  assert.match(f.ids.selPart.innerHTML, /data-sp="done">Done</)
  // a locked part that is not reopened is not written at all
  const lk = sideTab({ locked: true })
  lk.T.startEdit(lk.rows.background, FIELDS[0])
  assert.equal(lk.T.edit(), null)
  assert.equal(lk.vals.background.kids.length, 0)
})

// ── 4. no Pin & lock ──────────────────────────────────────────────────────

test('Pin & lock this field is gone: Keep as is is the one flag, control and name', () => {
  assert.doesNotMatch(BM, /Pin &amp; lock|Pin & lock|class="pin"|querySelector\('\.pin'\)/)
  assert.match(fn(BM, 'commitEdit'), /pinned:isLocked\(f\.key\)/, 'the edit keeps the part’s Keep as is')
  assert.match(fn(BM, 'keepBtn'), /data-sp="keep"[\s\S]*Keep as is/)
  // and the old inline form with its pills is gone from the page
  for (const gone of ['function openInline(', 'function startStyle(', 'function saveClientChange(', 'class="valctl"', '.edit textarea', '.cancel{', '.save{']) assert.ok(!BM.includes(gone), `${gone} is gone`)
})

// ── 5. the panel never quotes the sheet ───────────────────────────────────

function loadFields(data: Record<string, unknown>, view: unknown) {
  const window: Record<string, unknown> = { __CLAN__: { data, manifest: { document_id: 'doc_1' } }, parent: { postMessage() {} }, addEventListener() {}, dispatchEvent: () => true }
  const document = { readyState: 'loading', body: new El(), documentElement: new El(), addEventListener() {}, createElement: () => new El(), querySelector: () => null, querySelectorAll: () => [] }
  const at = CLF.indexOf('var ClanFields=(function(){')
  const src = CLF.slice(at, CLF.indexOf('</script>', at))
  const fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(view) })
  return new Function('window', 'document', 'navigator', 'CustomEvent', 'NapkinRoles', 'fetch', `${src}; return ClanFields;`)(window, document, { userAgent: 'test' }, class {}, undefined, fetch)
}

test('Built from leaves out your words that the sheet already says; Why drops the certainty and a repeated Because', async () => {
  const data = {
    client: 'McDonald’s Ireland',
    projection: {
      pins: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`f_${i}`, { key: `stat.${i}`, value: 10 + i, unit: 'percent', sources: ['src_a'], confidence: 'high' }])),
      sources: { src_a: { publisher: 'Kantar Worldpanel', domain: 'kantar.example', tier: 'primary' } }, findings: {},
    },
    capture: { items: { cap_echo: { key: 'client', value: 'McDonald’s Ireland', quote: 'McDonald’s Ireland', material_id: 'mat_1' }, cap_new: { key: 'client', value: 'x', quote: 'The client is the Irish franchise group', material_id: 'mat_1' } } },
    materials: { mat_1: { kind: 'prompt', name: 'prompt', text: 'Brief for McDonald’s Ireland' } },
  }
  const view = { decisions: [{ decision: { id: 'd_1', kind: 'edit', action: 'edit client', actor: 'agent:drafter', targets: ['doc_1#client'], timestamp: '2026-11-10T10:00:00Z',
    cites: ['cap_echo', 'cap_new', ...Object.keys(data.projection.pins)],
    reasoning: { decided: 'Named the client as the brief does', certainty: { level: 'low', why: 'thin' },
      because: [{ point: 'The Review agent’s note: name the franchise group' }, { point: 'It is the client on the record' }, { point: 'It is the client on the record' }] } } }] }
  const F = loadFields(data, view)
  await F.reload()
  const el = new El()
  F.partView('client', el, { panel: true, compact: true, name: 'Client', sheet: 'McDonald’s Ireland', seen: 'Your call · 1 open Review: name the franchise group', also: [{ key: 'job', label: 'The job' }] })
  const h = el.innerHTML
  assert.match(h, /pv-compact/)
  assert.doesNotMatch(h, /data-clf-go="cap_echo"/, 'a quote that says what the sheet says is not shown')
  assert.match(h, /data-clf-go="cap_new"/, 'a quote that adds something is')
  // compact rows: the top five, then All n ›
  const top = h.slice(0, h.indexOf('class="pv-all"'))
  assert.equal((top.match(/class="pv-bf"/g) || []).length, 5)
  assert.match(h, /<summary>All 8 ›<\/summary>/, "your words (1) and facts (7): the top five, then all eight")
  assert.match(h, /class="pv-also-row"><span>Also in<\/span><button type="button" class="rv-cchip" data-clf-part="job">The job<\/button>/)
  // Why, folded: no Certainty (the chips say it), no Because the panel shows already, none twice
  const why = h.slice(h.indexOf('<details class="pv-why"'))
  assert.match(why, /^<details class="pv-why" data-pv-why="client"><summary>Why it says this<\/summary>/)
  assert.doesNotMatch(why, /Certainty/)
  assert.doesNotMatch(why, /name the franchise group/)
  assert.equal((why.match(/It is the client on the record/g) || []).length, 1)
  // the state chips' facts and the History, from the same record
  assert.deepEqual(F.partFacts('client'), { level: 'Low · thin', tone: 'warn', facts: 7, decisions: 1 })
  const hist = F.partHistory('client')
  assert.match(hist, /Written by/)
  assert.match(hist, /d_1/)
  assert.match(hist, /Decisions on the record/)
  // the full view (the drawer, the Research Tool) is unchanged: no compact options leak into it
  F.partView('client', el, { panel: true, name: 'Client' })
  assert.doesNotMatch(el.innerHTML, /pv-compact|pv-bf/)
  assert.match(el.innerHTML, /From your words/)
})
