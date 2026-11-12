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
    if (url.endsWith('/human-html')) return new Response('<p>view</p>')
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
  // …and so does everything read or written on its behalf.
  await httpHost.getHumanHtml()
  assert.ok(seen.at(-1)?.endsWith('/d/doc-a/human-html'), seen.at(-1))
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

// ── The composed page goes gzipped (features/doc-open-speed.clan) ────────────

/** Record each preview-html post; `refuse` answers the gzipped ones 400, as a server that cannot unpack them would. */
function servePosts(refuse = false) {
  const posts: { encoding: string | null; body: Uint8Array | string }[] = []
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/session') return new Response(JSON.stringify({ tenant: TENANT, sandbox_origin: null, quota: { used: 0, cap: 40 } }))
    const doc = /\/d\/([^/]+)$/.exec(url)
    if (doc) {
      return new Response(JSON.stringify({
        path: doc[1], token: 't', sandbox_origin: null, manifest: { title: 'x' }, validation: 'OK',
        has_human_view: true, render_model: 'authored', is_template: false, trusted: false,
      }))
    }
    if (url.endsWith('/preview-html')) {
      const encoding = new Headers(init?.headers).get('content-encoding')
      posts.push({ encoding, body: init?.body as Uint8Array | string })
      if (refuse && encoding) return new Response('Invalid UTF-8', { status: 400 })
      return new Response('{"ok":true}')
    }
    throw new Error(`unexpected ${url}`)
  }) as typeof fetch
  return posts
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

const BIG = `<!doctype html><html><body>${'<p>A finding, its source and its lens.</p>'.repeat(20_000)}</body></html>`

test('a large composed page is posted gzipped and unpacks to the same page', async () => {
  const posts = servePosts()
  await httpHost.openClan('doc-g')
  await httpHost.updatePreviewHtml(BIG)
  assert.equal(posts.length, 1)
  assert.equal(posts[0].encoding, 'gzip')
  const body = posts[0].body as Uint8Array
  assert.ok(body.byteLength * 10 < BIG.length, `${body.byteLength} bytes for ${BIG.length}`)
  assert.equal(await gunzip(body), BIG)
})

test('a small page is posted as it is', async () => {
  const posts = servePosts()
  await httpHost.openClan('doc-s')
  await httpHost.updatePreviewHtml('<p>short</p>')
  assert.deepEqual(posts, [{ encoding: null, body: '<p>short</p>' }])
})

test('a server that refuses the gzipped page is sent it plain', async () => {
  const posts = servePosts(true)
  await httpHost.openClan('doc-r')
  await httpHost.updatePreviewHtml(BIG)
  assert.equal(posts.length, 2)
  assert.equal(posts[1].encoding, null)
  assert.equal(posts[1].body, BIG)
})
