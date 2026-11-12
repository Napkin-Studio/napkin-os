// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Booth hidden or shown is kept by the shell, per person and per tool
// (features/booth.clan): the page says `clan:booth {open}`, the shell stores
// it and posts it back on every load. The frame is sandboxed; its storage throws.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { boothFrom, boothKey, boothMessage, readBooth, writeBooth } from '../src/shell/booth.ts'

function memory() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, m }
}

test('the Booth is kept per person and per tool', () => {
  const s = memory()
  const sam = boothKey('Sam@WK', 'brief-maker')
  assert.equal(sam, boothKey('sam@wk', 'brief-maker'), 'the account name as the server records it')
  assert.equal(readBooth(sam, s), true, 'open until someone hides it')
  writeBooth(sam, false, s)
  assert.equal(readBooth(sam, s), false)
  assert.equal(readBooth(boothKey('sam@wk', 'campaign-research'), s), true, 'another tool: its own')
  assert.equal(readBooth(boothKey('tia@tbwa', 'brief-maker'), s), true, 'another person: their own')
  writeBooth(sam, true, s)
  assert.equal(readBooth(sam, s), true)
})

test('storage that refuses leaves the Booth open and throws nothing', () => {
  const bad = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
  assert.equal(readBooth('k', bad), true)
  assert.doesNotThrow(() => writeBooth('k', false, bad))
  assert.equal(readBooth('k', null), true)
})

test('only a clan:booth with a yes or no is heard; what the page hears on load', () => {
  assert.equal(boothFrom({ type: 'clan:booth', open: false }), false)
  assert.equal(boothFrom({ type: 'clan:booth', open: true }), true)
  assert.equal(boothFrom({ type: 'clan:booth', open: 'no' }), null)
  assert.equal(boothFrom({ type: 'clan:jobs', jobs: [] }), null)
  assert.equal(boothFrom(null), null)
  assert.deepEqual(boothMessage(false), { type: 'clan:booth', open: false })
})

test('the shell posts the stored choice on every load and stores what the page says', () => {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 6 && !existsSync(join(dir, 'src', 'shell')); i++) dir = dirname(dir)
  const rt = readFileSync(join(dir, 'src', 'shell', 'AppRuntime.tsx'), 'utf8')
  const onLoad = rt.slice(rt.indexOf('onLoad={() => {'))
  assert.match(onLoad.slice(0, onLoad.indexOf('}}')), /postBooth\(\)/, 'posted on load')
  assert.match(rt, /boothKey\(person, manifest\.app\?\.app_id\)/, 'keyed by person and tool')
  assert.match(rt, /writeBooth\(boothRef\.current, open\)/, 'stored when the page says')
})
