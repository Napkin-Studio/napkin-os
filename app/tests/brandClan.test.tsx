// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Brand Clan in the shell: the chip's every state and its words, the
// popover's refusals, making a Brand Clan from a name, and the harvest panel's
// ticks and what it sends (Contract 6 §4.6, §5, §6).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { AttachedEntry, AttachTarget, HarvestOffer } from '../src/host/types.ts'
import BrandClanPopover from '../src/shell/brandClan/BrandClanPopover.tsx'
import type { PopoverProps } from '../src/shell/brandClan/BrandClanPopover.tsx'
import HarvestView from '../src/shell/brandClan/HarvestView.tsx'
import { anyTicked, applyBody, doneLine, harvestable, initialTicks, offerButton } from '../src/shell/brandClan/harvest.ts'
import { duplicateRef, identifyBrand, makeBrandClan, newCandidates } from '../src/shell/brandClan/naming.ts'
import type { NamingHost } from '../src/shell/brandClan/naming.ts'
import {
  canOfferMake, chipState, detachSentence, doneWords, errorWords, findTargets, keptWords, NAMING_UNAVAILABLE,
} from '../src/shell/brandClan/words.ts'

const BRAND = 'ie.napkin.brand'
const noop = () => {}
const NO_HANDLERS = {
  onQuery: noop, onPick: noop, onUpdate: noop, onDetachAsk: noop, onDetachConfirm: noop, onDetachCancel: noop,
  onMake: noop, onCandidate: noop, onNewBrand: noop, onNamingCancel: noop,
}
const entry = (over: Partial<AttachedEntry> = {}): AttachedEntry => ({
  document_id: 'b-1', app_id: BRAND, version: 5, version_now: 5, at: 't', in_store: true, title: 'Lumen Water', status: 'current', ...over,
})

// ── the chip ───────────────────────────────────────────────────────────────

test('an app that accepts nothing has no chip', () => {
  assert.equal(chipState({ accepts: undefined, attached: [entry()], locked: false }).kind, 'hidden')
  assert.equal(chipState({ accepts: [], attached: [entry()], locked: false }).kind, 'hidden')
})

test('nothing attached: "Set the Brand Clan"', () => {
  for (const attached of [undefined, [], [entry({ app_id: 'ie.napkin.other' })]]) {
    const s = chipState({ accepts: [BRAND], attached, locked: false })
    assert.equal(s.kind, 'empty')
    assert.equal(s.label, 'Set the Brand Clan')
    assert.equal(s.readOnly, false)
  }
})

test('set: the brand’s name and its version', () => {
  const s = chipState({ accepts: [BRAND], attached: [entry()], locked: false })
  assert.equal(s.kind, 'set')
  assert.equal(s.label, 'Lumen Water · v5')
  assert.equal(s.brand, 'Lumen Water')
  assert.equal(s.version, 'v5')
})

test('behind: "v6 in the Brand Clan · Update"', () => {
  const s = chipState({ accepts: [BRAND], attached: [entry({ status: 'changed', version_now: 6 })], locked: false })
  assert.equal(s.kind, 'behind')
  assert.equal(s.label, 'v6 in the Brand Clan · Update')
  assert.equal(s.version, 'v5')
  assert.equal(s.versionNow, 'v6')
  // Changed but the version did not move (pins changed): still behind, still honest.
  assert.equal(chipState({ accepts: [BRAND], attached: [entry({ status: 'changed', version_now: null })], locked: false }).label, 'Newer in the Brand Clan · Update')
})

test('a Brand Clan the studio no longer has is said so', () => {
  const s = chipState({ accepts: [BRAND], attached: [entry({ in_store: false, status: 'unknown', title: undefined })], locked: false })
  assert.equal(s.kind, 'missing')
  assert.match(s.label, /not found/)
})

test('locked: read-only, in every state, and it says so', () => {
  for (const attached of [[], [entry()], [entry({ status: 'changed', version_now: 6 })]]) {
    const s = chipState({ accepts: [BRAND], attached, locked: true })
    assert.equal(s.readOnly, true)
    assert.match(s.title, /locked/)
  }
})

// ── the words ──────────────────────────────────────────────────────────────

test('the words are plain', () => {
  assert.equal(detachSentence('Lumen Water'), 'Detach Lumen Water? Its pins stay in this document; the copy and the fields it filled in go.')
  assert.equal(keptWords(['client']), 'Kept your wording in: client.')
  assert.equal(keptWords(['client', 'tone_and_world']), 'Kept your wording in: client, tone and world.')
  assert.equal(keptWords([]), '')
  assert.equal(doneWords('updated', 'Lumen Water', ['client']), 'Lumen Water is up to date. Kept your wording in: client.')
  assert.equal(doneWords('attached', 'Lumen Water', []), 'Lumen Water is now this document’s Brand Clan.')
  assert.equal(errorWords(new Error('  this document is locked ')), 'this document is locked')
  assert.equal(errorWords(new Error('')), 'That didn’t work. Try again.')
  assert.equal(errorWords(new Error('No middleware is configured for this workspace (proxies.middleware).')), NAMING_UNAVAILABLE)
})

