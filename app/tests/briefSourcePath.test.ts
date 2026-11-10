// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Getting to the source from a brief, in two clicks at most (owner, 2026-11-11:
// "getting to the source was hard, and one option which said it takes you to the
// source didn't do it"). From a selected part: a fact's row opens the fact view,
// which shows the source's name and words, and "Open the source ↗" opens the
// publisher's page itself; the row's ↗ goes there in one. Your words open the
// client's prompt with the passage marked, and "Open the file ↗" opens the file.
// "Source" means the original; a fact or a passage is what was taken from it.
// The shared fields snippet runs here as it ships; the brief's and research's
// own pieces are read from their pages.

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
const CLF = page('shared/clan-fields.html')
const BM = page('brief-maker/index.html')
const CR = page('campaign-research/index.html')

/** From `start` (an opening brace) to its closing brace, skipping strings and comments. */
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

// ── just enough of a page ────────────────────────────────────────────────
type Handler = (e: unknown) => void
class El {
  html = ''
  parent: El | null
  kids = new Map<string, El>()
  on: Record<string, Handler[]> = {}
  attrs: Record<string, string> = {}
  hidden = true
  classList = { add() {}, remove() {}, contains: () => false, toggle() {} }
  constructor(parent: El | null = null) { this.parent = parent }
  get innerHTML() { return this.html }
  set innerHTML(v: string) { this.html = String(v); this.kids.clear() }
  scope(): string { return this.html || (this.parent ? this.parent.scope() : '') }
  querySelector(sel: string): El | null {
    const m = /^\.([\w-]+)$/.exec(sel)
    if (!m) return null
    if (!new RegExp(`class="[^"]*\\b${m[1]}\\b`).test(this.scope())) return null
    if (!this.kids.has(sel)) this.kids.set(sel, new El(this))
    return this.kids.get(sel)!
  }
  querySelectorAll() { return [] }
  contains(n: unknown): boolean { for (let x = n as El | null; x; x = x.parent) if (x === this) return true; return false }
  addEventListener(t: string, h: Handler) { (this.on[t] ??= []).push(h) }
  appendChild(n: El) { n.parent = this; return n }
  focus() {}
  setAttribute(k: string, v: string) { this.attrs[k] = v }
  removeAttribute(k: string) { delete this.attrs[k] }
  getAttribute(k: string) { return this.attrs[k] ?? null }
}
/** A control inside `inside` carrying `attrs`: closest('[data-x]') finds it when it has data-x. */
function control(inside: El, attrs: Record<string, string>) {
  const b = new El(inside)
  b.attrs = attrs
  ;(b as unknown as { closest(s: string): El | null }).closest = (s: string) =>
    s.split(',').some(one => { const m = /^\[([\w-]+)\]$/.exec(one.trim()); return !!m && m[1] in attrs }) ? b : null
  return b
}

/** The fields snippet in a fresh page holding `data`, reading `view` as the host's record. */
const fetched: string[] = []
function loadFields(data: Record<string, unknown>, view: unknown = { decisions: [] }) {
  const docOn: Record<string, Handler[]> = {}
  const opened: string[] = []
  const document = {
    readyState: 'loading', body: new El(), documentElement: new El(),
    addEventListener(t: string, h: Handler) { (docOn[t] ??= []).push(h) },
    createElement: () => new El(), querySelector: () => null, querySelectorAll: () => [],
  }
  const window: Record<string, unknown> = {
    __CLAN__: { data, manifest: { document_id: 'doc_1' } },
    parent: { postMessage() {} }, addEventListener() {}, dispatchEvent: () => true,
    open(u: string) { opened.push(u); return {} },
  }
  const at = CLF.indexOf('var ClanFields=(function(){')
  const src = CLF.slice(at, CLF.indexOf('</script>', at))
  // the host's record; a file of the document's, through clan://
  const fetch = (u: string) => /^clan:\/\/localhost\/assets\//.test(String(u))
    ? (fetched.push(u), Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(['%PDF'])) }))
    : Promise.resolve({ ok: true, json: () => Promise.resolve(view) })
  const URL = { createObjectURL: () => 'blob:null/1' }
  const F = new Function('window', 'document', 'navigator', 'CustomEvent', 'NapkinRoles', 'fetch', 'URL',
    `${src}; return ClanFields;`)(window, document, { userAgent: 'test' }, class {}, undefined, fetch, URL)
  return { F, docOn, opened }
}
/** The brief's panel host, stood in: whatever ClanFields opens takes this element. */
function panel(F: { setPanelHost(h: unknown): void }) {
  const el = new El()
  F.setPanelHost((ref: string | null, kind: string) => (ref == null || kind === 'path' ? null : { el, root: 'The barrier' }))
  return {
    bar: () => el.querySelector('.clf-insp')!.querySelector('.clf-insp-bar')!.innerHTML,
    view: () => el.querySelector('.clf-insp')!.querySelector('.clf-insp-b')!.innerHTML,
    box: () => el.querySelector('.clf-insp')!,
  }
}
function tap(docOn: Record<string, Handler[]>, target: El) { for (const h of docOn.click ?? []) h({ target, preventDefault() {} }) }

