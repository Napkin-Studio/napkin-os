// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Style Pack template (templates/style-pack, ie.napkin.style-pack): its invented example validates against its schema, the
// schema refuses what a pack must never carry, and the rules in its context survive (deck-look-kits).

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parseYaml } from './deckMakerYaml'
import { validate, type Schema } from './schemaCheck'

let root = new URL('.', import.meta.url)
while (!existsSync(new URL('package.json', root))) root = new URL('..', root)
const dir = new URL('templates/style-pack/', root)
const schema = JSON.parse(readFileSync(new URL('schema.json', dir), 'utf8')) as Schema
const example = parseYaml(readFileSync(new URL('example/data.yaml', dir), 'utf8')) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const clone = () => JSON.parse(JSON.stringify(example)) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

test('the invented example validates against the schema', () => {
  assert.deepEqual(validate(example, schema), [])
  assert.equal(example.kit.version, 1)
  assert.deepEqual(example.kit.stewards, ['human:demo-steward'])
})

test('the schema refuses a model outside the catalogue, a missing steward, an unknown key and a bad rights value', () => {
  const m = clone(); m.models.hero = 'some_other_model'
  assert.equal(validate(m, schema).length, 1)
  const s = clone(); s.kit.stewards = []
  assert.equal(validate(s, schema).length, 1)
  const g = clone(); g.guard_rails = 'off'
  assert.equal(validate(g, schema).length, 1)
  const r = clone(); r.references.r1.rights = 'public_domain'
  assert.equal(validate(r, schema).length, 1)
  const a = clone(); a.references.r1.asset = 'human/assets/anything.png'
  assert.equal(validate(a, schema).length, 1)
})

test('a pack names at most eight this-not-that pairs and fourteen look words are too many', () => {
  const t = clone(); t.this_not_that.tn09 = { this: 'a', not: 'b' }
  assert.equal(validate(t, schema).length > 0, true)
  const l = clone(); l.look = Array.from({ length: 9 }, (_, i) => 'w' + i)
  assert.equal(validate(l, schema).length, 1)
})

test('the deck section is optional and empty in the example; its pointers are checked', () => {
  assert.equal('deck' in example, false)
  const d = clone(); d.deck = { colours: { accent: { hex: 'A8431D' }, paper: { agency: 'base' } }, type: { head: { family: 'Georgia', fallback: ['serif'] } } }
  assert.deepEqual(validate(d, schema), [])
  const bad = clone(); bad.deck = { colours: { accent: { hex: 'red' } } }
  assert.equal(validate(bad, schema).length, 1)
})

test('the context keeps the rules: stewards, rights, models, no words on slides', () => {
  const ctx = readFileSync(new URL('context.md', dir), 'utf8')
  for (const phrase of ['steward', 'own', 'licensed', '14', 'catalogue', 'holds no word', 'never remade']) assert.ok(ctx.includes(phrase), phrase)
})
