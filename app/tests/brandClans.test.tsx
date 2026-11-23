// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The client page's Brand Clans section (docs/contracts/brand-clan.md; mocks b1
// to f4b): the pure edits, the controller against the contract's own vectors
// (the shapes the host's tests pin), the screens it draws, and the rule that
// matters most: the Update chip changes no document until it is pressed.

import './domFakes.ts'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { BrandBehind, BrandClanList, BrandClanView, BrandHistoryEntry } from '../src/host/types.ts'
import type { BrandApi } from '../src/host/brandClans.ts'
import { BrandClans } from '../src/shell/nui/brandClans/BrandClans.tsx'
import { BrandClansController } from '../src/shell/nui/brandClans/controller.ts'
import * as M from '../src/shell/nui/brandClans/model.ts'

const vec = <T,>(n: string) => JSON.parse(readFileSync(join(process.cwd(), '..', 'docs/contracts/examples/brand-clan', n), 'utf8')) as T
const LIST = vec<BrandClanList>('list.reply.json')
const VIEW = vec<BrandClanView>('view.reply.json')
const HISTORY = vec<BrandHistoryEntry[]>('history.reply.json')

/** A fake API over the vectors that records every call, so a test can say what was and was not asked. */
function fake(over: Partial<BrandApi> = {}) {
  const calls: string[] = []
  const rec = <T,>(name: string, v: T) => async (..._a: unknown[]) => { calls.push(name); return structuredClone(v) }
  const api: BrandApi = {
    list: rec('list', LIST), create: rec('create', VIEW),
    get: async (_p: string, version?: number) => {
      calls.push('get')
      const v = structuredClone(VIEW)
      if (version && version < v.version) { v.readonly = true; v.shown = { version, state: 'published' }; v.data.kit.version = version }
      return v
    }, history: rec('history', HISTORY),
    saveDraft: rec('saveDraft', VIEW), startDraft: rec('startDraft', VIEW), discardDraft: rec('discardDraft', { ...VIEW, draft: null }),
    publish: rec('publish', { ...VIEW, version: 3, draft: null }), accept: rec('accept', VIEW), keep: rec('keep', VIEW),
    setDefault: rec('setDefault', {}), updateWork: rec('updateWork', { ok: true }), putAsset: rec('putAsset', { name: 'a', path: 'human/assets/a' }),
    assetUrl: rec('assetUrl', 'x'), ...over,
  } as BrandApi
  return { api, calls }
}

// ── The edits ────────────────────────────────────────────────────────────────

test('edits are immutable, keep ids stable and make new ids that never collide', () => {
  const b = M.bibleOf(VIEW.data)
  assert.equal('kit' in b, false, 'a candidate is the bible without kit')
  const c = M.setColour(b, 'mint', { hex: '#3FC9A0' })
  assert.equal(M.colours(b).find(x => x.id === 'mint')!.hex, '#7FD6BD', 'the original is untouched')
  assert.equal(M.colours(c).find(x => x.id === 'mint')!.hex, '#3FC9A0')
  const d = M.addColour(M.addColour(c, 'Mint'), 'Mint')
  assert.deepEqual(M.colours(d).slice(-2).map(x => x.id), ['mint-2', 'mint-3'])
  const r = M.addRule(c, 'Always show the can upright.')
  assert.equal(M.rules(r).at(-1)!.id, 'always-show-the-can-upright')
  assert.equal(M.rules(M.removeRule(r, 'always-show-the-can-upright')).length, M.rules(b).length)
  assert.equal(M.logos(M.putLogo(b, 'human/assets/x.svg', 'New mark')).at(-1)!.asset, 'human/assets/x.svg')
  assert.equal(M.logos(M.putLogo(b, 'human/assets/y.svg', 'ignored', 'mark')).find(l => l.id === 'mark')!.asset, 'human/assets/y.svg')
})

