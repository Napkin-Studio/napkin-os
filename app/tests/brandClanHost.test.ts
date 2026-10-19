// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The web host reaches attach, harvest and the middleware for a Brand Clan the
// way the frame reaches the host: on a frame token's URL. These pin the routes,
// the bodies, that a refusal reaches the person in the host's own words, and
// that making a Brand Clan runs on ITS document without opening it.

import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import { httpHost } from '../src/host/http.ts'

const TENANT = '00000000-0000-4000-8000-000000000000'
const FRAME = 'https://studio.test/s/doc-a-token'

interface Seen { url: string; method: string; body: unknown }

function serve(routes: Record<string, { status?: number; body: unknown }>) {
  const seen: Seen[] = []
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    seen.push({ url, method: init?.method ?? 'GET', body: init?.body })
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    const open = (path: string) => ({
      path, token: `${path}-token`, sandbox_origin: null, manifest: { title: path },
      validation: 'OK', has_human_view: true, render_model: 'authored', is_template: false, trusted: false,
    })
    if (url === '/api/session') return json({ tenant: TENANT, sandbox_origin: null, quota: { used: 0, cap: 40 } })
    if (url.endsWith('/documents') && init?.method === 'POST') return json(open('brand-new'))
    const doc = /\/d\/([^/]+)$/.exec(url)
    if (doc) return json(open(decodeURIComponent(doc[1])))
    const at = url.indexOf('/s/')
    if (at >= 0) {
      const r = routes[url.slice(at)]
      if (r) return json(r.body, r.status)
    }
    throw new Error(`unexpected ${url}`)
  }) as typeof fetch
  return seen
}

beforeEach(async () => {
  ;(globalThis as { window?: unknown }).window = { location: { origin: 'https://studio.test' } }
  serve({})
  await httpHost.openClan('doc-a')
})

const R = (path: string, body: unknown, status?: number) => ({ [`/s/doc-a-token${path}`]: { body, status } })

test('the Brand Clans are read, and attach, update and detach post the document or app', async () => {
  const targets = [{ app_id: 'ie.napkin.brand', app_name: 'Brand', document_id: 'b-1', title: 'Lumen Water', version: 5, path: 'p1', updated_at: 't', attached: false }]
  const reply = { ok: true, verb: 'attached', attached: { document_id: 'b-1', app_id: 'ie.napkin.brand', at: 't' }, seeded: ['client'], kept: [] }
  const seen = serve({
    ...R('/attach-targets', targets), ...R('/attach', reply), ...R('/attach/update', { ...reply, verb: 'updated', kept: ['client'] }),
    ...R('/attach/detach', { ok: true, detached: {}, unseeded: [] }),
  })
  assert.deepEqual(await httpHost.attachTargets(), targets)
  assert.equal(seen.at(-1)!.method, 'GET')
  assert.equal((await httpHost.attach('b-1')).verb, 'attached')
  assert.deepEqual(JSON.parse(String(seen.at(-1)!.body)), { document_id: 'b-1' })
  assert.deepEqual((await httpHost.attachUpdate('b-1')).kept, ['client'])
  assert.equal(seen.at(-1)!.url, `${FRAME}/attach/update`)
  assert.deepEqual(JSON.parse(String(seen.at(-1)!.body)), { document_id: 'b-1' })
  await httpHost.detach('ie.napkin.brand')
  assert.equal(seen.at(-1)!.url, `${FRAME}/attach/detach`)
  assert.deepEqual(JSON.parse(String(seen.at(-1)!.body)), { app_id: 'ie.napkin.brand' })
})

test('a refusal from the host reaches the person in its own words', async () => {
  serve({
    ...R('/attach', { error: 'this document is locked: its Brand Clan can’t change' }, 409),
    ...R('/attach/detach', { error: 'only a person can detach a document; process:x is not one' }, 403),
  })
  await assert.rejects(httpHost.attach('b-1'), { message: 'this document is locked: its Brand Clan can’t change' })
  await assert.rejects(httpHost.detach('ie.napkin.brand'), { message: 'only a person can detach a document; process:x is not one' })
})

