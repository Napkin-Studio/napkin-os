// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The landing reads through the host and nothing else; a host that cannot list
// the library rejects, which is how the shell knows to keep the Launcher.

import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import type { ClientRecord, LibraryItem } from '../src/host/types.ts'
import { libraryQuery, httpHost } from '../src/host/http.ts'
import { addClient, loadLanding, type LandingHost } from '../src/shell/landing/store.ts'

const rec = (name: string): ClientRecord => ({
  id: 'cli_00000001', name, initials: 'CA', material: 'pearl', owner: 'human:t', created_at: '2026-11-01T00:00:00Z',
})

function fake(over: Partial<LandingHost> = {}, calls: string[] = []): LandingHost {
  return {
    listLibrary: async () => { calls.push('library'); return { items: [] as LibraryItem[], clients_unassigned: 3 } },
    whoAmI: async () => ({ actor: 'human:a@b', id: 'a@b', name: null }),
    listApps: async () => [{ app_id: 'ie.napkin.brief-maker', name: 'Brief Maker', version: '1', path: 'p' }],
    clients: {
      list: async () => { calls.push('clients'); return [rec('Client A')] },
      create: async name => rec(name),
    },
    ...over,
  }
}

test('one read gathers the clients, the library, who is here and which apps are installed', async () => {
  const calls: string[] = []
  const d = await loadLanding(fake({}, calls))
  assert.deepEqual(calls.sort(), ['clients', 'library'])
  assert.equal(d.clients[0].name, 'Client A')
  assert.equal(d.unassigned, 3)
  assert.deepEqual(d.apps, ['ie.napkin.brief-maker'])
  assert.equal(d.person?.id, 'a@b')
})

test('who failing does not stop the landing; the library or the app list failing does', async () => {
  const d = await loadLanding(fake({ whoAmI: async () => { throw new Error('x') } }))
  assert.equal(d.person, null)
  await assert.rejects(loadLanding(fake({ listLibrary: async () => { throw new Error('404 Not Found') } })), /404/)
  await assert.rejects(loadLanding(fake({ clients: { list: async () => { throw new Error('boom') }, create: async n => rec(n) } })), /boom/)
  // A failed app list on the first read is a fault, not "no tool is installed".
  await assert.rejects(loadLanding(fake({ listApps: async () => { throw new Error('y') } })), /y/)
})

test('a later app-list failure keeps the last known apps', async () => {
  const d = await loadLanding(fake({ listApps: async () => { throw new Error('y') } }), ['ie.napkin.brief-maker'])
  assert.deepEqual(d.apps, ['ie.napkin.brief-maker'])
})

test('adding a client resolves null, or with the host\'s own words when refused', async () => {
  assert.equal(await addClient(fake(), 'Client B'), null)
  const refused = fake({ clients: { list: async () => [], create: async () => { throw new Error('there is already a client called "Client A"') } } })
  assert.equal(await addClient(refused, 'Client A'), 'there is already a client called "Client A"')
  const silent = fake({ clients: { list: async () => [], create: async () => { throw new Error('') } } })
  assert.equal(await addClient(silent, 'x'), 'The client could not be added.')
})

// ── the web host's adapters ──────────────────────────────────────────────────

const TENANT = '00000000-0000-4000-8000-000000000000'
let seen: { url: string; method: string; body: string | null }[] = []

beforeEach(() => {
  seen = []
  ;(globalThis as { window?: unknown }).window = { location: { origin: 'https://studio.test' } }
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    seen.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : null })
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    if (url === '/api/session') return json({ tenant: TENANT, sandbox_origin: null, quota: { used: 0, cap: 40 } })
    if (url.endsWith('/clients') && init?.method === 'POST' && init.body && JSON.parse(String(init.body)).name === 'Dup')
      return json({ ok: false, error: 'there is already a client called "Dup"' }, 409)
    return json({ items: [], clients_unassigned: 0 })
  }) as typeof fetch
})

test('the library query names only the filter it is given', () => {
  assert.equal(libraryQuery(), '')
  assert.equal(libraryQuery({}), '')
  assert.equal(libraryQuery({ client: 'cli_0a1b2c3d' }), '?client=cli_0a1b2c3d')
  assert.equal(libraryQuery({ client: 'cli_0a1b2c3d', app: 'ie.napkin.brief-maker' }), '?client=cli_0a1b2c3d&app=ie.napkin.brief-maker')
  assert.equal(libraryQuery({ app: 'a b&c' }), '?app=a+b%26c')
})

test('the web host reaches the tenant\'s own routes', async () => {
  await httpHost.listLibrary({ client: 'cli_0a1b2c3d' })
  await httpHost.clients.list()
  await httpHost.clients.list(true)
  await httpHost.clients.create('Client A', 'stone')
  await httpHost.clients.update('cli_0a1b2c3d', { name: 'Client B' })
  await httpHost.clients.archive('cli_0a1b2c3d')
  await httpHost.clients.restore('cli_0a1b2c3d')
  await httpHost.clients.adopt(['Client C'])
  const t = `/api/t/${TENANT}`
  const calls = seen.filter(s => s.url !== '/api/session').map(s => `${s.method} ${s.url.replace(t, '')}`)
  assert.deepEqual(calls, [
    'GET /library?client=cli_0a1b2c3d',
    'GET /clients',
    'GET /clients?archived=1',
    'POST /clients',
    'PATCH /clients/cli_0a1b2c3d',
    'POST /clients/cli_0a1b2c3d/archive',
    'POST /clients/cli_0a1b2c3d/restore',
    'POST /clients/adopt',
  ])
  assert.deepEqual(JSON.parse(seen.find(s => s.method === 'POST' && s.url.endsWith('/clients'))!.body!), { name: 'Client A', material: 'stone' })
  assert.deepEqual(JSON.parse(seen.find(s => s.method === 'PATCH')!.body!), { name: 'Client B' })
  assert.deepEqual(JSON.parse(seen.find(s => s.url.endsWith('/adopt'))!.body!), { names: ['Client C'] })
})

test('a refusal comes back as the host\'s own words', async () => {
  await assert.rejects(httpHost.clients.create('Dup'), /there is already a client called "Dup"/)
})