test('the words: who, when, plural; marks from the host’s changes', () => {
  assert.equal(M.who('human:aoife@javelin'), 'Aoife')
  assert.equal(M.who('process:brand_build'), 'Napkin')
  assert.equal(M.who(null), 'Someone')
  const now = Date.parse('2026-11-23T12:00:00Z')
  assert.equal(M.when('2026-11-23T11:59:40Z', now), 'just now')
  assert.equal(M.when('2026-11-23T11:30:00Z', now), '30m ago')
  assert.equal(M.when('2026-11-12T10:00:00Z', now), '12 Nov')
  assert.equal(M.plural(1, 'change'), '1 change')
  const m = M.marks(VIEW.draft!.changes)
  assert.equal(m.get('colour:mint'), 'changed')
  assert.equal(m.get('rule:can-upright'), 'new')
  const since = M.changesSince(HISTORY, 1)
  assert.deepEqual(since.map(s => s.version), [2], 'only published versions after the one held')
})

// ── The controller ───────────────────────────────────────────────────────────

test('loading and opening never update a work document', async () => {
  const { api, calls } = fake()
  const c = new BrandClansController(api, 'cli_0badcafe')
  await c.load()
  await c.open('doc-zero')
  await c.showHistory()
  await c.openVersion(1)
  assert.ok(calls.includes('list') && calls.includes('get') && calls.includes('history'))
  assert.ok(!calls.includes('updateWork'), 'only the Update chip updates work')
})

test('the Update chip: reading what changed asks nothing of work; only the press writes', async () => {
  const { api, calls } = fake()
  const c = new BrandClansController(api, 'cli_0badcafe')
  await c.load()
  const behind: BrandBehind = { ...LIST.behind[0], held: 1 }
  const what = await c.whatChanged(behind)
  assert.equal(what[0].version, 2)
  assert.deepEqual(calls.filter(x => x === 'updateWork'), [], 'opening the chip’s list changes nothing')
  assert.equal(await c.update(behind), true)
  assert.deepEqual(calls.filter(x => x === 'updateWork'), ['updateWork'], 'one press, one update')
})

test('publishing a draft does not touch work; it only refreshes the list so the chip can appear', async () => {
  const { api, calls } = fake()
  const c = new BrandClansController(api, 'cli_0badcafe')
  await c.load()
  await c.open('doc-zero')
  assert.equal(c.snapshot().screen, 'bible', 'a draft is offered from the published view, never opened over it')
  c.startEdit()
  c.edit(b => M.setTone(b, 'Dry.'))
  await c.saveDraft()
  assert.equal(c.snapshot().screen, 'draft')
  c.confirm()
  assert.equal(c.snapshot().screen, 'confirm')
  await c.publish()
  assert.equal(c.snapshot().published?.version, 3)
  assert.equal(c.snapshot().screen, 'bible')
  assert.ok(calls.includes('publish') && !calls.includes('updateWork'))
})

test('a new version waiting: everything is taken by default; some can be kept old; only a person accepts', async () => {
  const pending = { ...VIEW, draft: null, pending: { from_version: 2, at: 'x', by: 'process:brand_build', from: { kind: 'upload' as const, file: 'f.pdf' }, source: null, candidate: VIEW.draft!.candidate, changes: VIEW.draft!.changes } }
  let sent: unknown
  const { api } = fake({ get: async () => structuredClone(pending), accept: async (_p, take) => { sent = take; return structuredClone(VIEW) } })
  const c = new BrandClansController(api, 'cli_0badcafe')
  await c.open('doc-zero')
  assert.equal(c.snapshot().screen, 'changes')
  assert.deepEqual(Object.values(c.snapshot().taken), [true, true, true])
  await c.accept()
  assert.equal(sent, 'all')
  await c.open('doc-zero')
  c.toggle('colour:mint', false)
  await c.accept()
  assert.deepEqual(sent, ['logo:wordmark-dark', 'rule:can-upright'])
})

