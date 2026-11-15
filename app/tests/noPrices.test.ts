// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// No price, cost, credit, spend or budget figure on any screen (features/align-confidential-prices.clan, done_when
// line 8; the review of 15 Nov, item 3). The owner's rule of 13 Nov: no prices or costs in the interface; a run's
// cost and a job's budget are recorded per job and read only in the decision tree (the Decisions drawer).
//
// This reads what a person can see, by parsing, not by a regex over the source that formatting defeats: every
// .ts/.tsx/.js file of app/src and app/templates is parsed with the TypeScript compiler (JSX text with its {…}
// parts, text on its own line, string literals of any case, template literals with ${…} parts, the visible JSX
// attributes); every .html template is parsed as a document (its text, its visible attributes, and its inline
// scripts, parsed as above). It leaves out what no person reads: import paths, object keys, type literals, the
// operands of a comparison, case labels, index keys, and the non-visible attributes (class names, ids, test ids).
// A brief about a price promotion is document content and is never read here.
//
// What may still say one of the words is on ALLOWED: one file, the exact strings it may say, and why.
//
// Out of scope: production-tool/ (its own price words are the record production-platform-rules'; this record does
// not touch that tree), crates/ (the server's words; the provenance export is another record's), and the tests,
// goldens and fixtures.

import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import ts from 'typescript'
import { JSDOM } from 'jsdom'
import { teaserFor } from '../src/shell/home/doorWords.ts'

const app = resolve(process.cwd())

/** A currency sign (a dollar only as money: "$1" in a replace pattern is not), a currency code beside a figure, and the
 *  words. "per cent" is not money. */
export const MONEY = /\$(?=\s|$|\d+[.,]\d)|[€£]|\b(?:EUR|USD|GBP)\s?\d|\d\s?(?:EUR|USD|GBP)\b|(?<!per )\bcents?\b|\beuros?\b|\bdollars?\b|\bcredits?\b|\bbudget(?:s|ed)?\b|\bpric(?:e|es|ed|ing)\b|\bcost(?:s|ing)?\b|\bspen(?:d|ds|ding|t)\b|\bmoney\b|\bcharg(?:e|es|ed)\b|\bhours? used\b|\b\d+ of \d+ hours\b/i

/** JSX attributes a person reads (or a screen reader says). Every other attribute is a name, an id or a style. */
const VISIBLE_ATTRS = new Set(['placeholder', 'title', 'aria-label', 'aria-description', 'alt', 'label', 'value', 'content'])

/** Keys whose values are ids, codes or paths: a machine reads them, a person never does. */
const ID_KEYS = new Set(['id', 'code', 'kind', 'key', 'type', 'door', 'appId', 'app_id', 'path', 'href', 'route', 'action', 'event', 'testid', 'ref'])

/** A string with its markup taken out: a template's literal often holds HTML. */
const words = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

function jsxName(n: ts.JsxAttribute): string {
  return n.name.getText()
}

