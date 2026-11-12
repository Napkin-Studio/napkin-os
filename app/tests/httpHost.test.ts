// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The web host must agree with the device host about which document is open.
//
// The device host answers in the order it is asked — every call is a function
// call into the same WebAssembly session. The web host's answers come back
// over the network in whatever order they arrive, and on load the shell asks
// for home and for a `?open=` document at the same moment. When home answered
// last, the web host took it as the open document while the shell showed the
// other one: the frame got home's token, so the Research Tool read home's
// empty decision chain — "Lock and accept 5" and no History count, where the
// device host showed 6 and 23 for the same file. These pin the rule that fixed
// it: the last open asked for is the open document, whatever order the
// answers come in.

import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import { httpHost } from '../src/host/http.ts'

const TENANT = '00000000-0000-4000-8000-000000000000'

/** Answer the web API, with each open taking as long as the test says. */
function serve(delays: Record<string, number>) {
  const seen: string[] = []
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input)
    seen.push(url)
    const reply = (body: unknown, ms = 0) =>
      new Promise<Response>(resolve => setTimeout(() => resolve(new Response(JSON.stringify(body), {
        status: 200, headers: { 'content-type': 'application/json' },
      })), ms))
    if (url === '/api/session') return reply({ tenant: TENANT, sandbox_origin: null, quota: { used: 0, cap: 40 } })
    const open = (path: string, token: string) => ({
      path, token, sandbox_origin: null,
      manifest: { title: path }, validation: 'OK', has_human_view: true,
      render_model: 'authored', is_template: false, trusted: false,
    })
    if (url.endsWith('/home')) return reply(open('home-x', 'home-token'), delays.home ?? 0)
    const doc = /\/d\/([^/]+)$/.exec(url)
    if (doc) return reply(open(decodeURIComponent(doc[1]), `${doc[1]}-token`), delays[doc[1]] ?? 0)
    if (url.endsWith('/entry/data')) return new Response('verdict: yes')
    throw new Error(`unexpected ${url}`)
  }) as typeof fetch
  return seen
}

beforeEach(() => {
  // What the host reads off the page: the origin its frame URLs are built on.
  ;(globalThis as { window?: unknown }).window = { location: { origin: 'https://studio.test' } }
})

test('an open answered after a later one does not become the open document', async () => {
  const seen = serve({ home: 60, 'doc-a': 5 })
  // As the shell does on load: home, then the ?open= document, together.
  const [home, doc] = await Promise.all([httpHost.openHome(), httpHost.openClan('doc-a')])
  assert.equal(home.path, 'home-x')
  assert.equal(doc.path, 'doc-a')

  // The frame's clan:// base names the document the shell is showing…
  assert.equal(httpHost.clanOrigin(), 'https://studio.test/s/doc-a-token')
  // …and so does everything read or written on its behalf: the frame's page too.
  assert.equal(
    httpHost.frameSrc({ model: 'authored', capture: false, theme: 'light', version: 'sha256:ab' }),
    'https://studio.test/s/doc-a-token/document?model=authored&capture=0&theme=light&v=sha256%3Aab',
  )
  await httpHost.getData()
  assert.ok(seen.at(-1)?.endsWith('/d/doc-a/entry/data'), seen.at(-1))
})

test('opens answered in order still end on the last one', async () => {
  serve({ home: 0, 'doc-b': 30 })
  await Promise.all([httpHost.openHome(), httpHost.openClan('doc-b')])
  assert.equal(httpHost.clanOrigin(), 'https://studio.test/s/doc-b-token')
})

test('going home after a document makes home the open document', async () => {
  serve({})
  await httpHost.openClan('doc-c')
  await httpHost.openHome()
  assert.equal(httpHost.clanOrigin(), 'https://studio.test/s/home-token')
})

test('the signed-in person is the tenant, as the host acts for it', async () => {
  serve({})
  // napkin-web's TenantId::ctx runs as human:<tenant>; apps are told the same.
  assert.deepEqual(await httpHost.whoAmI(), { actor: `human:${TENANT}`, id: TENANT, name: null })
})

test('source cards for a section come back from one POST /cite on the open document', async () => {
  const seen = serve({})
  await httpHost.openClan('doc-d')
  const card = { ref: 'f_1', kind: 'fact', label: 'Share', origin: 'document', review: { verdict: 'verified', by: 'You' } }
  const asked: { url: string; body: unknown }[] = []
  const real = globalThis.fetch
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    if (!url.endsWith('/cite')) return real(input, init)
    asked.push({ url, body: JSON.parse(String(init?.body)) })
    return new Response(JSON.stringify({ cites: { f_1: card } }), { status: 200 })
  }) as typeof fetch
  const cards = await httpHost.cites(['f_1', 'fi_2'])
  assert.deepEqual(asked, [{ url: 'https://studio.test/s/doc-d-token/cite', body: { refs: ['f_1', 'fi_2'] } }])
  assert.deepEqual(cards, { f_1: card })
  assert.ok(seen.length > 0)
})

test('settling a job polls it through the shell API by its document, without opening it', async () => {
  serve({})
  await httpHost.openClan('doc-open')
  const asked: { url: string; method?: string }[] = []
  const real = globalThis.fetch
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    if (!url.includes('/jobs/')) return real(input, init)
    asked.push({ url, method: init?.method })
    return new Response(JSON.stringify({ ok: true, data: { job: { state: 'done' } } }), { status: 200 })
  }) as typeof fetch
  await httpHost.settleJob!('doc-closed', 'job_0abc')
  assert.deepEqual(asked, [{ url: `/api/t/${TENANT}/d/doc-closed/jobs/job_0abc/settle`, method: 'POST' }])
  // the open document is still the one the shell opened
  assert.equal(httpHost.clanOrigin(), 'https://studio.test/s/doc-open-token')
})

// ── The frame's page is one GET (features/doc-open-direct.clan) ────────────

test('opening a document asks for its page by address and posts nothing', async () => {
  const seen = serve({ 'doc-f': 0 })
  await httpHost.openClan('doc-f')
  const src = httpHost.frameSrc({ model: 'legacy', capture: true, theme: 'dark', version: 'v1' })
  assert.equal(src, 'https://studio.test/s/doc-f-token/document?model=legacy&capture=1&theme=dark&v=v1')
  assert.ok(!seen.some(u => /human-html|preview-html/.test(u)), seen.join(' '))
  await assert.rejects(httpHost.compose({ model: 'legacy', capture: false, theme: 'light', version: 'v1' }))
})
