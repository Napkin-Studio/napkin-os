// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Where a document came from shows on its tool's prompt as a card in the
// source tool's own identity (owner, 2026-11-11): Research is the ink band
// with its lens dots and counts, Brief the manila-tab sheet. One helper,
// shared/source-card.html, for every tool's prompt. The brief's writing area
// is clean paper (no ruled lines, no red margin), and both read in every
// agency look, light and dark. The run stage's caption counts parts, never
// lists them.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

function templates(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 6; i++) {
    const t = join(dir, 'templates')
    if (existsSync(join(t, 'shared', 'source-card.html'))) return t
    dir = dirname(dir)
  }
  return join(process.cwd(), 'templates')
}
const page = (rel: string) => readFileSync(join(templates(), rel), 'utf8')
const SC = page('shared/source-card.html')
const BM = page('brief-maker/index.html')

type Src = Record<string, unknown>
interface NS {
  kindOf(d: unknown): string | null
  fromUpstream(d: unknown, e?: unknown, o?: unknown): Src
  cardHtml(s: Src, i: number): string
  listHtml(l: Src[]): string
  mount(el: unknown, l: Src[], on: Record<string, (...a: unknown[]) => void>): void
  setOpen(el: unknown, i: number | null): void
}
function helper(): NS {
  const js = SC.slice(SC.indexOf('<script>') + 8, SC.lastIndexOf('</script>'))
  return new Function(`${js}\nreturn NapkinSource;`)() as NS
}
const NS = helper()

const RESEARCH = {
  campaign: { name: { value: 'Guinness Responsibilty' } },
  report: { headline: { text: 'People drink low/no to join in' } },
  selection: { coverage: { market_structure: 'thin', consumer_culture: 'filled', media_spend: 'empty' } },
  projection: {
    pins: { a: {}, b: {}, c: {} },
    findings: { f1: { status: 'verified', confidence: 'low' }, f2: { status: 'proposed', confidence: 'low' } },
    sources: { s1: {}, s2: {} },
  },
}
const BRIEF = { project_name: { value: 'Not Just For Christmas' }, single_minded_proposition: { value: 'Join in.' }, insight: 'x' }