const T = (title: string, over: Partial<AttachTarget> = {}): AttachTarget => ({
  app_id: BRAND, app_name: 'Brand', document_id: `d-${title}`, title, version: 5, path: `p-${title}`, updated_at: 't', attached: false, ...over,
})

test('typing finds Brand Clans, and offers to make one only for a name that has none', () => {
  const ts = [T('Lumen Water'), T('Lúnasa')]
  assert.deepEqual(findTargets(ts, 'lumen').map(t => t.title), ['Lumen Water'])
  assert.equal(findTargets(ts, '  ').length, 2)
  assert.equal(canOfferMake(ts, 'Lumen'), true)     // a part of a name is not the name
  assert.equal(canOfferMake(ts, ' lumen  WATER '), false)
  assert.equal(canOfferMake(ts, 'Harbour'), true)
  assert.equal(canOfferMake(ts, ''), false)
})

// ── the popover ────────────────────────────────────────────────────────────

const props = (over: Partial<PopoverProps> = {}): PopoverProps => ({
  state: chipState({ accepts: [BRAND], attached: [], locked: false }),
  targets: [T('Lumen Water'), T('Lúnasa', { version: 2 })],
  query: '', busy: null, error: null, confirmDetach: false, naming: { step: 'none' }, canName: true, on: NO_HANDLERS, ...over,
})
const html = (p: PopoverProps) => renderToStaticMarkup(createElement(BrandClanPopover, p))

test('the popover lists the Brand Clans with their versions, and labels the box', () => {
  const h = html(props())
  assert.match(h, /Find or name a brand/)
  assert.match(h, /Lumen Water/)
  assert.match(h, /v5/)
  assert.match(h, /v2/)
  assert.match(h, />Use</)
})

test('with one set, another says Replace and the set one has its tick', () => {
  const state = chipState({ accepts: [BRAND], attached: [entry()], locked: false })
  const h = html(props({ state, targets: [T('Lumen Water', { attached: true, document_id: 'b-1' }), T('Lúnasa')] }))
  assert.match(h, /✓ attached/)
  assert.match(h, />Replace</)
  assert.match(h, />Detach</)
  assert.doesNotMatch(h, />Update</)
})

test('behind offers Update', () => {
  const state = chipState({ accepts: [BRAND], attached: [entry({ status: 'changed', version_now: 6 })], locked: false })
  const h = html(props({ state }))
  assert.match(h, />Update</)
  assert.match(h, /v6 is in the Brand Clan/)
})

test('detach asks first, in a plain sentence', () => {
  const state = chipState({ accepts: [BRAND], attached: [entry()], locked: false })
  const h = html(props({ state, confirmDetach: true }))
  assert.match(h, /Detach Lumen Water\? Its pins stay in this document; the copy and the fields it filled in go\./)
  assert.match(h, /Keep it/)
})

test('a refusal is shown inline in the host’s own words', () => {
  const h = html(props({ error: 'this document is locked: its Brand Clan can’t change' }))
  assert.match(h, /role="alert"[^>]*>this document is locked: its Brand Clan can’t change</)
})

test('locked: read-only, says so, nothing to press', () => {
  const state = chipState({ accepts: [BRAND], attached: [entry({ status: 'changed', version_now: 6 })], locked: true })
  const h = html(props({ state }))
  assert.match(h, /This document is locked, so its Brand Clan can’t change\./)
  assert.doesNotMatch(h, />Update</)
  assert.doesNotMatch(h, />Detach</)
  assert.match(h, /<input[^>]*disabled/)
  assert.match(h, /<button[^>]*disabled[^>]*class="bc-item"|class="bc-item"[^>]*disabled/)
})

test('a name with no Brand Clan offers to make one; a name with one does not', () => {
  assert.match(html(props({ query: 'Harbour' })), /Make a Brand Clan for Harbour/)
  assert.doesNotMatch(html(props({ query: 'Lumen Water' })), /Make a Brand Clan for/)
})

test('where there is no middleware, naming says so and still lets an existing one be picked', () => {
  const h = html(props({ query: 'Harbour', canName: false }))
  assert.match(h, /Making a Brand Clan from a name is not available in this build yet\./)
  assert.doesNotMatch(h, /Make a Brand Clan for/)
  assert.match(html(props({ canName: false })), />Use</)
})

