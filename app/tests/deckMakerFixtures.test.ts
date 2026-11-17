// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Deck Maker state fixtures (example/states/*.yaml, dev and test only) and the sample
// (example/data.yaml) all validate against schema.json, and each fixture says what its name says.
//
// The app has no YAML library and no JSON Schema validator among its declared dependencies, and
// this adds none: the YAML reader is deckMakerYaml.ts (shared with deckMaker.test.ts), and the
// checker for the schema keywords schema.json uses lives in this file.

import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parseYaml } from './deckMakerYaml'
import { validate, type Schema } from './schemaCheck'

let root = new URL('.', import.meta.url)
while (!existsSync(new URL('package.json', root))) root = new URL('..', root)
const dir = new URL('templates/deck-maker/', root)

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

test('the checker bites on each added keyword: const, pattern, minimum, maximum, minItems, minLength, maxLength, propertyNames, uniqueItems, if/then', () => {
  const s: Schema = {
    type: 'object',
    properties: {
      c: { const: true }, p: { type: 'string', pattern: '^img_[0-9a-f]{12}$' }, n: { type: 'number', minimum: 0, maximum: 10 },
      a: { type: 'array', minItems: 1 }, l: { type: 'string', minLength: 1, maxLength: 3 },
      m: { type: 'object', propertyNames: { pattern: '^s[0-9]{2}$' }, additionalProperties: { type: 'boolean' } },
      u: { type: 'array', uniqueItems: true },
    },
    if: { properties: { c: { const: true } }, required: ['c'] },
    then: { required: ['t'] },
  }
  const ok = { c: true, t: 1, p: 'img_0123456789ab', n: 5, a: [1], l: 'ab', m: { s01: true }, u: [1, 2] }
  assert.deepEqual(validate(ok, s), [])
  const { t: _t, ...noThen } = ok // eslint-disable-line @typescript-eslint/no-unused-vars
  assert.equal(validate(noThen, s).length, 1, 'then applies when if matches')
  assert.equal(validate({ ...noThen, c: false }, s).length, 1, 'c: false breaks const; then is skipped')
  for (const bad of [{ c: false }, { p: 'img_x' }, { n: -1 }, { n: 11 }, { a: [] }, { l: '' }, { l: 'abcd' }, { m: { slide1: true } }, { m: { s01: 'no' } }, { u: [1, 1] }]) {
    assert.equal(validate({ ...ok, ...bad }, s).length, 1, JSON.stringify(bad))
  }
})

// Every keyword schema.json uses is one the checker above reads, or a note that checks nothing. A limit written with any other
// keyword would pass this file's tests unchecked, so adding one has to extend the checker (with a case above that bites) first.
const CHECKED = ['type', 'enum', 'required', 'properties', 'additionalProperties', 'items', 'maxItems', 'oneOf', 'const', 'pattern',
  'minimum', 'maximum', 'minItems', 'minLength', 'maxLength', 'propertyNames', 'default', 'uniqueItems', 'if', 'then']
const NOTES = ['$schema', 'title', 'description', '$comment', 'x-clan-appearance']

function keywords(s: Schema, found: Set<string>): void {
  for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
    found.add(k)
    if (k === 'properties') for (const x of Object.values(v as Record<string, Schema>)) keywords(x, found)
    else if (k === 'items' || k === 'propertyNames' || k === 'if' || k === 'then' || (k === 'additionalProperties' && typeof v === 'object')) keywords(v as Schema, found)
    else if (k === 'oneOf') for (const x of v as Schema[]) keywords(x, found)
  }
}

test('schema.json uses only keywords the checker reads', () => {
  const found = new Set<string>()
  keywords(schema, found)
  const unread = [...found].filter(k => !CHECKED.includes(k) && !NOTES.includes(k))
  assert.deepEqual(unread, [], `schema.json uses keywords this file does not check: ${unread.join(', ')}`)
  // The guard itself bites on a keyword outside both lists.
  const probe = new Set<string>()
  keywords({ type: 'object', properties: { a: { type: 'string', format: 'date' } } } as Schema, probe)
  assert.ok([...probe].some(k => !CHECKED.includes(k) && !NOTES.includes(k)))
})

