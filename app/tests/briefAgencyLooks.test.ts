// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The brief wears the agency looks of commit 7269fef7: the agency's square mark
// on its stand-in logo tile when the shell gives one (Boys+Girls, Catapult,
// Pluto), and, for an agency whose accent is a line (Catapult's crimson), a
// primary button that is the base, outlined in the accent, in dark as in light.

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

function balanced(src: string, start: number): number {
  let depth = 0
  for (let i = start; i < src.length; i++) {
    const c = src[i]
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue }
    if (c === "'" || c === '"' || c === '`') { for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++; continue }
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
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[c])
const ICON = 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E'

/** The brief's tileOf and logoTileHtml, with NapkinAgency.now() giving `agency`. */
function tiles(agency: Record<string, unknown> | null) {
  const window = { NapkinAgency: { now: () => agency } }
  const env = { window, NapkinAgency: window.NapkinAgency, esc, agencyName: () => 'Catapult', clientName: () => 'McD', get: () => '', readable: () => '#fff',
    initialsOf: (n: string) => n.slice(0, 2).toUpperCase() }
  return new Function(...Object.keys(env), `${fn(BM, 'tileOf')}\n${fn(BM, 'logoTileHtml')}\nreturn { tileOf: tileOf, logoTileHtml: logoTileHtml };`)(...Object.values(env))
}

test('the agency tile is the agency\'s icon when the shell gives one, else its initials', () => {
  const withIcon = tiles({ base: '#000000', accent: '#C61566', name: 'Catapult', icon: ICON })
  const t = withIcon.tileOf('agency')
  assert.equal(t.icon, ICON)
  assert.equal(withIcon.logoTileHtml(t), `<span class="b-logo has-icon"><img src="${ICON}" alt="Catapult" /></span>`)
  assert.match(withIcon.logoTileHtml(t, 'lb-tile'), /^<span class="lb-tile has-icon"><img /)
  // an agency with no icon keeps its initials, on its colours
  const plain = tiles({ base: '#1E22AA', accent: '#FFB800', name: 'Wieden+Kennedy', icon: null })
  const p = plain.tileOf('agency')
  assert.equal(p.icon, '')
  assert.equal(plain.logoTileHtml(p), '<span class="b-logo" style="--ib:#1E22AA;--if:#FFB800">CA</span>')
  // only an inline picture counts as an icon
  assert.equal(tiles({ base: '#000000', accent: '#FFFFFF', icon: 'https://example.com/x.png' }).tileOf('agency').icon, '')
  // the client's tile is never the agency's icon
  assert.equal(withIcon.tileOf('client').icon, undefined)
  // the fold says what comes back
  assert.match(BM, /Show '\+esc\(tileOf\(k\)\.name\)\+'’s '\+\(tileOf\(k\)\.icon\?'logo':'initials'\)/)
})

/** NapkinAgency, as the fields snippet ships it, over a stand-in root element. */
function agencyLayer() {
  const props: Record<string, string> = {}, attrs: Record<string, string> = {}
  const root = { style: { setProperty: (k: string, v: string) => { props[k] = v }, removeProperty: (k: string) => { delete props[k] } },
    setAttribute: (k: string, v: string) => { attrs[k] = v }, removeAttribute: (k: string) => { delete attrs[k] } }
  const document = { readyState: 'loading', documentElement: root }
  const window = { addEventListener() {}, dispatchEvent() { return true } }
  const at = CLF.indexOf('var NapkinAgency=(function(){')
  const src = CLF.slice(at, balanced(CLF, CLF.indexOf('{', at)) + 4)
  const A = new Function('window', 'document', 'CustomEvent', `${src}; return NapkinAgency;`)(window, document, class {})
  return { A, props, attrs }
}

test('an agency whose accent is a line: the brief\'s primary is the base, outlined in the accent, in dark too', () => {
  const { A, props, attrs } = agencyLayer()
  A.apply({ name: 'Catapult', base: '#000000', accent: '#C61566', accentUse: 'line' })
  assert.equal(attrs['data-agency-accent'], 'line')
  assert.equal(props['--ag-act-line'], '#C61566')
  assert.equal(A.now().accentUse, 'line')
  // in dark the action is the base with its ink, not the crimson accent
  assert.match(BM, /:root\[data-agency-accent="line"\]\[data-color-scheme="dark"\]\{ --ag-act:var\(--ag-base\); --ag-act-ink:var\(--ag-base-ink\); \}/)
  assert.match(BM, /@media \(prefers-color-scheme:dark\)\{ :root\[data-agency-accent="line"\]:not\(\[data-color-scheme="light"\]\)\{ --ag-act:var\(--ag-base\); --ag-act-ink:var\(--ag-base-ink\); \} \}/)
  // and those rules come after the dark defaults that make the accent the action
  assert.ok(BM.indexOf(':root[data-agency-accent="line"][data-color-scheme="dark"]') > BM.indexOf(':root[data-color-scheme="dark"]{\n    --ag-act:var(--ag-acc);'))
  // the primary buttons are outlined in the line colour where an agency sets one
  assert.match(BM, /\.btn-primary\{[^}]*border:1px solid var\(--ag-act-line,var\(--ag-act\)\)/)
  assert.match(BM, /\.lock\.btn-primary\{[^}]*border:1px solid var\(--ag-act-line,var\(--ag-act\)\)/)
  assert.doesNotMatch(BM, /btn-primary\{[^}]*background:#C61566/i)
  // another agency after it fills as before: no line, no outline colour
  A.apply({ name: 'Wieden+Kennedy', base: '#1E22AA', accent: '#FFB800' })
  assert.equal(attrs['data-agency-accent'], undefined)
  assert.equal(props['--ag-act-line'], undefined)
  assert.equal(A.now().accentUse, 'fill')
})