test('"Is it one of these?" lists what the studio knows, with a way out', () => {
  const h = html(props({ naming: { step: 'choose', typed: 'Lum', candidates: [{ ref: 'brand/lumen-water', name: 'Lumen Water', categories: ['soft_drinks.water'], client_org: null }] } }))
  assert.match(h, /Is it one of these\?/)
  assert.match(h, /soft_drinks\.water/)
  assert.match(h, /None of these, make a new one/)
})

// ── making a Brand Clan from a name ────────────────────────────────────────

function fake(over: Partial<NamingHost> = {}) {
  const calls: [string, ...unknown[]][] = []
  const h: NamingHost = {
    hasMiddleware: true,
    whoAmI: async () => ({ actor: 'human:shrey', id: 'shrey', name: null }),
    middlewareRead: async (task, input) => {
      calls.push(['read', task, input])
      return { result: { candidates: [{ ref: 'brand/lumen-water', name: 'Lumen Water', categories: [], client_org: null }, { nonsense: 1 } as never] }, change: null }
    },
    newDocumentQuietly: async (appId, title) => { calls.push(['create', appId, title]); return { path: 'new-doc' } },
    middlewareRunOn: async (path, task, input) => { calls.push(['run', path, task, input]); return { change: { applied: true } } },
    attachTargets: async () => [T('Lumen Water', { path: 'new-doc', document_id: 'b-new' })],
    attach: async id => {
      calls.push(['attach', id])
      return { ok: true, verb: 'attached', attached: { document_id: id, app_id: BRAND, at: 't' }, seeded: [], kept: [] }
    },
    ...over,
  }
  return { h, calls }
}

test('identify returns what the middleware found, and drops what is not a brand', async () => {
  const { h, calls } = fake()
  const c = await identifyBrand(h, ' Lumen ')
  assert.deepEqual(c.map(x => x.ref), ['brand/lumen-water'])
  assert.deepEqual(calls[0], ['read', 'brand_identify', { text: 'Lumen' }])
})

test('without a middleware nothing is asked, and the words say so', async () => {
  const { h, calls } = fake({ hasMiddleware: false })
  await assert.rejects(identifyBrand(h, 'x'), { message: NAMING_UNAVAILABLE })
  await assert.rejects(makeBrandClan(h, { name: 'x' }), { message: NAMING_UNAVAILABLE })
  assert.equal(calls.length, 0)
})

test('a brand it found is seeded by ref, then attached', async () => {
  const { h, calls } = fake()
  const r = await makeBrandClan(h, { ref: 'brand/lumen-water', name: 'Lumen Water' })
  assert.equal(r.verb, 'attached')
  assert.deepEqual(calls, [
    ['create', BRAND, 'Lumen Water'],
    ['run', 'new-doc', 'brand_seed', { ref: 'brand/lumen-water' }],
    ['attach', 'b-new'],
  ])
})

test('a new name is seeded by name, with the signed-in person in `by`', async () => {
  const { h, calls } = fake()
  await makeBrandClan(h, { name: ' Lumen Water ' })
  assert.deepEqual(calls[1], ['run', 'new-doc', 'brand_seed', { name: 'Lumen Water', by: 'human:shrey' }])
})

test('a duplicate-name refusal names the studio’s brand: seed the same Brand Clan from that', async () => {
  const msg = 'the agency already has Lumen Water (brand/lumen-water); seed it with input.ref'
  assert.equal(duplicateRef(new Error(msg)), 'brand/lumen-water')
  assert.equal(duplicateRef(new Error('something else')), null)
  const runs: unknown[] = []
  const { h } = fake({
    middlewareRunOn: async (_p, _t, input) => {
      runs.push(input)
      if ('name' in input) throw new Error(msg)
      return { change: { applied: true } }
    },
  })
  await makeBrandClan(h, { name: 'Lumen Water' })
  assert.deepEqual(runs, [{ name: 'Lumen Water', by: 'human:shrey' }, { ref: 'brand/lumen-water' }])
})

test('a failed seed says which step failed', async () => {
  const { h } = fake({ middlewareRunOn: async () => { throw new Error('unknown_brand') } })
  await assert.rejects(makeBrandClan(h, { ref: 'brand/x', name: 'X' }), { message: 'The Brand Clan for X could not be filled in: unknown_brand' })
  const f = fake({ attach: async () => { throw new Error('this document is locked') } })
  await assert.rejects(makeBrandClan(f.h, { name: 'X' }), /made, but it could not be set here: this document is locked/)
})

test('a brand that already has a Brand Clan is not offered twice', () => {
  const found = [
    { ref: 'brand/lumen-water', name: 'Lumen Water', categories: [] },
    { ref: 'brand/lunasa', name: 'Lúnasa', categories: [] },
  ]
  assert.deepEqual(newCandidates(found, [T('lumen water')]).map(c => c.ref), ['brand/lunasa'])
})

// ── harvest ────────────────────────────────────────────────────────────────

