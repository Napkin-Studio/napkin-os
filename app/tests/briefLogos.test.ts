// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Brief side tab's two fixes (features/brief-new-ui.clan): a drill-down
// (Fact, Source…) sits on the panel's own surface, not a lighter card; and every
// logo tile on the Logos fold can come off the sheet, the client's and the
// agency's stand-in initials included (layout.logosHidden), with a quiet way
// back and a summary that counts what the sheet shows. The brief's own
// functions are lifted out of its script and run against just enough of a page.

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
const SCHEMA = JSON.parse(page('brief-maker/schema.json'))

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
// The page declares some names twice in one scope (the later one wins, as in the browser): last.
function fn(src: string, name: string): string {
  const at = src.lastIndexOf(`function ${name}(`)
  assert.ok(at >= 0, `function ${name} is in the page`)
  return src.slice(at, balanced(src, src.indexOf('{', at)))
}
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
/** Every CSS rule in the page whose selector is exactly `sel`, as its declarations. */
function rules(src: string, sel: string): string[] {
  const out: string[] = []
  const re = new RegExp(`(?:^|[}\\n])\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g')
  for (let m; (m = re.exec(src));) out.push(m[1])
  return out
}

// ── 1. the drill-down sits on the panel's own surface ──────────────────────

test('a drill-down in the side tab has no card of its own: it sits on the panel’s surface, light and dark', () => {
  const insp = rules(BM, '.selpart .clf-insp')
  assert.ok(insp.length >= 1, 'the side tab styles its inspector')
  for (const r of insp) {
    assert.doesNotMatch(r, /background:\s*var\(--nd-card\)/, 'no near-white card behind it')
    assert.match(r, /background:\s*transparent/)
  }
  // the part view's container has no background either, so both read the same
  assert.ok(rules(BM, '#structured .selpart.side-part').some(r => /background:\s*none/.test(r)))
  // its sticky bar takes the panel's own colour, the one the side tab sits on
  const panel = rules(BM, '#structured .stab').map(r => /background:\s*([^;]+)/.exec(r)?.[1]).filter(Boolean)
  assert.ok(panel.includes('var(--nd-paper)'), 'the panel is --nd-paper')
  assert.deepEqual(rules(BM, '.selpart .clf-insp .clf-ibar'), ['background:var(--nd-paper)'])
  // no dark-mode or agency rule brings the card back
  assert.doesNotMatch(BM, /\.clf-insp\{[^}]*background:\s*var\(--nd-card\)/)
})

test('the shared inspector stays without a background, so the drawer and the Research Tool are as they were', () => {
  for (const r of rules(CLF, '.clf-insp')) assert.doesNotMatch(r, /background/)
  assert.match(rules(CLF, '.clf-ibar')[0], /background:inherit/)
})

// ── 2. logos: every tile comes off, stand-ins included ─────────────────────

class El {
  html = ''
  text = ''
  parts: Record<string, El> = {}
  get innerHTML() { return this.html }
  set innerHTML(v: string) { this.html = String(v); this.text = String(v).replace(/<[^>]*>/g, '') }
  get textContent() { return this.text }
  set textContent(v: string) { this.text = String(v) }
  querySelector(sel: string) { return this.parts[sel] ?? null }
  querySelectorAll() { return [] }
  addEventListener() {}
}

function logos(o: { layout?: Record<string, unknown>; logos?: unknown[]; client?: string; agency?: string } = {}) {
  const data: Record<string, unknown> = { client: o.client ?? 'McDonald’s Ireland', layout: o.layout, logos: o.logos }
  const ids: Record<string, El> = { logoList: new El(), logoSum: new El(), sheetLogos: new El(), sheetNames: new El(), sheetMeta: new El(), sheetFoot: new El() }
  ids.logoList.parts['.add input'] = new El()
  const patches: [string, unknown, { action: string }][] = []
  const names: Record<string, string> = { client: o.client ?? 'McD', agency: o.agency ?? 'TBWA\\Dublin' }
  const env: Record<string, unknown> = {
    $: (id: string) => ids[id] ?? null,
    arr: (a: unknown) => (Array.isArray(a) ? a : []),
    get: (k: string) => data[k], esc, short: (s: string) => String(s).slice(0, 14),
    LOGO_SLOTS: [['client', 'Client'], ['agency', 'Agency'], ['partner', 'Partner']],
    STAND_INS: ['client', 'agency'],
    assetUrl: (a: string) => `asset://${a}`, brandAttached: () => null, kitLogos: () => [], kitOffers: () => [],
    tileOf: (k: string) => (names[k] ? { name: names[k], txt: names[k].slice(0, 2), bg: '#000', fg: '#fff' } : null),
    clientName: () => names.client, agencyName: () => names.agency, docVersion: () => 'v1', fmtDay: () => '', lastWhen: () => null,
    layoutParts: () => ({}), layoutItems: () => [],
    patch: (k: string, v: unknown, d: { action: string }) => { patches.push([k, v, d]); data[k] = v; return Promise.resolve({ ok: true }) },
  }
  const fns = ['layoutData', 'logosOf', 'logoSrc', 'slotRank', 'sheetLogos', 'logosHidden', 'standInsApply', 'standIns', 'standInTiles', 'logosOnSheet', 'setStandIn', 'lookSet', 'logoTileHtml', 'renderSheetHead', 'renderLogos']
  const body = `${fns.map(n => fn(BM, n)).join('\n')}\nreturn { ${fns.join(',')} };`
  const T = new Function(...Object.keys(env), body)(...Object.values(env)) as Record<string, (...a: unknown[]) => any>
  return { T, ids, patches, data }
}

