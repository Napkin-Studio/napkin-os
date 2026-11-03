// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Deck Maker state fixtures (example/states/*.yaml, dev and test only) and the sample
// (example/data.yaml) all validate against schema.json, and each fixture says what its name says.
//
// The app has no YAML library and no JSON Schema validator among its declared dependencies, and
// this adds none: the two small helpers below (a reader for the YAML subset the data files use, and
// a checker for the schema keywords schema.json uses) live in this file.

import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

let root = new URL('.', import.meta.url)
while (!existsSync(new URL('package.json', root))) root = new URL('..', root)
const dir = new URL('templates/deck-maker/', root)

// ---------------------------------------------------------------- YAML subset

type Y = null | boolean | number | string | Y[] | { [k: string]: Y }

function scalar(raw: string): Y {
  const s = raw.trim()
  if (s.startsWith('"')) return JSON.parse(s) as string
  if (s.startsWith("'")) return s.slice(1, -1).replace(/''/g, "'")
  if (s === '' || s === '~' || s === 'null') return null
  if (s === 'true') return true
  if (s === 'false') return false
  if (/^-?\d+$/.test(s)) return Number(s)
  if (/^-?\d+\.\d+$/.test(s)) return Number(s)
  return s
}

// Flow collections: { a: 1, b: [x, y] }, possibly spread over lines.
function flow(src: string): Y {
  let i = 0
  const ws = () => { while (/\s/.test(src[i] ?? '')) i++ }
  const quoted = (): string => {
    const q = src[i]
    let j = i + 1
    while (j < src.length && src[j] !== q) { if (q === '"' && src[j] === '\\') j++; j++ }
    if (q === "'" && src[j + 1] === "'") { j += 2; while (j < src.length && !(src[j] === "'" && src[j + 1] !== "'")) j++ }
    const text = src.slice(i, j + 1)
    i = j + 1
    return text
  }
  const plain = (stops: string): string => {
    const start = i
    while (i < src.length && !stops.includes(src[i]!) && !(src[i] === ':' && /\s/.test(src[i + 1] ?? ' '))) i++
    return src.slice(start, i)
  }
  const value = (): Y => {
    ws()
    if (src[i] === '{') {
      i++
      const o: { [k: string]: Y } = {}
      ws()
      while (src[i] !== '}') {
        ws()
        const k = src[i] === '"' || src[i] === "'" ? String(scalar(quoted())) : plain(',}:').trim()
        ws()
        assert.equal(src[i], ':', `flow map: expected ':' after ${k}`)
        i++
        o[k] = value()
        ws()
        if (src[i] === ',') i++
        ws()
      }
      i++
      return o
    }
    if (src[i] === '[') {
      i++
      const a: Y[] = []
      ws()
      while (src[i] !== ']') {
        a.push(value())
        ws()
        if (src[i] === ',') i++
        ws()
      }
      i++
      return a
    }
    if (src[i] === '"' || src[i] === "'") return scalar(quoted())
    return scalar(plain(',}]'))
  }
  const v = value()
  ws()
  assert.equal(i, src.length, `flow value has trailing text: ${src.slice(i, i + 30)}`)
  return v
}

function balanced(s: string): boolean {
  let depth = 0
  let q = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (q) { if (c === q) q = ''; else if (c === '\\' && q === '"') i++ } else if (c === '"' || c === "'") q = c
    else if (c === '{' || c === '[') depth++
    else if (c === '}' || c === ']') depth--
  }
  return depth === 0 && !q
}