test('the card is the source tool\'s own: Research is the ink band, Brief the manila tab', () => {
  assert.equal(NS.kindOf(RESEARCH), 'research')
  assert.equal(NS.kindOf(BRIEF), 'brief')
  assert.equal(NS.kindOf({}), null)
  const r = NS.cardHtml(NS.fromUpstream(RESEARCH, { path: 'documents/r.clan', locked: true }), 0)
  assert.match(r, /class="nsrc nsrc-research"/)
  assert.match(r, /<span class="nsrc-band"><svg[^]*?<\/svg>Research<\/span>/)
  assert.match(r, /Guinness Responsibilty/)
  assert.match(r, /Built from research<\/span><span class="nsrc-chip ok">✓ Locked/)
  assert.match(r, /<button type="button" class="nsrc-open">Open the research ↗<\/button>/)
  assert.doesNotMatch(r, /nsrc-tab/)
  const b = NS.cardHtml(NS.fromUpstream(BRIEF, { path: 'documents/b.clan' }, { version: 'v2' }), 1)
  assert.match(b, /class="nsrc nsrc-brief" data-i="1"/)
  assert.match(b, /<span class="nsrc-tab" aria-hidden="true"><svg[^]*?<\/svg>Brief<\/span>/)
  assert.match(b, /Not Just For Christmas/)
  assert.match(b, /<span class="nsrc-v">v2<\/span><span class="nsrc-chip draft">Draft/)
  assert.match(b, /Open the brief ↗/)
  assert.doesNotMatch(b, /nsrc-band|nsrc-lens/)
  // the identities: the band is the ink with the card's colour on it; the brief's title is serif on the tab's sheet
  assert.match(SC, /\.nsrc-band\{[^}]*background:var\(--ns-ink\);color:var\(--ns-card\)/)
  assert.match(SC, /\.nsrc-brief \.nsrc-t\{font:600 19px\/1\.25 var\(--ns-serif\)/)
  assert.match(SC, /\.nsrc-t\{font:600 16\.5px\/1\.3 var\(--ns-ui\)/)
})

test('a research card counts its lenses, facts, findings, sources and what is verified', () => {
  const s = NS.fromUpstream(RESEARCH)
  assert.deepEqual((s.lenses as { k: string; cov: string }[]).map(l => l.k + ':' + l.cov),
    ['market_structure:thin', 'consumer_culture:filled', 'media_spend:empty'])
  const h = NS.cardHtml(s, 0)
  assert.match(h, /<span class="nsrc-lens" role="img" aria-label="3 lenses: Market structure thin, Consumer &amp; culture filled, Media &amp; spend empty"/)
  assert.match(h, /<i class="thin"><\/i><i class="filled"><\/i><i class="empty"><\/i>/)
  assert.match(h, /<b>3<\/b> facts · <b>2<\/b> findings · <b>2<\/b> sources · <b>1<\/b> verified/)
  // nothing verified: its confidence instead; the app's own counts win
  const o = NS.cardHtml(NS.fromUpstream(RESEARCH, {}, { facts: 74, findings: 5, sources: 48, verified: null }), 0)
  assert.match(o, /<b>74<\/b> facts · <b>5<\/b> findings · <b>48<\/b> sources · low confidence/)
  // every finding verified says so; a count it does not know is left out, never a made-up 0
  assert.match(NS.cardHtml({ kind: 'research', facts: 1, findings: 2, verified: 2 }, 0), /<b>1<\/b> fact · <b>2<\/b> findings · all <b>2<\/b> verified/)
  assert.doesNotMatch(NS.cardHtml({ kind: 'research', title: 'x' }, 0), /nsrc-row/)
  // several sources stack, compactly; no Open without a path
  const l = NS.listHtml([s, NS.fromUpstream(BRIEF)])
  assert.match(l, /^<div class="nsrc-list many">/)
  assert.equal(l.split('class="nsrc nsrc-').length, 3)
  assert.doesNotMatch(NS.cardHtml(NS.fromUpstream(BRIEF), 0), /nsrc-open/)
})

// just enough of an element for mount: the cards it drew, clickable
class Card {
  on: Record<string, (e: unknown) => void> = {}
  cls = new Set<string>()
  main = { attrs: {} as Record<string, string>, setAttribute(k: string, v: string) { this.attrs[k] = v } }
  constructor(public i: number) {}
  getAttribute() { return String(this.i) }
  addEventListener(t: string, f: (e: unknown) => void) { this.on[t] = f }
  querySelector() { return this.main }
  classList = { add: (c: string) => this.cls.add(c), remove: (c: string) => this.cls.delete(c) }
}
class Host {
  cards: Card[] = []
  private h = ''
  set innerHTML(v: string) { this.h = v; this.cards = (v.match(/class="nsrc nsrc-/g) || []).map((_, i) => new Card(i)) }
  get innerHTML() { return this.h }
  querySelectorAll() { return this.cards }
}
const target = (open: boolean) => ({ closest: (sel: string) => (open && sel === '.nsrc-open' ? {} : null) })

test('a click on the card opens its details; "Open … ↗" opens the document', () => {
  const el = new Host(), seen: string[] = []
  const list = [NS.fromUpstream(RESEARCH, { path: 'documents/r.clan' }), NS.fromUpstream(BRIEF, { path: 'documents/b.clan' })]
  NS.mount(el, list, {
    details: (s, i) => seen.push('details ' + (s as Src).kind + ' ' + i),
    open: (s, i) => seen.push('open ' + (s as Src).path + ' ' + i),
  })
  assert.equal(el.cards.length, 2)
  el.cards[0].on.click({ target: target(false) })
  el.cards[1].on.click({ target: target(true), stopPropagation() {} })
  assert.deepEqual(seen, ['details research 0', 'open documents/b.clan 1'])
  NS.setOpen(el, 0)
  assert.ok(el.cards[0].cls.has('open'))
  assert.equal(el.cards[0].main.attrs['aria-expanded'], 'true')
  assert.equal(el.cards[1].main.attrs['aria-expanded'], 'false')
  NS.setOpen(el, null)
  assert.ok(!el.cards[0].cls.has('open'))
  // nothing to show: nothing drawn
  NS.mount(el, [], {})
  assert.equal(el.innerHTML, '')
})

test('Brief Maker\'s prompt shows its sources with the helper, details under the cards', () => {
  assert.equal(BM.split('<!-- @napkin:source-card -->').length, 2, 'one marker')
  assert.ok(BM.indexOf('<!-- @napkin:source-card -->') < BM.indexOf('</head>'))
  const at = BM.indexOf('function renderFromUp('), body = BM.slice(at, BM.indexOf('function upNoteInner(', at))
  assert.match(body, /NapkinSource\.mount\(cards, srcs, \{/)
  assert.match(body, /details:function\(\)\{ FU_OPEN=body\.hidden; body\.hidden=!FU_OPEN;/)
  assert.match(body, /open:function\(s\)\{ var p=s&&s\.path\|\|up_; if\(p\) fetch\(clanScheme\+'\/open'/)
  assert.doesNotMatch(body, /'From research: '|<summary/)
  assert.match(BM, /function upSources\(\)\{/)
  // the packer splices the snippet, in both apps that may carry the marker
  const rs = readFileSync(join(templates(), '..', '..', 'crates', 'clan-sdk', 'examples', 'shared', 'app_ui.rs'), 'utf8')
  assert.match(rs, /pub const SOURCE_MARKER: &str = "<!-- @napkin:source-card -->";/)
  assert.match(rs, /templates\.join\("shared\/source-card\.html"\)/)
})

test('the writing area is clean paper: no ruled lines, no margin line, the agency\'s focus ring', () => {
  const rules = [...BM.matchAll(/(^|[\s}])([^{}]*\.pta[^{}]*)\{([^}]*)\}/g)].map(m => (m[2].split(/\*\/|\n/).pop() || '').trim() + '{' + m[3] + '}')
  assert.ok(rules.length >= 2)
  for (const r of rules) {
    assert.doesNotMatch(r, /repeating-linear-gradient|#7A9CC6|inset 30px 0 0 -29px|#C9462A|#FFFDF8/, r)
  }
  const base = rules.find(r => r.startsWith('.pta{'))!
  assert.match(base, /background-image:none/)
  assert.match(base, /padding:16px 18px/)
  assert.match(base, /font:400 17px\/27px var\(--font-serif\)/)
  assert.match(rules.find(r => r.startsWith('.pta:focus'))!, /border-color:color-mix\(in srgb,var\(--ag-act-line,var\(--ag-act\)\) 85%,var\(--nd-ink\)\)/)
  // the sheet keeps its dog-ear
  assert.match(BM, /\.paperc\{[^}]*clip-path:polygon\(0 0,calc\(100% - 20px\) 0,100% 20px,100% 100%,0 100%\)/)
})

// ── contrast, in every agency look ─────────────────────────────────────────
type RGB = [number, number, number]
const hex = (h: string): RGB => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255] }
const lum = (c: RGB) => c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) })
  .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0)
const ratio = (a: RGB, b: RGB) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }

/** The studio's --nd-* tokens as the brief defines them, light (`:root{`) or dark. */
function tokens(scheme: 'light' | 'dark'): Record<string, string> {
  // the new UI's own blocks (the mock's tokens), after the build's older ones
  const open = scheme === 'light' ? ':root{\n    --ag-base:' : ':root[data-color-scheme="dark"]{\n    --ag-act:var(--ag-acc)'
  const at = BM.indexOf(open), block = BM.slice(at, BM.indexOf('}', at))
  const out: Record<string, string> = {}
  for (const m of block.matchAll(/--([a-z0-9-]+):([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
}
const LIGHT = tokens('light'), DARK = { ...LIGHT, ...tokens('dark') }
function resolve(expr: string, vars: Record<string, string>): RGB {
  expr = expr.trim()
  if (/^#[0-9a-f]{6}$/i.test(expr)) return hex(expr)
  const v = /^var\(--([a-z0-9-]+)\)$/.exec(expr)
  if (v) return resolve(vars[v[1]], vars)
  const m = /^color-mix\(in srgb,(.+?) ([\d.]+)%,(.+)\)$/.exec(expr)
  if (m) { const a = resolve(m[1], vars), b = resolve(m[3], vars), p = +m[2] / 100; return a.map((x, i) => Math.round(x * p + b[i] * (1 - p))) as RGB }
  throw new Error('cannot resolve ' + expr)
}
const AGENCIES: Record<string, { base: string; accent: string; line?: boolean; accentInk?: string }> = {
  tbwa: { base: '#16181D', accent: '#FFD400' },
  wk: { base: '#1E22AA', accent: '#FFB800' },
  boysandgirls: { base: '#000000', accent: '#FFFFFF' },
  catapult: { base: '#000000', accent: '#C61566', line: true },
  pluto: { base: '#000047', accent: '#B2F257', accentInk: '#000047' },
}

test('the card and the writing area read in every agency look, light and dark', () => {
  // the card's colours are the studio's tokens, nothing fixed but the manila tab
  assert.match(SC, /--ns-ink:var\(--nd-ink,/)
  assert.match(SC, /--ns-card:var\(--nd-card,/)
  assert.match(SC, /--ns-paper:var\(--nd-paper,/)
  assert.match(SC, /--ns-muted:var\(--nd-muted,/)
  // the locked tick is the ok green, deepened toward the ink so it reads as text
  assert.match(SC, /--ns-ok-ink:color-mix\(in srgb,var\(--ns-ok\) 80%,var\(--ns-ink\)\)/)
  assert.match(SC, /\.nsrc-chip\.ok\{color:var\(--ns-ok-ink\)\}/)
  assert.match(SC, /--ns-act:color-mix\(in srgb,var\(--ag-act-line,var\(--ag-act,var\(--ns-ink\)\)\) 85%,var\(--ns-ink\)\)/)
  const manila = /--ns-manila:(#[0-9A-F]{6}); --ns-manila-line:#[0-9A-F]{6}; --ns-manila-ink:(#[0-9A-F]{6});/i.exec(SC)!
  assert.ok(ratio(hex(manila[1]), hex(manila[2])) >= 4.5, 'BRIEF on the manila tab')
  for (const [name, a] of Object.entries(AGENCIES)) {
    for (const scheme of ['light', 'dark'] as const) {
      const vars = { ...(scheme === 'light' ? LIGHT : DARK), 'ag-base': a.base, 'ag-acc': a.accent }
      const c = (k: string) => resolve(`var(--nd-${k})`, vars)
      // the sheet the card sits on is the prompt's paper (.paperc: paper in light, card in dark)
      const okInk = resolve('color-mix(in srgb,var(--nd-ok) 80%,var(--nd-ink))', vars)
      const sheet = scheme === 'light' ? c('paper') : c('card')
      // the ring: the agency's action colour (its line colour, for Catapult), 15% toward the ink
      const act = resolve(`color-mix(in srgb,${a.line ? a.accent : scheme === 'light' ? a.base : a.accent} 85%,var(--nd-ink))`, vars)
      const pairs: [string, RGB, RGB, number][] = [
        ['band label (card on ink)', c('card'), c('ink'), 4.5],
        ['research title', c('ink'), c('card'), 4.5],
        ['counts', c('muted'), c('card'), 4.5],
        ['locked chip', okInk, c('card'), 4.5],
        ['changed chip', c('warn'), c('card'), 4.5],
        ['brief title', c('ink'), c('paper'), 4.5],
        ['brief state', c('muted'), c('paper'), 4.5],
        ['brief locked chip', okInk, c('paper'), 4.5],
        ['writing', c('ink'), sheet, 4.5],
        ['placeholder', c('faint'), sheet, 2.5],
        ['focus ring', act, sheet, 3],
        ['card on the sheet (band)', c('ink'), sheet, 3],
      ]
      for (const [what, fg, bg, min] of pairs) {
        const r = ratio(fg, bg)
        assert.ok(r >= min, `${name} ${scheme}: ${what} is ${r.toFixed(2)}:1, under ${min}:1`)
      }
    }
  }
})

test('the run stage\'s caption counts the parts, never lists them', () => {
  const at = BM.indexOf('function crewStates('), src = BM.slice(at, BM.indexOf('\n  }\n', at) + 4)
  const FIELDS = ['project_name', 'client', 'job', 'background', 'barrier', 'insight'].map(k => ({ key: k, label: k.replace('_', ' '), sec: 'Brief' }))
  const crew = new Function('FIELDS', 'STAGES', 'BUSY', `${src}\nreturn crewStates;`)(FIELDS, ['extract', 'synthesis', 'drafter', 'judge'], { judging: 1, drafting: 1, synthesising: 1 })
  const fields: Record<string, { state: string; by: string }> = {}
  FIELDS.forEach(f => { fields[f.key] = { state: 'judging', by: 'judge' } })
  const judge = crew({ stage: 'judge', state: 'running', fields }).texts.judge
  assert.equal(judge, 'checking 6 parts')
  FIELDS.forEach(f => { fields[f.key] = { state: 'drafting', by: 'drafter' } })
  assert.equal(crew({ stage: 'drafter', state: 'running', fields }).texts.drafter, '6 parts drafting at once.')
  FIELDS.slice(0, 1).forEach(f => { fields[f.key] = { state: 'synthesising', by: 'synthesis' } })
  assert.equal(crew({ stage: 'synthesis', state: 'running', fields }).texts.synthesis, 'Writing 1 part from the research.')
  // the caption under the sphere: "Step 4 of 4 · checking 21 parts", the Review agent's words unprefixed
  assert.match(BM, /st\.judge==='working'\?\(c\.texts\.judge\|\|REV_\+' is checking…'\)/)
  assert.doesNotMatch(BM, /busy\.(judge|drafter|synthesis)\.map\(label\)/)
  assert.doesNotMatch(BM, /A new version of '\+listWords\(d\.props/)
})