const DATA = {
  barrier: 'Ordering an alcohol-free pint first feels like an announcement.',
  projection: {
    pins: {
      f_web: { key: 'barrier.explain', value: 'Non-drinkers feel obliged to explain themselves', unit: 'text', market: 'IE', sources: ['src_web'], quotes: { src_web: 'Many feel obliged to explain themselves.' }, confidence: 'low' },
      f_book: { key: 'market.share', value: 0.23, unit: 'proportion', sources: ['src_book'], quotes: { src_book: 'Share stood at 23%.' }, confidence: 'high' },
    },
    sources: {
      src_web: { publisher: 'Drinks Industry Ireland', domain: 'drinksindustryireland.ie', tier: 'tertiary', uri: 'https://www.drinksindustryireland.ie/research' },
      src_book: { publisher: 'Kantar Worldpanel', tier: 'primary', title: 'Printed annual review' },
    },
    findings: {},
  },
  capture: { items: {
    cap_1: { key: 'business_problem', value: 'Drinkers buy it in cans at home.', quote: 'drinkers still buy it by the can at home', material_id: 'mat_p' },
    cap_2: { key: 'barrier', value: 'From the deck', quote: 'nobody orders it first', material_id: 'mat_f' },
  } },
  materials: {
    mat_p: { kind: 'prompt', name: 'prompt', text: 'Our stout is on draught in 400 pubs, but drinkers still buy it by the can at home.', received_at: '2026-11-10T21:18:00Z', licence: 'client-confidential' },
    mat_pdf: { kind: 'deck', name: 'Pitch deck.pdf', asset: 'human/assets/pitch-deck.pdf', media_type: 'application/pdf', received_at: '2026-11-10T21:18:00Z', licence: 'client-confidential' },
    mat_f: { kind: 'image', name: 'Whiteboard.png', asset: 'human/assets/whiteboard.png', media_type: 'image/png', received_at: '2026-11-10T21:18:00Z', licence: 'client-confidential' },
  },
}
const VIEW = { decisions: [{ decision: { id: 'd_1', kind: 'edit', action: 'edit barrier', actor: 'agent:drafter', targets: ['doc_1#barrier'], timestamp: '2026-11-10T10:00:00Z',
  cites: ['cap_1', 'f_web', 'f_book'], reasoning: { decided: 'Wrote the barrier', because: [{ point: 'The research says so' }] } } }] }

// ── facts: row → fact view → Open the source ↗ ───────────────────────────

test('a fact row in Built from names what the fact says and its publisher, never its id, and carries ↗ to the source', async () => {
  const { F } = loadFields(DATA, VIEW)
  await F.reload()
  const el = new El()
  F.partView('barrier', el, { panel: true, compact: true, name: 'The barrier', sheet: DATA.barrier })
  const h = el.innerHTML
  // the row opens the fact, by what it says, with its publisher
  assert.match(h, /<button type="button" class="pv-bf" data-clf-go="f_web"><span class="pv-bf-t">Non-drinkers feel obliged to explain themselves<\/span><small>[^<]*Drinks Industry Ireland<\/small>/)
  assert.doesNotMatch(h, /<small>[^<]*f_web/, 'no fact id on the row')
  // and its ↗ is the publisher's page, in a new tab, named honestly
  assert.match(h, /<a class="pv-bf-go" href="https:\/\/www\.drinksindustryireland\.ie\/research" target="_blank" rel="noopener noreferrer" title="Open the source: Drinks Industry Ireland, in a new tab"[^>]*>↗<\/a>/)
  // a source with no web address has no ↗: the row alone
  assert.match(h, /<button type="button" class="pv-bf" data-clf-go="f_book">/)
  assert.doesNotMatch(h, /<div class="pv-bfr"><button type="button" class="pv-bf" data-clf-go="f_book">/)
})

