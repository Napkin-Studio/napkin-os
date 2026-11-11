// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Where something came from, in a brief, opens in the side tab's Selected
// part panel, never in the drawer that slid in over the page (owner,
// 2026-11-10). The shared fields snippet runs here as it ships, against just
// enough of a page; the brief's panel host is lifted out of its script.

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
  // A class selector finds a child when the markup has that class.
  /** The markup this element stands in: its own, or (until it has some) its parent's. */
  scope(): string { return this.html || (this.parent ? this.parent.scope() : '') }
  querySelector(sel: string): El | null {
    const m = /^\.([\w-]+)$/.exec(sel)
    if (!m) return new El(this)   // a control the drawer focuses
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
/** A button inside `inside` carrying `attrs`: closest('[data-x]') finds it when it has data-x. */
function button(inside: El, attrs: Record<string, string>) {
  const b = new El(inside)
  b.attrs = attrs
  ;(b as unknown as { closest(s: string): El | null }).closest = (s: string) =>
    s.split(',').some(one => { const m = /^\[([\w-]+)\]$/.exec(one.trim()); return !!m && m[1] in attrs }) ? b : null
  return b
}
function click(on: El, target: El) { for (const h of on.on.click ?? []) h({ target, preventDefault() {} }) }

/** The fields snippet, loaded into a fresh page holding `data`. */
function loadFields(data: Record<string, unknown>) {
  const made: string[] = []
  const posted: unknown[] = []
  const docOn: Record<string, Handler[]> = {}
  const body = new El()
  const document = {
    readyState: 'loading',
    body,
    documentElement: new El(),
    addEventListener(t: string, h: Handler) { (docOn[t] ??= []).push(h) },
    createElement(tag: string) { made.push(tag); return new El() },
    querySelector: () => null,
    querySelectorAll: () => [],
  }
  const parent = { postMessage(m: unknown) { posted.push(m) } }
  const window: Record<string, unknown> = {
    __CLAN__: { data, manifest: { document_id: 'doc_1' } },
    parent,
    addEventListener() {},
    dispatchEvent: () => true,
  }
  const at = CLF.indexOf('var ClanFields=(function(){')
  const src = CLF.slice(at, CLF.indexOf('</script>', at))
  const F = new Function('window', 'document', 'navigator', 'CustomEvent', 'NapkinRoles', 'fetch',
    `${src}; return ClanFields;`)(window, document, { userAgent: 'test' }, class {}, undefined, () => new Promise(() => {}))
  return { F, made, posted, docOn }
}

const DATA = {
  projection: {
    pins: { f_1: { key: 'budget.total', value: 250000, unit: 'EUR', sources: ['src_a'], quotes: { src_a: 'The budget is €250,000 for the year.' }, confidence: 'high' } },
    sources: { src_a: { publisher: 'Acme Annual Report', domain: 'acme.example', published_at: '2026-03-01', tier: 'primary', uri: 'https://acme.example/report' } },
    findings: {},
  },
  capture: { items: { cap_1: { key: 'objective', value: 'Grow sign-ups', quote: 'We want more people signing up.', material_id: 'mat_1' } } },
  materials: { mat_1: { kind: 'prompt', name: 'prompt', text: 'We want more people signing up.' } },
}

/** The brief's panel host, lifted, over a stand-in sheet with one part selected. */
function briefHost(opts: { phase?: string; sel?: string | null } = {}) {
  const selPart = new El()
  const calls: string[] = []
  const FIELDS = [{ key: 'budget', label: 'Budget & scope', type: 'text' }, { key: 'deliverables', label: 'Deliverables', type: 'list' }]
  const env = {
    phase: opts.phase ?? 'doc',
    $: (id: string) => (id === 'selPart' ? selPart : null),
    FIELDS,
    fieldOf: (k: string) => FIELDS.filter(f => f.key === k)[0] || null,
    headOf: (f: { label: string }) => f.label,
  }
  const body = `var SEL=${JSON.stringify(opts.sel === undefined ? 'budget' : opts.sel)}, SEL_ITEM=null, PROV_INSPECT=false;
    function select(k,i){ calls.push('select:'+k+(i!=null?'['+i+']':'')); SEL=k; SEL_ITEM=i==null?null:i; }
    function renderSelPart(){ calls.push('renderSelPart'); }
    ${fn(BM, 'provPartOf')}
    ${fn(BM, 'provHost')}
    return { provHost: provHost, inspecting: function(){ return PROV_INSPECT; } };`
  const h = new Function(...Object.keys(env), 'calls', body)(...Object.values(env), calls)
  return { ...h, selPart, calls }
}

test('a fact tapped in the brief opens in the Selected part panel, with its trail, and no drawer', () => {
  const { F, made, posted } = loadFields(DATA)
  const b = briefHost()
  F.setPanelHost(b.provHost)
  F.open('f_1', false)
  assert.equal(b.inspecting(), true)
  assert.equal(F.inspecting(), true)
  assert.equal(b.selPart.hidden, false)
  const box = b.selPart.querySelector('.clf-insp')!
  const bar = box.querySelector('.clf-insp-bar')!, view = box.querySelector('.clf-insp-b')!
  // Budget & scope › Fact, with ← back and ×
  assert.match(bar.innerHTML, /data-clf-crumb="-1"[^>]*>Budget &amp; scope<\/button><span aria-hidden="true">›<\/span><button type="button" data-clf-crumb="0" aria-current="true"[^>]*><b>Fact<\/b>/)
  assert.match(bar.innerHTML, /data-clf="back"/)
  assert.match(bar.innerHTML, /data-clf="close"/)
  // The research inspector's grammar: kind, value, the source's words, its chip
  assert.match(view.innerHTML, /class="clf-rv" data-card="f_1"/)
  assert.match(view.innerHTML, /rv-kind[^>]*><span class="rv-dot"[^>]*><\/span>Fact/)
  assert.match(view.innerHTML, /class="rv-title">250k EUR/)
  assert.match(view.innerHTML, /What Acme Annual Report says/)
  assert.match(view.innerHTML, /data-clf-go="src_a"/)
  // and none of the drawer: no aside made, nothing asked of the shell
  assert.ok(!made.includes('aside'), 'no drawer is built')
  assert.ok(!posted.some(m => /clan:(open|provenance)/.test(String((m as { type?: string }).type))), 'nothing asks the shell to open a drawer')
  assert.doesNotMatch(view.innerHTML, /press <b>Edit<\/b>|choose <b>Edit<\/b>/, 'the panel has Edit already: no hint')
  // nor the drawer's source-card chips (FROM MATERIAL · A PERSON): the view says where it came from
  assert.doesNotMatch(view.innerHTML, /clf-sc-slot/)
})

test('a tap on a fact row in the part view (the page\'s own click) opens the panel, not the drawer', () => {
  const { F, made, posted, docOn } = loadFields(DATA)
  const b = briefHost()
  F.setPanelHost(b.provHost)
  const spProv = new El()
  const row = button(spProv, { 'data-clf-go': 'f_1' })
  for (const h of docOn.click ?? []) h({ target: row, preventDefault() {} })
  assert.equal(F.inspecting(), true)
  assert.match(b.selPart.querySelector('.clf-insp')!.querySelector('.clf-insp-b')!.innerHTML, /data-card="f_1"/)
  // inside the panel, the source chip goes one step on
  const box = b.selPart.querySelector('.clf-insp')!
  for (const h of docOn.click ?? []) h({ target: button(box, { 'data-clf-go': 'src_a' }), preventDefault() {} })
  assert.match(box.querySelector('.clf-insp-bar')!.innerHTML, /<b>Source<\/b>/)
  assert.match(box.querySelector('.clf-insp-bar')!.innerHTML, />Fact<\/button>/)
  assert.ok(!made.includes('aside'))
  assert.equal(posted.length, 0)
})

test('a source opened from the fact goes one step on; back and × return', () => {
  const { F, made } = loadFields(DATA)
  const b = briefHost()
  F.setPanelHost(b.provHost)
  F.open('f_1', false)
  F.open('src_a', true)   // the source chip, inside the panel's view
  const box = b.selPart.querySelector('.clf-insp')!
  const bar = box.querySelector('.clf-insp-bar')!, view = box.querySelector('.clf-insp-b')!
  assert.match(bar.innerHTML, />Budget &amp; scope<\/button><span aria-hidden="true">›<\/span><button type="button" data-clf-crumb="0"[^>]*>Fact<\/button><span aria-hidden="true">›<\/span><button type="button" data-clf-crumb="1" aria-current="true"[^>]*><b>Source<\/b>/)
  assert.match(view.innerHTML, /Source · primary/)
  assert.match(view.innerHTML, /class="rv-title">Acme Annual Report/)
  assert.match(view.innerHTML, /What we took from it/)
  // ← back: the fact again
  click(box, button(box, { 'data-clf': 'back' }))
  assert.match(box.querySelector('.clf-insp-bar')!.innerHTML, /aria-current="true"[^>]*><b>Fact<\/b>/)
  assert.match(box.querySelector('.clf-insp-b')!.innerHTML, /data-card="f_1"/)
  // ← back from the first step: the part
  click(box, button(box, { 'data-clf': 'back' }))
  assert.equal(F.inspecting(), false)
  assert.equal(b.inspecting(), false)
  assert.equal(b.calls.at(-1), 'renderSelPart')
  // × from two steps in: the part, at once
  F.open('f_1', false); F.open('src_a', true)
  const box2 = b.selPart.querySelector('.clf-insp')!
  click(box2, button(box2, { 'data-clf': 'close' }))
  assert.equal(F.inspecting(), false)
  assert.equal(b.inspecting(), false)
  // a crumb takes you back to that step; the root crumb to the part
  F.open('f_1', false); F.open('src_a', true)
  const box3 = b.selPart.querySelector('.clf-insp')!
  click(box3, button(box3, { 'data-clf-crumb': '0' }))
  assert.match(box3.querySelector('.clf-insp-bar')!.innerHTML, /aria-current="true"[^>]*><b>Fact<\/b>/)
  click(box3, button(box3, { 'data-clf-crumb': '-1' }))
  assert.equal(F.inspecting(), false)
  assert.ok(!made.includes('aside'), 'no drawer, throughout')
})

test('your words open in the panel, with the material they came from; the Edit hint is gone', () => {
  const { F, made } = loadFields(DATA)
  const b = briefHost()
  F.setPanelHost(b.provHost)
  F.open('cap_1', false)
  const box = b.selPart.querySelector('.clf-insp')!
  assert.match(box.querySelector('.clf-insp-bar')!.innerHTML, /<b>Your words<\/b>/)
  const v = box.querySelector('.clf-insp-b')!.innerHTML
  // the client's prompt itself, the passage marked in it, then what was taken from it
  assert.match(v, /class="rv-title">Your prompt</)
  assert.match(v, /The passage, marked in it/)
  assert.match(v, /<mark>We want more people signing up\.<\/mark>/)
  assert.match(v, /Taken from it[\s\S]*Grow sign-ups/)
  assert.doesNotMatch(v, /To change it, press/)
  assert.ok(!made.includes('aside'))
})

test('a part of the brief, or a line of one, selects it rather than opening anything', () => {
  const { F, made } = loadFields(DATA)
  const b = briefHost({ sel: null })
  F.setPanelHost(b.provHost)
  F.open('budget', false)
  assert.deepEqual(b.calls, ['select:budget'])
  assert.equal(F.inspecting(), false)
  F.open('deliverables[2]', false)
  assert.deepEqual(b.calls.slice(1), ['select:deliverables[2]'])
  assert.ok(!made.includes('aside'))
})

test('with nothing selected the trail starts at the brief', () => {
  const { F } = loadFields(DATA)
  const b = briefHost({ sel: null })
  F.setPanelHost(b.provHost)
  F.open('f_1', false)
  assert.match(b.selPart.querySelector('.clf-insp')!.querySelector('.clf-insp-bar')!.innerHTML, /data-clf-crumb="-1"[^>]*>Brief<\/button>/)
})

test('a page with no side panel (or the brief before its sheet) keeps the drawer', () => {
  const { F, made } = loadFields(DATA)
  F.open('f_1', false)
  assert.ok(made.includes('aside'), 'no panel host: the drawer')
  const two = loadFields(DATA)
  const b = briefHost({ phase: 'intake' })
  two.F.setPanelHost(b.provHost)
  two.F.open('f_1', false)
  assert.ok(two.made.includes('aside'), 'outside the sheet the host declines')
  assert.equal(b.inspecting(), false)
})

test('the brief registers its panel and leaves the drawer alone', () => {
  assert.match(BM, /F\.setPanelHost\(provHost\)/)
  // every way the brief opened the drawer now goes through ClanFields.open, which asks the panel first
  assert.doesNotMatch(BM, /clan:provenance|postMessage\(\{type:'clan:open'/)
  // the panel stays on the inspector while the brief redraws
  assert.match(fn(BM, 'renderSelPart'), /if\(!el\|\|PROV_INSPECT\) return;/)
  assert.match(fn(BM, 'renderProv'), /PROV_INSPECT\) return;/)
  // choosing another part ends the look, quietly
  assert.match(fn(BM, 'select'), /F\.closePanel\(true\)/)
  // the shared bar is exported for research to reuse
  assert.match(CLF, /crumbs:crumbsHTML/)
})

// ── the research: its inspector panel is the host too (owner, 2026-11-11: the old drawer still opened) ──
const RP = page('campaign-research/index.html')

/** The research's panel host, lifted, over a stand-in panel. */
function researchHost(data: typeof DATA) {
  const pv = new El(), calls: string[] = []
  const P = data.projection as { pins: Record<string, unknown>; findings: Record<string, unknown>; sources: Record<string, unknown> }
  const env = {
    $: (id: string) => (id === 'pv' ? pv : id === 'insp' ? new El() : null),
    fnds: () => P.findings, pins: () => P.pins, srcRecs: () => P.sources,
    crumbOf: (r: string) => (r === 'f_1' ? '◆ 250k EUR' : r),
    openSheet: () => {}, window: {},
  }
  const body = `var VIEW={v:'report', sel:null, trail:[], origin:null}, PV={surf:false}, PAGEDOWN={t:0};
    function select(r){ calls.push('select:'+r); VIEW.sel=r; }
    function renderPanel(){ calls.push('renderPanel'); }
    function renderSel(){ calls.push('renderSel'); }
    ${fn(RP, 'ownView')}
    ${fn(RP, 'provHost')}
    return { provHost: provHost, PV: PV, VIEW: VIEW };`
  const h = new Function(...Object.keys(env), 'calls', 'ClanFields', body)(...Object.values(env), calls, undefined)
  return { ...h, pv, calls }
}

test('research registers its inspector as the panel host', () => {
  assert.match(RP, /if\(window\.ClanFields&&ClanFields\.setPanelHost\) ClanFields\.setPanelHost\(provHost\);/)
  // and every new selection lets go of the OS's inspector first
  assert.match(fn(RP, 'select'), /^function select\(ref, push, open\)\{\s*if\(!ref\) return;\s*endSurf\(\);/)
})

test('research: a provenance request opens in the panel, never the drawer', () => {
  const { F, made, posted } = loadFields(DATA)
  const r = researchHost(DATA)
  F.setPanelHost(r.provHost)
  // a fact, a source: the panel's own views, with its trail
  F.open('f_1', false)
  F.open('src_a', false)
  assert.deepEqual(r.calls.filter((c: string) => c.startsWith('select:')), ['select:f_1', 'select:src_a'])
  // a ref the panel has no view of (the sources behind a line): the OS's inspector, inside the panel
  r.VIEW.sel = 'f_1'
  F.open('cite:f_1,src_a', false)
  assert.equal(r.PV.surf, true)
  assert.equal(F.inspecting(), true)
  const box = r.pv.querySelector('.clf-insp')!
  assert.match(box.querySelector('.clf-insp-bar')!.innerHTML, /data-clf-crumb="-1"[^>]*>◆ 250k EUR<\/button>/)
  // × hands the panel back to the research's own view
  F.closePanel(false)
  assert.equal(r.PV.surf, false)
  assert.ok(r.calls.includes('renderSel'))
  assert.ok(!made.includes('aside'), 'no drawer is built')
  assert.ok(!posted.some(m => /clan:(open|provenance)/.test(String((m as { type?: string }).type))))
})
