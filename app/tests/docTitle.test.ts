// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// A spin-off's first title says what it is after its source's name, never
// the source's title alone ("X from X" beside the lineage chip).

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { docTitle, spinoffTitle } from '../src/shell/docTitle.ts'

const BRIEF = 'ie.napkin.brief-maker', RESEARCH = 'ie.napkin.campaign-research'

test('a spin-off is called after its source, with what it is', () => {
  assert.equal(spinoffTitle('Ferryman Light campaign', BRIEF, RESEARCH), 'Ferryman Light campaign · Research')
  assert.equal(spinoffTitle('Ferryman Light · Great Britain', RESEARCH, BRIEF), 'Ferryman Light · Great Britain · Brief')
  assert.equal(spinoffTitle('Ferryman Light launch · Research', RESEARCH, BRIEF), 'Ferryman Light launch · Brief', 'never one kind after another')
})

test('a source with no title of its own, or a tool with no word, is left to the host', () => {
  assert.equal(spinoffTitle('Brief Maker', BRIEF, RESEARCH), null)
  assert.equal(spinoffTitle('', BRIEF, RESEARCH), null)
  assert.equal(spinoffTitle('Ferryman', BRIEF, 'ie.napkin.deck-maker'), null)
})

test('a new document is called by its tool\'s untitled word: the mock\'s "New brief", "New question"', () => {
  assert.deepEqual(docTitle('Brief Maker', BRIEF, 'Brief Maker', 'New brief'), { text: 'New brief', untitled: true })
  assert.deepEqual(docTitle('Research Tool', RESEARCH, 'Research Tool', 'New question'), { text: 'New question', untitled: true })
  assert.deepEqual(docTitle('', BRIEF), { text: 'New brief', untitled: true }, 'a tool no longer installed says the same')
  assert.deepEqual(docTitle('Window Open', BRIEF, 'Brief Maker', 'New brief'), { text: 'Window Open', untitled: false })
})