test('a fact row\'s click opens the fact view: the source\'s name and its words up front, then Open the source ↗', async () => {
  const { F, docOn } = loadFields(DATA, VIEW)
  await F.reload()
  const P = panel(F)
  tap(docOn, control(new El(), { 'data-clf-go': 'f_web' }))
  assert.match(P.bar(), /aria-current="true"[^>]*><b>Fact<\/b>/)
  const v = P.view()
  const said = v.indexOf('What Drinks Industry Ireland says'), quote = v.indexOf('obliged to explain themselves.</'), open = v.indexOf('Open the source ↗')
  assert.ok(said > 0 && quote > said && open > quote, 'the name, the words, then the way out')
  assert.ok(open < v.indexOf('Confidence'), 'before anything else about the fact')
  assert.match(v, /<a class="rv-btn rv-open" href="https:\/\/www\.drinksindustryireland\.ie\/research" target="_blank" rel="noopener noreferrer"[^>]*>Open the source ↗<\/a>/)
})

test('a source with no web address: Open the source opens the source view, and says why', async () => {
  const { F, docOn } = loadFields(DATA, VIEW)
  await F.reload()
  const P = panel(F)
  F.open('f_book', false)
  const v = P.view()
  assert.match(v, /<button type="button" class="rv-btn rv-open" data-clf-go="src_book" title="We have no web address for it[^"]*">Open the source<\/button>/)
  assert.doesNotMatch(v, /Open the source ↗/, 'no ↗ where nothing opens outside')
  tap(docOn, control(P.box(), { 'data-clf-go': 'src_book' }))
  assert.match(P.bar(), />Fact<\/button><span aria-hidden="true">›<\/span><button type="button" data-clf-crumb="1" aria-current="true"[^>]*><b>Source<\/b>/)
  assert.match(P.view(), /class="rv-title">Kantar Worldpanel/)
})

test('the source view leads with Open the source ↗; its address is no longer a bare Link row', async () => {
  const { F } = loadFields(DATA, VIEW)
  await F.reload()
  const P = panel(F)
  F.open('src_web', false)
  const v = P.view()
  assert.match(v, /class="rv-title">Drinks Industry Ireland<\/p><div class="rv-acts pv-open"><a class="rv-btn rv-open" href="https:\/\/www\.drinksindustryireland\.ie\/research"[^>]*>Open the source ↗<\/a>/)
  assert.doesNotMatch(v, /<dt>Link<\/dt>/)
  assert.ok(v.indexOf('Open the source ↗') < v.indexOf('About it'))
})

// ── the client's own words: row → their material, the passage marked → Open the file ↗ ──

test('a your-words row opens the client\'s prompt with the passage marked, then what was taken from it', async () => {
  const { F, docOn } = loadFields(DATA, VIEW)
  await F.reload()
  const P = panel(F)
  tap(docOn, control(new El(), { 'data-clf-go': 'cap_1' }))
  assert.match(P.bar(), /<b>Your words<\/b>/)
  const v = P.view()
  assert.match(v, /class="rv-title">(?:<svg[\s\S]*?<\/svg>)?Your prompt<\/p>/)
  assert.match(v, /<h5>The passage, marked in it<\/h5><div class="pv-said"><blockquote class="rv-q pv-doc">Our stout is on draught in 400 pubs, but <mark>drinkers still buy it by the can at home<\/mark>\.<\/blockquote>/)
  assert.match(v, /<h5>Taken from it<\/h5>[\s\S]*Drinkers buy it in cans at home\./)
  assert.doesNotMatch(v, /Open the file/, 'a typed prompt has no file to open')
})