const offer = (): HarvestOffer => ({
  ok: true,
  brand: { document_id: 'b-1', title: 'Lumen Water', app_id: BRAND, version: 5, path: 'p' },
  review: { decision: 'd_R', answer: 'accepted_with_changes', accepted_at: 't', version: 'sha256:v' },
  work: { id: 'work_ab12cd34', status: 'new', item: { title: 'Lumen launch brief' }, selected: true },
  fields: [
    { from: 'single_minded_proposition', to: 'strategy.proposition.value', value: 'Water, made light.', kit_value: null, status: 'new', flagged: false, selected: true },
    { from: 'audience', to: 'strategy.audience.value', value: 'Busy parents', kit_value: 'Parents', status: 'changed', flagged: true, reason: 'the client asked for a change here', selected: false },
    { from: 'tone_and_world', to: 'voice.tone.value', value: 'Warm', kit_value: 'Warm', status: 'same', flagged: false, selected: false },
  ],
})

test('harvest is offered after an accepted answer, never a rejected one', () => {
  assert.equal(harvestable('accepted'), true)
  assert.equal(harvestable('accepted_with_changes'), true)
  assert.equal(harvestable('rejected'), false)
  assert.equal(harvestable(undefined), false)
  assert.equal(offerButton('Lumen Water'), 'Add to Lumen Water’s Brand Clan')
})

test('the panel opens ticked exactly where the host says selected; same and flagged rows are not', () => {
  const t = initialTicks(offer())
  assert.deepEqual(t, { work: true, fields: { single_minded_proposition: true, audience: false, tone_and_world: false } })
  // A host that selects a same row is not obeyed: it can't be ticked.
  const o = offer(); o.fields[2].selected = true
  assert.equal(initialTicks(o).fields.tone_and_world, false)
})

test('what is sent is only the ticks and the summary', () => {
  const o = offer()
  const t = initialTicks(o)
  assert.deepEqual(applyBody(o, t, '  Approved by the client  '), { work: true, fields: ['single_minded_proposition'], summary: 'Approved by the client' })
  assert.deepEqual(applyBody(o, t, '   '), { work: true, fields: ['single_minded_proposition'] })
  // A flagged field the person ticks goes; a same one never does.
  t.fields.audience = true; t.fields.tone_and_world = true
  assert.deepEqual(applyBody(o, t, '').fields, ['single_minded_proposition', 'audience'])
  // Nothing ticked: nothing to send, and the button is off.
  const none = { work: false, fields: {} }
  assert.deepEqual(applyBody(o, none, 'x'), {})
  assert.equal(anyTicked(none), false)
  assert.equal(anyTicked(t), true)
})

test('the result is said plainly', () => {
  assert.equal(doneLine('Lumen Water', 6), 'Lumen Water Brand Clan is now v6.')
})

const view = (o: HarvestOffer, over: Partial<Parameters<typeof HarvestView>[0]> = {}) =>
  renderToStaticMarkup(createElement(HarvestView, {
    offer: o, ticks: initialTicks(o), summary: '', busy: false, error: null,
    labels: { single_minded_proposition: 'Single-minded proposition' },
    onTick: () => {}, onSummary: () => {}, onApply: () => {}, onClose: () => {}, ...over,
  }))

test('the panel shows the document first, then each field side by side', () => {
  const h = view(offer())
  assert.ok(h.indexOf('Lumen launch brief · approved exemplar') < h.indexOf('Single-minded proposition'))
  assert.match(h, /Add to Lumen Water’s Brand Clan/)
  assert.match(h, /Water, made light\./)
  assert.match(h, /This document/)
  assert.match(h, /The Brand Clan/)
  assert.match(h, />Add to the Brand Clan</)
})

test('a flagged row gives the host’s reason and starts unticked; a same row is disabled', () => {
  const h = view(offer())
  assert.match(h, /the client asked for a change here/)
  assert.match(h, /Already the Brand Clan’s/)
  const row = (name: string) => h.split('<li').find(l => l.includes(name)) ?? ''
  assert.doesNotMatch(row('audience'), /checked=""/)
  assert.match(row('tone and world'), /disabled=""/)
  assert.match(row('Single-minded proposition'), /checked=""/)
})

test('the button waits until something is ticked, and an error shows the host’s words', () => {
  const o = offer()
  const none = view(o, { ticks: { work: false, fields: {} } })
  assert.match(none, /<button[^>]*disabled=""[^>]*>Add to the Brand Clan</)
  assert.match(view(o, { error: 'the Brand Clan is locked' }), /role="alert">the Brand Clan is locked</)
  // After an add the rows say so.
  const done = offer(); done.work.status = 'same'; done.fields[0].status = 'same'; done.fields[0].selected = false
  assert.equal((view(done).match(/Already the Brand Clan’s/g) ?? []).length, 3)
})