function parseYaml(text: string): Y {
  const lines = text.split('\n').filter(l => l.trim() !== '' && !l.trim().startsWith('#'))
  let at = 0
  const indentOf = (l: string) => l.length - l.trimStart().length
  const KEY = /^("[^"]*"|'[^']*'|(?:[^\s'"[{-]|-[^\s])(?:(?!:\s|:$).)*):(?:\s+(.*))?$/

  // The value text after "key:" or "- ", taking continuation lines of an open flow collection.
  function inline(first: string): Y {
    let s = first.trim()
    if (s.startsWith('{') || s.startsWith('[')) {
      while (!balanced(s)) { at++; assert.ok(at < lines.length, 'unclosed flow collection'); s += ' ' + lines[at]!.trim() }
      at++
      return flow(s)
    }
    at++
    return scalar(s)
  }

  function block(indent: number): Y {
    const l = lines[at]!
    if (/^\s*[{[]/.test(l)) return inline(l)
    return l.trimStart().startsWith('- ') || l.trim() === '-' ? seq(indent) : map(indent)
  }

  function seq(indent: number): Y {
    const out: Y[] = []
    while (at < lines.length && indentOf(lines[at]!) === indent && lines[at]!.trimStart().startsWith('-')) {
      const rest = lines[at]!.trimStart().slice(1)
      if (rest.trim() === '') {
        at++
        out.push(block(indentOf(lines[at]!)))
      } else if (KEY.test(rest.trim()) && !/^\s*[{["']/.test(rest)) {
        // "- key: value": the map's own indent is where the key starts.
        lines[at] = ' '.repeat(indent + 1 + (rest.length - rest.trimStart().length)) + rest.trimStart()
        out.push(map(indentOf(lines[at]!)))
      } else out.push(inline(rest))
    }
    return out
  }

  function map(indent: number): Y {
    const out: { [k: string]: Y } = {}
    while (at < lines.length && indentOf(lines[at]!) === indent && !lines[at]!.trimStart().startsWith('- ')) {
      const m = KEY.exec(lines[at]!.trim())
      assert.ok(m, `cannot read line: ${lines[at]}`)
      const key = String(scalar(m[1]!))
      const rest = m[2]
      if (rest === undefined || rest.trim() === '') {
        at++
        const nx = lines[at]
        if (nx && (indentOf(nx) > indent || (indentOf(nx) === indent && nx.trimStart().startsWith('- ')))) out[key] = block(indentOf(nx))
        else out[key] = null
      } else out[key] = inline(rest)
    }
    return out
  }

  const v = block(indentOf(lines[0]!))
  assert.equal(at, lines.length, `unparsed line: ${lines[at]}`)
  return v
}

// ------------------------------------------------- JSON Schema subset (draft-07)

type Schema = {
  type?: string | string[]
  enum?: unknown[]
  required?: string[]
  properties?: Record<string, Schema>
  additionalProperties?: Schema | boolean
  items?: Schema
  maxItems?: number
  oneOf?: Schema[]
}

function typeOk(v: unknown, t: string): boolean {
  if (t === 'null') return v === null
  if (t === 'array') return Array.isArray(v)
  if (t === 'object') return typeof v === 'object' && v !== null && !Array.isArray(v)
  if (t === 'integer') return Number.isInteger(v)
  return typeof v === t
}

function check(v: unknown, s: Schema, path: string, errs: string[]): void {
  if (s.type !== undefined) {
    const ts = Array.isArray(s.type) ? s.type : [s.type]
    if (!ts.some(t => typeOk(v, t))) { errs.push(`${path}: expected ${ts.join('|')}`); return }
  }
  if (s.enum && !s.enum.some(e => e === v)) errs.push(`${path}: ${JSON.stringify(v)} is not one of ${JSON.stringify(s.enum)}`)
  if (s.oneOf) {
    const hits = s.oneOf.filter(o => { const e: string[] = []; check(v, o, path, e); return e.length === 0 })
    if (hits.length !== 1) errs.push(`${path}: matches ${hits.length} of ${s.oneOf.length} oneOf branches`)
  }
  if (Array.isArray(v)) {
    if (s.maxItems !== undefined && v.length > s.maxItems) errs.push(`${path}: more than ${s.maxItems} items`)
    if (s.items) v.forEach((x, i) => check(x, s.items!, `${path}[${i}]`, errs))
  } else if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>
    for (const k of s.required ?? []) if (!(k in o)) errs.push(`${path}: missing required "${k}"`)
    for (const [k, x] of Object.entries(o)) {
      const p = s.properties?.[k]
      if (p) check(x, p, `${path}.${k}`, errs)
      else if (typeof s.additionalProperties === 'object') check(x, s.additionalProperties, `${path}.${k}`, errs)
      else if (s.additionalProperties === false) errs.push(`${path}: unexpected "${k}"`)
    }
  }
}

function validate(data: unknown, schema: Schema): string[] {
  const errs: string[] = []
  check(data, schema, '$', errs)
  return errs
}

// ---------------------------------------------------------------------- tests

const schema = JSON.parse(readFileSync(new URL('schema.json', dir), 'utf8')) as Schema
const load = (rel: string) => parseYaml(readFileSync(new URL(rel, dir), 'utf8')) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

// What each fixture must say about the run: [state, stage].
const EXPECT: Record<string, [string, string]> = {
  reading: ['building', 'scans'],
  handoff: ['building', 'storyline'],
  storyline: ['building', 'storyline'],
  gate1: ['gate', 'storyline'],
  territories: ['building', 'territories'],
  slow: ['building', 'territories'],
  gate2: ['gate', 'territories'],
  idea: ['building', 'idea'],
  gate3: ['gate', 'idea'],
  copy: ['building', 'copy'],
  deck: ['building', 'copy'],
  check: ['building', 'check'],
  failed: ['failed', 'check'],
  done: ['done', 'review'],
  'review-ready': ['done', 'review'],
  'export-ready': ['done', 'review'],
  'export-none': ['done', 'review'],
}

const files = readdirSync(new URL('example/states/', dir)).filter(f => f.endsWith('.yaml')).sort()

test('the checker itself catches a wrong type, a bad enum and a missing key', () => {
  const s: Schema = { type: 'object', required: ['a'], properties: { a: { type: 'integer' }, b: { enum: ['x'] } } }
  assert.deepEqual(validate({ a: 1, b: 'x' }, s), [])
  assert.equal(validate({ a: 'no' }, s).length, 1)
  assert.equal(validate({ a: 1, b: 'y' }, s).length, 1)
  assert.equal(validate({}, s).length, 1)
})

test('the YAML reader reads the flow, block and quoted forms the data files use', () => {
  const y = parseYaml("a: 1\nb:\n  - { x: \"q: r\", y: [1, 2] }\n  - k: 'it''s'\n    l: true\nc: { m: n,\n  o: p }\nd: []\n") as Record<string, unknown>
  assert.deepEqual(y, { a: 1, b: [{ x: 'q: r', y: [1, 2] }, { k: "it's", l: true }], c: { m: 'n', o: 'p' }, d: [] })
})

test('the sample example/data.yaml validates against the schema, unchanged', () => {
  const d = load('example/data.yaml')
  assert.deepEqual(validate(d, schema), [])
  assert.equal(d.run.state, 'gate')
  assert.equal(d.run.stage, 'storyline')
  assert.equal(d.inputs.prompt.client, 'Lumen Water')
})

test('there is one fixture for each state, and no other', () => {
  assert.deepEqual(files.map(f => f.replace(/\.yaml$/, '')), Object.keys(EXPECT).sort())
})

for (const f of files) {
  const name = f.replace(/\.yaml$/, '')
  test(`fixture ${name}: valid, and says what its name says`, () => {
    const d = load(`example/states/${f}`)
    assert.deepEqual(validate(d, schema), [], `${f} breaks the schema`)
    const [state, stage] = EXPECT[name]!
    assert.equal(d.run.state, state, 'run.state')
    assert.equal(d.run.stage, stage, 'run.stage')
    assert.equal(d.fixture.name, name)
    assert.match(d.fixture.label, /sample, not engine output/)
    // Stage statuses agree with the current stage: before it done, it now (failed on failure, done once exported), after it next.
    const ids = d.run.stages.map((s: { id: string }) => s.id)
    const at = ids.indexOf(stage)
    assert.ok(at >= 0, 'run.stage is one of run.stages')
    d.run.stages.forEach((s: { id: string; status: string }, i: number) => {
      const want = i < at ? 'done' : i > at ? 'next' : state === 'failed' ? 'failed' : name.startsWith('export') ? 'done' : 'now'
      assert.equal(s.status, want, `stage ${s.id}`)
    })
    // The gate is open only in a gate state, and it is the current stage's.
    if (state === 'gate') assert.equal(d.run.gate.id, stage)
    else assert.equal(d.run.gate, null)
    assert.equal(d.run.agent.step_total, 7)
    // Nothing the person reads in `run` carries a percentage or a time range.
    const text = JSON.stringify(d.run)
    assert.doesNotMatch(text, /\d\s?%/)
    assert.doesNotMatch(text, /\d+\s?(min|sec|hours?)\b/i)
  })
}

test('each state carries what its screen needs', () => {
  const f = (n: string) => load(`example/states/${n}.yaml`)
  assert.equal(f('gate1').run.gate.beats.length, 6)
  const g2 = f('gate2').run.gate
  assert.equal(g2.territories.length, 3)
  assert.ok(g2.territories.some((t: { id: string }) => t.id === g2.first_pick))
  const g3 = f('gate3').run.gate
  assert.equal(g3.idea.basis, 'proposal')
  assert.equal(g3.idea.territory_id, f('gate3').run.approvals.territories.picked)
  assert.ok(f('slow').run.agent.slow === true && !f('storyline').run.agent.slow)
  assert.equal(f('handoff').run.agent.to, 'strategy')
  assert.equal(f('failed').run.error.retryable, true)
  assert.equal(f('done').run.done.slides, 7)
  assert.equal(f('review-ready').run.approvals.deck, undefined)
  assert.ok(f('export-ready').run.approvals.deck)
  const ex = f('export-ready').exports
  assert.ok(ex.web.url && ex.pptx.file && ex.pdf.file && ex.anim === undefined)
  assert.equal(f('export-none').exports, undefined)
  assert.equal(f('done').deck.appendix_ids.length, f('done').deck.appendix_count)
})

test('exports take the older `true` shape as well as the object', () => {
  const d = load('example/states/export-ready.yaml')
  d.exports = { web: true, pptx: { file: 'a.pptx' } }
  assert.deepEqual(validate(d, schema), [])
  d.exports = { web: 'a.html' }
  assert.notDeepEqual(validate(d, schema), [])
  d.exports = { pdf: { url: 'x' } }
  assert.notDeepEqual(validate(d, schema), [])
})
