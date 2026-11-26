// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The card of mocks a1 (the one question) and a2 (building in the background), drawn from each state of the flow.

import './domFakes.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { BrandCard } from '../src/shell/brand/BrandCard.tsx'
import type { BuildAnswer, ClanRef, Entry, Phase } from '../src/shell/brand/brandFlow.ts'

const noop = () => Promise.resolve()
const flow = { answer: noop, make: noop, confirmBig: noop, retry: noop, dismiss: () => {}, offerBuild: noop }
const ORIGINAL: ClanRef = { document_id: 'bc-1', path: 'a/o.clan', name: 'Original', default: true }
const update: BuildAnswer = { mode: 'update', clan: { document_id: 'bc-1', path: 'a/o.clan', name: 'Original' }, confirmed: false }
const draw = (phase: Phase, label = 'Tidewell-brand-book-2026.pdf') => renderToStaticMarkup(createElement(BrandCard, { entry: { id: 'f', label, phase } as Entry, client: 'Tidewell', flow }))
const q = (over = {}) => ({ mode: 'choose' as const, options: ['update', 'new', 'not_bible'], update: { document_id: 'bc-1', name: 'Original' }, pages: 48, over_cap: false, page_cap: 120, ...over })

test('a1: the question names the file and the client and offers three answers, Update first and primary', () => {
  const html = draw({ kind: 'ask', question: q(), clans: [ORIGINAL] })
  assert.match(html, /Tidewell-brand-book-2026\.pdf looks like a brand bible\./)
  assert.match(html, /Tidewell has Brand Clans already\. What should we do with it\?/)
  const buttons = [...html.matchAll(/<button[^>]*class="([^"]*)"[^>]*data-testid="([^"]*)"[^>]*>([^<]*)</g)].map(m => [m[2], m[3], /bq-primary/.test(m[1])])
  assert.deepEqual(buttons, [['brand-update', 'Update “Original”', true], ['brand-new', 'Make a new Brand Clan', false], ['brand-not', 'Not a brand bible', false]])
})

test('a1: with no Brand Clan it is Build its Brand Clan and Not a brand bible', () => {
  const html = draw({ kind: 'ask', question: q({ mode: 'new', options: ['build', 'not_bible'], update: null }), clans: [] })
  assert.match(html, /Tidewell has no Brand Clan yet\. Build one from it\?/)
  assert.deepEqual([...html.matchAll(/data-testid="(brand-[a-z-]+)"/g)].map(m => m[1]).filter(x => x !== 'brand-ask'), ['brand-build', 'brand-not'])
  assert.doesNotMatch(html, /Update/)
})

test('a1: clans but none preselected still offers Make a new one as the way forward', () => {
  const html = draw({ kind: 'ask', question: q({ update: null }), clans: [ORIGINAL, { ...ORIGINAL, document_id: 'x', name: 'Zero', default: false }] })
  assert.doesNotMatch(html, /brand-update/)
  assert.match(html, /bq-btn bq-primary" data-testid="brand-new"/)
})

test('a2: the build runs in the background and says the person can carry on', () => {
  const html = draw({ kind: 'working', job: 'job_1', answer: update })
  assert.match(html, /role="status"/)
  assert.match(html, /Updating “Original” from the brand book<\/b> <span class="bq-sub">in the background\. Carry on; we will tell you when its changes are ready to review\./)
  assert.match(html, /class="bq-spin"/)
  assert.doesNotMatch(html, /<button/, 'nothing to press: it never blocks the brief')
})

test('a2: a first build says it is building the Brand Clan by its name', () => {
  assert.match(draw({ kind: 'working', job: 'j', answer: { mode: 'new', name: 'Original', confirmed: false } }), /Building the Brand Clan “Original” from the brand book/)
})

test('done says where it waits; an update says nothing changes until the person takes it; gaps are named', () => {
  const html = draw({ kind: 'done', answer: update, result: { summary: 's', mode: 'update', name: 'Original', pending: true, path: 'p', gaps: ['imagery', 'logos'] } })
  assert.match(html, /A new version of “Original” is ready to review\./)
  assert.match(html, /Nothing changes before then\./)
  assert.match(html, /2 sections were not in the file and are left empty\./)
})

test('failed says the reason, that the file is untouched, and offers Retry', () => {
  const html = draw({ kind: 'failed', reason: 'The file held no brand rules Napkin could read.', answer: update })
  assert.match(html, /role="alert"/)
  assert.match(html, /Could not build the Brand Clan\./)
  assert.match(html, /The file held no brand rules Napkin could read\. Your file is untouched and nothing was made\./)
  assert.match(html, /data-testid="brand-retry"[^>]*>Retry</)
})

test('a file over the cap asks before spending more', () => {
  const html = draw({ kind: 'big', pages: 130, answer: update })
  assert.match(html, /Tidewell-brand-book-2026\.pdf has 130 pages\./)
  assert.match(html, />Read all 130 pages</)
  assert.match(html, />Not now</)
})

test('naming asks for the new Brand Clans name; the file chips small action is a link, not a card', () => {
  const named = draw({ kind: 'naming', question: q(), clans: [ORIGINAL] })
  assert.match(named, /Name the new Brand Clan/)
  assert.match(named, /maxLength="60"/)
  const offer = draw({ kind: 'offer' })
  assert.match(offer, /data-testid="brand-offer"/)
  assert.match(offer, />Build a Brand Clan from Tidewell-brand-book-2026\.pdf</)
  assert.equal(draw({ kind: 'detecting' }), '')
})