/** Is this string literal in a place no person reads? */
function hidden(node: ts.Node): boolean {
  const p = node.parent
  if (!p) return false
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p) || ts.isImportTypeNode(p.parent ?? p)) return true
  if (ts.isLiteralTypeNode(p)) return true
  if ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p)) && p.name === node) return true
  if (ts.isElementAccessExpression(p) && p.argumentExpression === node) return true
  if (ts.isCaseClause(p)) return true
  if (ts.isPropertyAssignment(p) && p.initializer === node && ID_KEYS.has(p.name.getText().replace(/['"]/g, ''))) return true
  if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.InKeyword].includes(p.operatorToken.kind)) return true
  if (ts.isJsxAttribute(p) && !VISIBLE_ATTRS.has(jsxName(p))) return true
  if (ts.isJsxExpression(p) && p.parent && ts.isJsxAttribute(p.parent) && !VISIBLE_ATTRS.has(jsxName(p.parent))) return true
  return false
}

/** The text of a JSX element as a person reads it: its text and a stand-in figure for each {…}. */
function jsxText(el: ts.JsxElement | ts.JsxFragment): string {
  return words(el.children.map(c => {
    if (ts.isJsxText(c)) return c.text
    if (ts.isJsxExpression(c)) {
      const e = c.expression
      if (!e) return ''
      if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text
      return ' 9 '
    }
    return ' '
  }).join(''))
}

/** Every string of a script a person could read. `kind` says how to parse it. */
export function interfaceStrings(source: string, file = 'x.tsx'): string[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.ts') ? ts.ScriptKind.TS : file.endsWith('.jsx') ? ts.ScriptKind.JSX : ts.ScriptKind.JS
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind)
  const out: string[] = []
  // a path or a URL (a route, a fetch) is not words
  const push = (s: string) => { const w = words(s); if (/[A-Za-z€£$]/.test(w) && !/^(\/|https?:|\.\/)/.test(w)) out.push(w) }
  const visit = (n: ts.Node) => {
    if (ts.isJsxElement(n) || ts.isJsxFragment(n)) {
      const t = jsxText(n)
      if (t) push(t)
    } else if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && !hidden(n)) {
      push(n.text)
    } else if (ts.isTemplateExpression(n) && !hidden(n)) {
      push(n.head.text + n.templateSpans.map(s => ' 9 ' + s.literal.text).join(''))
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

/** Every string of an HTML template a person could read: its text, its visible attributes, its inline scripts'. */
export function htmlStrings(html: string): string[] {
  const doc = new JSDOM(html).window.document
  const out: string[] = []
  for (const s of Array.from(doc.querySelectorAll('script'))) {
    if (!s.getAttribute('src') && !/json|template/.test(s.getAttribute('type') ?? '')) out.push(...interfaceStrings(s.textContent ?? '', 'inline.js'))
    s.remove()
  }
  for (const s of Array.from(doc.querySelectorAll('style'))) s.remove()
  const walker = doc.createTreeWalker(doc.documentElement, 4 /* NodeFilter.SHOW_TEXT */)
  for (let t = walker.nextNode(); t; t = walker.nextNode()) { const w = words(t.textContent ?? ''); if (/[A-Za-z€£$]/.test(w)) out.push(w) }
  for (const el of Array.from(doc.querySelectorAll('*'))) {
    for (const a of ['placeholder', 'title', 'aria-label', 'alt']) { const v = el.getAttribute(a); if (v && /[A-Za-z€£$]/.test(v)) out.push(words(v)) }
  }
  return out
}

const stringsOf = (path: string) => (path.endsWith('.html') ? htmlStrings : (s: string) => interfaceStrings(s, path))(readFileSync(path, 'utf8'))

function interfaceFiles(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) { if (!['node_modules', 'dist', 'fixtures', 'example', 'wasm'].includes(f)) interfaceFiles(p, out) }
    else if (/\.(ts|tsx|js|jsx|html)$/.test(f) && !/\.(test|spec|golden|d)\./.test(f)) out.push(p)
  }
  return out
}

interface Allowed { file: string; strings: readonly string[]; why: string }

/** Where a word on the list is not a price of Napkin's but the client's own words, or the one place costs are read.
 *  Each entry is the exact strings, nothing broader. */
const ALLOWED: Allowed[] = [
  { file: 'src/shell/decisions/words.ts', strings: ['this run cost 9', 'recorded the budget', 'recorded the budget: 9 9', 'budget', 'media and spend', 'Media and spend', 'spent'],
    why: 'the decision tree is the one place a run cost and a recorded budget are read; budget is a client\'s reason word, Media and spend a research lens\'s name (the market\'s spend), and spent one of the irregular past tenses the words are made with' },
  { file: 'src/shell/job/JobDecisions.tsx', strings: ['Record the budget', 'Only account service, management and producers record a budget.'],
    why: 'the job\'s Decisions is where the Money roles record a budget, as a set_budget decision; the figure is read there only, by them' },
  { file: 'src/shell/clientReview/review.ts', strings: ['Budget'], why: 'Budget is one of the reasons a client gives for a change: a word of the client\'s feedback, with no figure' },
  { file: 'src/components/states/doors.ts', strings: ['Time and money', 'J001: 41 of 60 hours used.'],
    why: 'Time and money is a page door\'s name from the build prompt (the owner renames it, not a builder); its example\'s hours figure is shown only to a role that may read a budget (shell/home/doorWords.ts, teaserFor)' },
  { file: 'templates/brief-maker/index.html', strings: [
    'Budget & scope', 'Budget and scope', 'budget, cost, spend, scope', 'Whether the budget fits the ambition', 'Budget', 'budget',
    'about the client, the audience and the budget, then export.',
    'We need our soft-serve dessert to own summer for 16–24s. Volume has been flat for two summers while frozen drinks and delivery desserts grew. The product is loved, but nobody plans to go for one; they just end up getting one. Commercial target: +12% unit growth June to August with no price promotion. No "limited time" language; €140k production budget.',
    'Our relish is a much-loved pantry jar, but under-35 households see it as their parents’ brand. We want them to reach for it on an ordinary weeknight, not only at Christmas. €150k across TV and social.',
    'Our alcohol-free stout is now on draught in 400 pubs, but drinkers still buy it by the can at home. We want autumn pub visits where the alcohol-free pint is the first round, not the last resort. €90k for on-trade and social.',
  ], why: 'Budget and scope is a part of the brief, with its search words, a Brief gate question, the client\'s reason Budget and the export hint; the three example asks are a client\'s own words with the client\'s figure (listed for the owner in the record\'s open_questions), never a cost of Napkin\'s' },
  { file: 'templates/campaign-research/index.html', strings: ['Budget band', 'EUR band', 'Under €50k', '€50k–€250k', '€250k–€1m', '€1m–€5m', 'Over €5m', 'Media & spend', 'I’ll track who spends where.', 'who spends what on ads, and where', 'Where does the money go: channels and share of spend?'],
    why: 'the client\'s budget band is a field of the research brief, shown as a band (listed for the owner); Media and spend is a research lens about the market\'s advertising spend, never a cost of Napkin\'s' },
  { file: 'templates/shared/clan-fields.html', strings: ['€', '£', '$', 'budget', 'it does not fit the budget'],
    why: 'a fact\'s own unit as the source gave it (a client\'s figure, "€412 million"), the client\'s reason word Budget, and a Brief gate reason' },
  { file: 'templates/shared/source-card.html', strings: ['Media & spend'], why: 'the name of a research lens about the market\'s advertising spend, on a source\'s card' },
  { file: 'templates/deck-maker/index.html', strings: ['the budget', 'Things you must supply, like the presenter or the budget split, show as labelled placeholders. They are never made up.'],
    why: 'what a pitch deck must cover and leave to a person: the client\'s budget as the deck\'s own content, never a cost of Napkin\'s' },
]

