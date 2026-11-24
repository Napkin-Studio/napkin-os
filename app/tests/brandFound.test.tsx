// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Brand Clan phase 2 (f), owner 2026-11-24: "Research can discover players in the same category right? And update the brand clan
// accordingly". A Research document that found the category's players (campaign.competitor_set, origin proposed) is offered in the
// client window: "Add to the draft" writes a draft of the default Brand Clan, which a person publishes. Nothing is written silently.

import './domFakes.ts'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { BrandClanList, BrandClanView } from '../src/host/types.ts'
import type { BrandApi } from '../src/host/brandClans.ts'
import { brandApi } from '../src/host/brandClans.ts'
import { BrandClans } from '../src/shell/nui/brandClans/BrandClans.tsx'
import { Bible } from '../src/shell/nui/brandClans/Bible.tsx'
import { BrandClansController } from '../src/shell/nui/brandClans/controller.ts'
import * as M from '../src/shell/nui/brandClans/model.ts'

const vec = <T,>(n: string) => JSON.parse(readFileSync(join(process.cwd(), '..', 'docs/contracts/examples/brand-clan', n), 'utf8')) as T
const LIST = vec<BrandClanList>('list.reply.json')
const VIEW = vec<BrandClanView>('view.reply.json')

const RESEARCH = {
  campaign: {
    competitor_set: {
      origin: 'proposed',
      value: [{ ref: 'brand/ariel', name: 'Ariel' }, { ref: 'brand/method', name: 'Method' }],
      item_provenance: { 'brand/ariel': { origin: 'proposed', fact_ids: ['fa_01', 'fa_02'] }, 'brand/method': { origin: 'proposed', fact_ids: ['fa_03'] } },
    },
  },
}
const doc = { document_id: 'doc-research-1', title: 'Zero research', data: RESEARCH }

test('what research found: its proposed players, minus any the Brand Clan holds, with the facts they rest on', () => {
  const f = M.researchFound(doc, M.bibleOf(VIEW.data))!
  assert.deepEqual(f.items, [{ id: 'ariel', name: 'Ariel', fact_ids: ['fa_01', 'fa_02'] }, { id: 'method', name: 'Method', fact_ids: ['fa_03'] }])
  const holds = { ...M.bibleOf(VIEW.data), competitors: [{ id: 'ariel', name: 'Ariel' }] }
  assert.deepEqual(M.researchFound(doc, holds)!.items.map(i => i.name), ['Method'])
  assert.equal(M.researchFound(doc, { ...holds, competitors: [{ id: 'a', name: 'ariel' }, { id: 'm', name: 'Method' }] }), null, 'nothing new to offer')
  // a comparator the planner named (origin extracted) is not a research finding
  assert.equal(M.researchFound({ ...doc, data: { campaign: { competitor_set: { ...RESEARCH.campaign.competitor_set, origin: 'extracted' } } } }, null), null)
  assert.equal(M.researchFound({ ...doc, data: {} }, null), null)
})

test('the players are added to a bible as list items that say where they came from', () => {
  const b = M.withCompetitors(M.bibleOf(VIEW.data), M.researchFound(doc, null)!)
  assert.deepEqual(b.competitors, [
    { id: 'ariel', name: 'Ariel', from: { kind: 'research', document_id: 'doc-research-1', title: 'Zero research', fact_ids: ['fa_01', 'fa_02'] } },
    { id: 'method', name: 'Method', from: { kind: 'research', document_id: 'doc-research-1', title: 'Zero research', fact_ids: ['fa_03'] } },
  ])
  assert.equal(M.withCompetitors(b, M.researchFound(doc, null)!).competitors!.length, 2, 'never twice')
})

function api(calls: { name: string; args: unknown[] }[], view: BrandClanView = VIEW): BrandApi {
  const rec = <T,>(name: string, v: T) => async (...args: unknown[]) => { calls.push({ name, args }); return structuredClone(v) }
  return {
    list: rec('list', LIST), get: rec('get', view), saveDraft: rec('saveDraft', view), create: rec('create', view), history: rec('history', []),
    startDraft: rec('startDraft', view), discardDraft: rec('discardDraft', view), publish: rec('publish', view), accept: rec('accept', view), keep: rec('keep', view),
    setDefault: rec('setDefault', {}), updateWork: rec('updateWork', {}), putAsset: rec('putAsset', {}), assetUrl: rec('assetUrl', 'x'),
  } as BrandApi
}

test('Add to the draft saves a draft of that Brand Clan (on its own draft when it has one), never a publish', async () => {
  const calls: { name: string; args: unknown[] }[] = []
  const c = new BrandClansController(api(calls), 'cli_tidewell')
  await c.addFound('doc-zero', M.researchFound(doc, null)!)
  const names = calls.map(x => x.name)
  assert.deepEqual(names.filter(n => n !== 'list'), ['get', 'saveDraft'])
  assert.equal(names.includes('publish'), false)
  const [path, candidate, expect] = calls.find(x => x.name === 'saveDraft')!.args as [string, { competitors: { name: string }[]; visual: { colours: { hex: string }[] } }, number]
  assert.equal(path, 'doc-zero')
  assert.equal(expect, VIEW.version)
  assert.deepEqual(candidate.competitors.map(x => x.name), ['Ariel', 'Method'])
  // the draft it builds on is the existing draft's candidate, so a person's draft edits are kept
  assert.equal(candidate.visual.colours.find(x => (x as { id?: string }).id === 'mint')!.hex, VIEW.draft!.candidate.visual!.colours!.find(x => x.id === 'mint')!.hex)
})

test('the client window offers it on the list screen, for the default Brand Clan; the Bible lists the competitors and where they came from', () => {
  const calls: { name: string; args: unknown[] }[] = []
  const c = new BrandClansController(api(calls), 'cli_tidewell')
  const state = { ...c.state, screen: 'list' as const, list: LIST }
  const html = renderToStaticMarkup(createElement(BrandClans, { controller: c, name: 'Tidewell', state, found: [M.researchFound(doc, null)!] }))
  assert.match(html, /Research found the category’s players:<\/b> Ariel, Method/)
  assert.match(html, /in “Zero research”/)
  assert.match(html, /Add to the draft of Original/)
  assert.match(html, /nothing changes for work until someone publishes it/)
  const none = renderToStaticMarkup(createElement(BrandClans, { controller: c, name: 'Tidewell', state }))
  assert.doesNotMatch(none, /Research found/)
  const b = M.withCompetitors(M.bibleOf(VIEW.data), M.researchFound(doc, null)!)
  const bible = renderToStaticMarkup(createElement(Bible, { bible: b, data: VIEW.data, mode: 'view', src: () => undefined }))
  assert.match(bible, /Competitors <em>2<\/em>/)
  assert.match(bible, /Ariel<span class="bcm-hint"> · found by research \(“Zero research”\)<\/span>/)
})

test('the http host offers the document data route; a host without it offers nothing', () => {
  const withData = brandApi({ brandClan: async () => ({}) as never, brandClanAsset: async () => '', documentData: async () => ({ data: RESEARCH, title: 'Zero research' }) })
  assert.equal(typeof withData.documentData, 'function')
  const without = brandApi({ brandClan: async () => ({}) as never, brandClanAsset: async () => '' })
  assert.equal(without.documentData, undefined)
  assert.match(readFileSync(join(process.cwd(), 'src/host/http.ts'), 'utf8'), /documentData: \(path: string\) => json<\{ data: unknown; title\?: string \}>\(`\/d\/\$\{encodeURIComponent\(path\)\}\/data`\)/)
})