test('your words from a file: the passage, and Open the file ↗, which reads the file through clan:// and opens it', async () => {
  const { F, docOn, opened } = loadFields(DATA, VIEW)
  await F.reload()
  const P = panel(F)
  F.open('cap_2', false)
  const v = P.view()
  assert.match(v, /class="rv-title">(?:<svg[\s\S]*?<\/svg>)?Whiteboard\.png<\/p>/)
  assert.match(v, /<h5>The passage<\/h5>[\s\S]*nobody orders it first/)
  assert.match(v, /<button type="button" class="rv-btn rv-open" data-clf-file="whiteboard\.png" data-type="image\/png" title="Opens Whiteboard\.png in a new tab">Open the file ↗<\/button>/)
  // the file's own view has it too; a typed prompt has none
  F.open('mat_f', false)
  assert.match(P.view(), /data-clf-file="whiteboard\.png"[^>]*>Open the file ↗/)
  F.open('mat_p', false)
  assert.doesNotMatch(P.view(), /Open the file/)
  // a file a tab would only download (a PDF, a deck): no button that the sandbox would drop, but the way to it
  F.open('mat_pdf', false)
  assert.doesNotMatch(P.view(), /Open the file/)
  assert.match(P.view(), /To get it, save a copy of the document\./)
  // the click reads the file through clan:// and opens it, as what it is, in a new tab
  tap(docOn, control(P.box(), { 'data-clf-file': 'whiteboard.png', 'data-type': 'image/png' }))
  for (let i = 0; i < 4; i++) await new Promise(r => setTimeout(r, 0))
  assert.deepEqual(fetched, ['clan://localhost/assets/whiteboard.png'])
  assert.deepEqual(opened, ['blob:null/1'])
})

test('words the sheet already says are not quoted back, but a row still opens their file, marked', async () => {
  const data = { ...DATA, barrier: 'Drinkers still buy it by the can at home.' }
  const view = { decisions: [{ decision: { ...VIEW.decisions[0].decision, cites: ['cap_1'] } }] }
  const { F } = loadFields(data, view)
  await F.reload()
  const el = new El()
  F.partView('barrier', el, { panel: true, compact: true, name: 'The barrier', sheet: data.barrier })
  assert.match(el.innerHTML, /data-clf-go="cap_1"><span class="pv-bf-t">Your prompt<\/span><small>the words the sheet uses, marked in it<\/small>/)
  assert.doesNotMatch(el.innerHTML, /“drinkers still buy it/, 'not quoted back')
})

// ── on the sheet, and in research ─────────────────────────────────────────

test('clicking the selected part on the sheet during a drill-down brings its part view back', () => {
  const row = fn(BM, 'placeRow')
  assert.equal((row.match(/if\(SEL!==f\.key\|\|PROV_INSPECT\) select\(f\.key\);/g) || []).length, 2)
  // and select ends the look at a fact or source
  assert.match(fn(BM, 'select'), /if\(PROV_INSPECT\)\{ PROV_INSPECT=false;[^}]*closePanel\(true\)/)
  // a list part no longer claims "Where this came from" for a click that selects it
  assert.doesNotMatch(BM, /title="Where this came from"/)
})

test('research: the pin card\'s source line opens the source itself, never the fact\'s Full record', () => {
  assert.doesNotMatch(CR, /Full source →/)
  const esc = (s: string) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[c])
  const recs: Record<string, { uri?: string }> = { src_w: { uri: 'https://store.mintel.com/report/uk' }, src_p: {} }
  const srcOpenHtml = new Function('esc', 'srcRecs', `${fn(CR, 'srcOpenHtml')}; return srcOpenHtml;`)(esc, () => recs)
  assert.equal(srcOpenHtml('src_w'), ' · <a href="https://store.mintel.com/report/uk" target="_blank" rel="noopener noreferrer" data-src-open>Open the source ↗</a>')
  // no web address: the source's own card here, named for what it is
  assert.equal(srcOpenHtml('src_p'), ' · <button type="button" data-sel="src_p" data-sel-push>About the source →</button>')
  assert.equal(srcOpenHtml('src_gone'), '')
  assert.match(fn(CR, 'pinCardHtml'), /\+srcOpenHtml\(sid\)\+'<\/p><\/section>'/)
})