test('a refusal reaches the person in the host’s own words and changes nothing else', async () => {
  const { api } = fake({ get: async () => structuredClone(VIEW), publish: async () => { throw new Error('this Brand Clan is at v3 now, not v2; it changed while you were looking. Reload it.') } })
  const c = new BrandClansController(api, 'cli_0badcafe')
  await c.open('doc-zero')
  c.startEdit(); c.confirm()
  await c.publish()
  assert.match(c.snapshot().error ?? '', /changed while you were looking/)
  assert.equal(c.snapshot().published, null)
})

// ── The screens ──────────────────────────────────────────────────────────────

const html = (c: BrandClansController, s = c.snapshot()) => renderToStaticMarkup(createElement(BrandClans, { controller: c, name: 'Tidewell', state: s }))

test('b1: the list marks the default, offers Make default on the others and says what is waiting', async () => {
  const c = new BrandClansController(fake().api, 'cli_0badcafe')
  await c.load()
  const h = html(c)
  assert.match(h, /Tidewell · Original<\/b><span class="bcm-tag"[^>]*>Default<\/span>/)
  assert.match(h, /New version to review/)
  assert.equal((h.match(/data-testid="make-default"/g) ?? []).length, 1, 'the default has no Make default')
  assert.match(h, /Draft v3 · 3 changes/)
  assert.match(h, /data-testid="brand-new"/)
})

test('b2, f2, f3, f3b, f4b: the Bible, the draft’s marks, the confirm, the published note, the read-only old version', async () => {
  const { api } = fake()
  const c = new BrandClansController(api, 'cli_0badcafe')
  await c.open('doc-zero')
  let h = html(c)
  assert.match(h, /Brand Bible · v2/)
  assert.match(h, /data-testid="brand-edit"/)
  assert.match(h, /There is a draft of v3/)
  assert.doesNotMatch(h, /bbm-mark/)
  c.startEdit()
  h = html(c)
  assert.match(h, /Editing · v2/)
  assert.match(h, /aria-label="Mint hex"/)
  assert.match(h, /Edits stay in a draft that only you see/)
  await c.saveDraft()
  h = html(c)
  assert.match(h, /Draft v3 · 3 changes/)
  assert.match(h, /Edited by Aoife/)
  assert.match(h, /open work still uses v2/)
  assert.equal((h.match(/class="bbm-mark"/g) ?? []).length >= 3, true, 'changed and new marks')
  c.confirm()
  h = html(c)
  assert.match(h, /Publish Zero v3\?/)
  assert.match(h, /<b>Colour<\/b> Mint #7FD6BD becomes #3FC9A0/)
  assert.match(h, /Work already made keeps v2/)
  await c.openVersion(1)
  h = html(c)
  assert.match(h, /v1 · read-only/)
  assert.match(h, /Start a draft from this/)
  assert.doesNotMatch(h, /aria-label="Mint hex"/, 'an old version has no inputs')
})

test('an empty client says there is none and where one comes from', () => {
  const c = new BrandClansController(fake().api, 'cli_0badcafe')
  const h = html(c, { ...c.snapshot(), list: { default: null, items: [], behind: [] } })
  assert.match(h, /No Brand Clan yet/)
  assert.match(h, /Add its brand book in a Brief, Research or Production/)
})

test('host.brandClans.list reaches napkin-web’s route for the client and returns the list as sent', async () => {
  const { httpHost } = await import('../src/host/http.ts')
  const seen: string[] = []
  ;(globalThis as { window?: unknown }).window = { location: { origin: 'https://studio.test' } }
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input)
    seen.push(url)
    const body = url === '/api/session' ? { tenant: 'T', sandbox_origin: null, quota: { used: 0, cap: 40 } } : LIST
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  const got = await httpHost.brandClans.list('cli_0badcafe')
  assert.deepEqual(got, LIST)
  assert.ok(seen.includes('/api/t/T/clients/cli_0badcafe/brand-clans'))
  assert.equal(got.default, 'doc-original')
})