test('with no logos uploaded, each stand-in tile on the fold has a × to take it off the sheet', () => {
  const t = logos()
  t.T.renderLogos()
  const h = t.ids.logoList.innerHTML
  assert.equal((h.match(/class="logo virt"/g) || []).length, 2)
  assert.match(h, /<button type="button" class="x" data-hide="client" aria-label="Take McD’s initials off the sheet"/)
  assert.match(h, /<button type="button" class="x" data-hide="agency" aria-label="Take TBWA\\Dublin’s initials off the sheet"/)
  // the × sits beside the upload, not inside its label, so clicking it never opens the file picker
  assert.match(h, /<\/label><button type="button" class="x" data-hide="client"/)
  // a click on the tile still uploads into its slot
  assert.match(h, /<input type="file" class="sr" data-slot="client"/)
  assert.equal(t.ids.logoSum.textContent, '2', 'the summary counts the two tiles the sheet shows')
})

test('× on a stand-in records it in layout.logosHidden with the decision, and the sheet stops showing it', () => {
  const t = logos({ layout: { frame: 'open', parts: { background: { row: 1, col: 1 } }, model: 'rows' } })
  t.T.setStandIn('client', false)
  assert.equal(t.patches.length, 1)
  const [k, v, d] = t.patches[0] as [string, Record<string, unknown>, { action: string }]
  assert.equal(k, 'layout')
  assert.deepEqual(v.logosHidden, ['client'])
  assert.equal(v.frame, 'open', 'the rest of the look stays')
  assert.equal(d.action, 'take the client’s stand-in logo off')
  t.T.renderSheetHead()
  assert.doesNotMatch(t.ids.sheetLogos.innerHTML, />Mc</, 'the client’s initials are off the sheet')
  assert.match(t.ids.sheetLogos.innerHTML, />TB</, 'the agency’s stay')
  assert.deepEqual(t.T.standInTiles().length, 1, 'the paged view and print take the same tiles')
})

test('with both stand-ins hidden, nothing shows on the sheet or in print, and the summary says so', () => {
  const t = logos({ layout: { logosHidden: ['client', 'agency'] } })
  t.T.renderLogos()
  assert.equal(t.ids.sheetLogos.innerHTML, '', 'no tiles: .b-logos:empty hides the cell')
  assert.deepEqual(t.T.standInTiles(), [])
  assert.equal(t.ids.logoSum.textContent, '· none on the sheet')
  assert.doesNotMatch(t.ids.logoList.innerHTML, /class="logo virt"/)
  // the paged view and print/export build their cover from the same stand-ins
  assert.match(fn(BM, 'sheetCtx'), /tiles:standInTiles\(\)/)
  assert.match(fn(BM, 'sheetDoc'), /:arr\(ctx\.tiles\)/)
  assert.match(fn(BM, 'renderSheetHead'), /:standInTiles\(\)/)
  assert.doesNotMatch(BM, /\[(?:logoT|t)ileHtml\(tileOf\('client'\)\), (?:logoT|t)ileHtml\(tileOf\('agency'\)\)\]/, 'nothing draws the tiles past the hidden list')
})

test('a hidden stand-in waits on the fold as a quiet way back, which puts it on the sheet again', () => {
  const t = logos({ layout: { logosHidden: ['client'] } })
  t.T.renderLogos()
  const h = t.ids.logoList.innerHTML
  assert.match(h, /<button type="button" class="logo-back" data-show="client">Show McD’s initials<\/button>/)
  assert.doesNotMatch(h, /data-show="agency"/)
  assert.equal(t.ids.logoSum.textContent, '1')
  t.T.setStandIn('client', true)
  const [, v, d] = t.patches[0] as [string, Record<string, unknown>, { action: string }]
  assert.deepEqual(v.logosHidden, [])
  assert.equal(d.action, 'put the client’s stand-in logo back')
  t.T.renderLogos()
  assert.equal((t.ids.logoList.innerHTML.match(/class="logo virt"/g) || []).length, 2)
  assert.doesNotMatch(t.ids.logoList.innerHTML, /logo-back/)
})

test('real logos keep their ×; while one shows, no stand-ins and no way-back offer, and the summary counts the pictures', () => {
  const t = logos({ layout: { logosHidden: ['agency'] }, logos: [{ slot: 'client', ref: { asset: 'logo-1.png' }, label: 'mcd.png' }, { slot: 'agency', ref: { asset: 'logo-2.png' }, label: 'tbwa.png' }] })
  t.T.renderLogos()
  const h = t.ids.logoList.innerHTML
  assert.match(h, /<button type="button" class="x" data-n="0" aria-label="Take off mcd.png">×<\/button>/)
  assert.match(h, /<button type="button" class="x" data-n="1"/)
  assert.doesNotMatch(h, /logo virt|logo-back/)
  assert.equal(t.ids.logoSum.textContent, '2')
  assert.equal((t.ids.sheetLogos.innerHTML.match(/<img class="b-logo-img"/g) || []).length, 2)
})

test('the schema knows layout.logosHidden: client or agency, each once', () => {
  const p = SCHEMA.properties.layout.properties.logosHidden
  assert.equal(p.type, 'array')
  assert.equal(p.uniqueItems, true)
  assert.deepEqual(p.items.enum, ['client', 'agency'])
})