test('the harvest offer is asked for, and only the ticks are sent', async () => {
  const seen = serve({
    ...R('/harvest', { ok: true }), ...R('/harvest/apply', { ok: true, published: 6, brand: 'b-1', fields: ['x'] }),
  })
  await httpHost.harvestOffer()
  assert.deepEqual(JSON.parse(String(seen.at(-1)!.body)), {})
  await httpHost.harvestOffer('ie.napkin.brand')
  assert.deepEqual(JSON.parse(String(seen.at(-1)!.body)), { app_id: 'ie.napkin.brand' })
  const got = await httpHost.harvestApply({ work: true, fields: ['x'], summary: 'Approved' })
  assert.equal(got.published, 6)
  assert.equal(seen.at(-1)!.url, `${FRAME}/harvest/apply`)
  assert.deepEqual(JSON.parse(String(seen.at(-1)!.body)), { work: true, fields: ['x'], summary: 'Approved' })
})

test('upstream reports what is attached', async () => {
  const attached = [{ document_id: 'b-1', app_id: 'ie.napkin.brand', version: 5, version_now: 6, status: 'changed', in_store: true, at: 't' }]
  serve(R('/upstream', { document_id: 'doc-a', carried: null, upstream: [], attached }))
  assert.deepEqual((await httpHost.upstream()).attached, attached)
})

test('a question to the middleware goes on the open document; a seed goes on the new Brand Clan, which is not opened', async () => {
  const seen = serve({
    ...R('/api-proxy', { ok: true, status: 200, data: { api: 'napkin.middleware/1', result: { candidates: [{ ref: 'brand/lumen-water', name: 'Lumen Water', categories: [], client_org: null }] }, change: null } }),
    '/s/brand-new-token/api-proxy': { body: { ok: true, status: 200, data: { api: 'napkin.middleware/1', change: { applied: true } } } },
  })
  const found = await httpHost.middlewareRead('brand_identify', { text: 'lumen' })
  assert.equal(found.result?.candidates?.[0].ref, 'brand/lumen-water')
  assert.equal(seen.at(-1)!.url, `${FRAME}/api-proxy`)
  assert.deepEqual(JSON.parse(String(seen.at(-1)!.body)), { request_kind: 'middleware', payload: { task: 'brand_identify', input: { text: 'lumen' } } })

  const { path } = await httpHost.newDocumentQuietly('ie.napkin.brand', 'Lumen Water')
  assert.equal(path, 'brand-new')
  assert.deepEqual(JSON.parse(String(seen.at(-1)!.body)), { app_id: 'ie.napkin.brand', title: 'Lumen Water' })
  await httpHost.middlewareRunOn(path, 'brand_seed', { name: 'Lumen Water', by: 'human:shrey' })
  assert.equal(seen.at(-1)!.url, 'https://studio.test/s/brand-new-token/api-proxy')
  assert.deepEqual(JSON.parse(String(seen.at(-1)!.body)).payload, { task: 'brand_seed', input: { name: 'Lumen Water', by: 'human:shrey' } })
  // The open document is still doc-a.
  assert.equal(httpHost.clanOrigin(), FRAME)
})

test('a middleware refusal, or a change the host did not apply, is thrown in words', async () => {
  serve({
    ...R('/api-proxy', { ok: false, status: 0, data: null, error: { type: 'no_middleware', message: 'No middleware is configured for this workspace (proxies.middleware in workspace.yaml).' } }),
    '/s/brand-new-token/api-proxy': { body: { ok: true, status: 200, data: { api: 'napkin.middleware/1', change: { applied: false, reason: 'already applied' } } } },
  })
  await assert.rejects(httpHost.middlewareRead('brand_identify', { text: 'x' }), /No middleware is configured/)
  await assert.rejects(httpHost.middlewareRunOn('brand-new', 'brand_seed', { ref: 'brand/x' }), { message: 'already applied' })
})