test('the reader sees JSX text with {…}, text on its own line, lower-case labels, ${…} templates and the new words', () => {
  const seen = (src: string, file = 'x.tsx') => interfaceStrings(src, file).some(s => MONEY.test(s))
  // the review's cases (/tmp/review-prices/app/tests/zzReviewPrices.test.ts), kept as they were written
  assert.ok(seen('const a = <dd>Budget: {hours} hours</dd>'), 'jsx text with an interpolation')
  assert.ok(seen('const a = <p>\n  Cost to build this deck\n</p>'), 'jsx text on its own line')
  assert.ok(seen("const tile = { label: 'cost' }"), 'a lower-case one-word label')
  assert.ok(seen('const s = `${n} credits left`'), 'a template literal with a figure')
  for (const s of ["'Hours and spend against each job go here.'", "'J001: 41 of 60 hours used.'", "'USD 4.20 so far'", "'EUR 12 charged'", "'Time and money'"]) assert.ok(seen(`const a = ${s}`), s)
  // and an HTML template's text, attributes and inline scripts
  assert.ok(htmlStrings('<p>\n Cost to build\n</p>').some(s => MONEY.test(s)))
  assert.ok(htmlStrings('<input placeholder="Your budget">').some(s => MONEY.test(s)))
  assert.ok(htmlStrings("<script>el.innerHTML = '<span>' + n + ' credits</span>'</script>").some(s => MONEY.test(s)))
  // what no person reads is not read
  assert.deepEqual(interfaceStrings("import x from './budget'\nconst k = { budget: 1 }\nif (d.kind === 'cost') {}\ntype T = 'price'\nconst c = <i className=\"cost\" data-testid=\"job-budget\" />"), [])
  assert.ok(!MONEY.test("s.replace(/(a)/, '$1')") && !MONEY.test('23 per cent') && !MONEY.test('run_cost'))
})

test('no price, cost, credit, spend or budget word in what a person sees of the shell or a template, but what ALLOWED names', () => {
  const found: string[] = []
  for (const p of [...interfaceFiles(join(app, 'src')), ...interfaceFiles(join(app, 'templates'))]) {
    const rel = p.slice(app.length + 1)
    const ok = new Set(ALLOWED.filter(a => a.file === rel).flatMap(a => a.strings))
    for (const s of stringsOf(p)) if (MONEY.test(s) && !ok.has(s)) found.push(`${rel}: ${s.slice(0, 110)}`)
  }
  assert.deepEqual([...new Set(found)], [], 'these strings show a price, cost, credit, spend or budget')
})

test('every allowed string is still there and says why, so the list does not outlive what it excuses', () => {
  for (const a of ALLOWED) {
    assert.ok(existsSync(join(app, a.file)), a.file)
    assert.ok(a.why.length > 30, `${a.file} needs a written reason`)
    const there = new Set(stringsOf(join(app, a.file)))
    for (const s of a.strings) assert.ok(there.has(s), `${a.file}: "${s}" is no longer said`)
  }
})

test('the Time and money door shows its hours figure only to a role that may read a budget', () => {
  const figure = /\d+ of \d+ hours|hours used/
  const money = teaserFor('time-money', null, true)
  assert.match(money.example.lines.join(' '), figure, 'a Money role reads the example as written')
  for (const may of [false, undefined]) {
    const other = teaserFor('time-money', null, may)
    assert.doesNotMatch(JSON.stringify(other), figure, `no figure when may read is ${may}`)
    assert.ok(other.example.lines.length > 0, 'still a finished example, with no figure')
  }
})