test('the added schema fields check what the contract says (deck-visuals.md 6.3)', () => {
  const ok = { inputs: { pictures: { source: { allow: 'existing', cap_usd: 2.5 }, approval: { approver: 'owner', label: 'Illustrative' } } }, look: { pictures: { on: 'creative' }, density: { level: 'lean' } } }
  assert.deepEqual(validate(ok, schema), [])
  const bad = (o: unknown) => validate(o, schema).length > 0
  assert.ok(bad({ inputs: { pictures: { approval: { label: 'Draft 2' } } } }))
  assert.ok(bad({ inputs: { pictures: { source: { cap_usd: 11 } } } }))
  assert.ok(bad({ look: { pictures: { on: 'everywhere' } } }))
  assert.ok(bad({ look: { surprise: true } }))
  assert.ok(bad({ review: { pinned: { slide3: { by: 'a', at: 'b' } } } }))
  assert.ok(bad({ qa: { issues: { nope: {} } } }))
  assert.ok(bad({ repair: { rounds: [{}, {}, {}] } }))
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

test('review-ready and both export states have every fact supplied and every confirm item verified', () => {
  for (const n of ['review-ready', 'export-ready', 'export-none']) {
    const d = load(`example/states/${n}.yaml`)
    assert.equal(d.validation.to_supply, 0, n)
    assert.equal(d.run.done.to_supply, 0, n)
    const refs = d.deck.meta.confirm.map((c: { ref: string }) => c.ref)
    assert.deepEqual(Object.keys(d.intake.verified).sort(), [...refs].sort(), `${n}: every confirm item verified`)
    const card = d.intake.questions.find((q: { kind?: string }) => q.kind === 'supply')
    assert.ok(card && d.intake.answers[card.id].text, `${n}: the supply card is answered`)
    const s06 = d.deck.slides.s06
    assert.equal(s06.status, 'from_source')
    assert.deepEqual(s06.supplied.refs, ['answer:' + card.id])
    assert.ok(d.evidence['answer:' + card.id], `${n}: the answer is evidence`)
    assert.ok(d.run.checks.length > 0, `${n}: Checked so far`)
    for (const id of d.deck.appendix_ids) assert.equal(d.deck.slides[id].blocks.length, 1, `${n}: ${id} has a line`)
  }
  for (const n of ['export-ready', 'export-none']) {
    const r = load(`example/states/${n}.yaml`).run
    assert.equal(r.approvals.deck.decision, 'approve')
    assert.deepEqual(r.decisions.at(-1), { gate: 'deck', kind: 'approve', by: 'Sai', at: r.approvals.deck.at })
  }
})

test('exports take the older `true` and file-name shapes as well as the object', () => {
  const d = load('example/states/export-ready.yaml')
  d.exports = { web: true, pptx: { file: 'a.pptx' } }
  assert.deepEqual(validate(d, schema), [])
  d.exports = { web: 'a.html', pptx: 'a.pptx', anim: 'a.hf.json', pdf: 'a.pdf' }
  assert.deepEqual(validate(d, schema), [])
  d.exports = { web: 5 }
  assert.notDeepEqual(validate(d, schema), [])
  d.exports = { web: false }
  assert.notDeepEqual(validate(d, schema), [])
  d.exports = { pdf: { url: 'x' } }
  assert.notDeepEqual(validate(d, schema), [])
})

test('the Deck template is 0.4.0 and takes a Brand Clan and a Style Pack one at a time (deck-look-kits)', () => {
  const rs = readFileSync(new URL('../crates/clan-sdk/examples/make_deck_maker.rs', root), 'utf8')
  assert.match(rs, /version: "0\.4\.0"\.into\(\)/)
  assert.match(rs, /assert_eq!\(app_block\.version, "0\.4\.0"/)
  assert.match(rs, /BRAND_APP_ID\.into\(\),\s+STYLE_PACK_APP_ID\.into\(\)/)
  assert.match(rs, /many: vec!\[RESEARCH_APP_ID\.into\(\)\]/)
})

test('look.agency_look is a per-deck opt-out that defaults to on, and a bad value is caught', () => {
  const look = (schema.properties!.look as Schema).properties!.agency_look as Schema
  assert.deepEqual(look.default, { use: true })
  const wrap: Schema = { type: 'object', properties: { agency_look: look } }
  assert.deepEqual(validate({ agency_look: { use: false, via: 'start' } }, wrap), [])
  assert.equal(validate({ agency_look: { use: 'no' } }, wrap).length, 1)
  assert.equal(validate({ agency_look: { use: true, colour: 'red' } }, wrap).length, 1)
})
