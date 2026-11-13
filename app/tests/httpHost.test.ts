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

import { httpHost, renewToken } from '../src/host/http.ts'

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

// ── A token from before a deploy (features/stale-token-and-menus.clan) ────────
// napkin-web keeps sandbox tokens in memory, so a deploy ends every open
// page's token. A call refused as stale opens the document again for a new
// token and is sent once more on it; a second refusal is the caller's.

const STALE = () => new Response(JSON.stringify({ ok: false, error: 'invalid or expired sandbox token', code: 'sandbox_token' }), { status: 403 })

/** The web API after a restart: `dead` tokens are refused; each open of a document mints the next token. */
function afterDeploy(dead: Set<string>, routeReply: (token: string) => Response) {
  const seen: string[] = []
  let minted = 0
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input)
    seen.push(url)
    if (url === '/api/session') return new Response(JSON.stringify({ tenant: TENANT, sandbox_origin: null, quota: { used: 0, cap: 40 } }))
    const doc = /\/d\/([^/]+)$/.exec(url)
    if (doc) {
      const token = `${doc[1]}-t${minted++}`
      return new Response(JSON.stringify({ path: doc[1], token, sandbox_origin: null, manifest: { title: doc[1] }, validation: 'OK', has_human_view: true, render_model: 'authored', is_template: false, trusted: false }))
    }
    const tok = /\/s\/([^/]+)\//.exec(url)
    if (tok) return dead.has(tok[1]) ? STALE() : routeReply(tok[1])
    throw new Error(`unexpected ${url}`)
  }) as typeof fetch
  return seen
}

test('a write refused for a stale token opens the document again and is sent once more, on the new token', async () => {
  const dead = new Set<string>()
  const seen = afterDeploy(dead, () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
  await httpHost.openClan('doc-s')
  assert.equal(httpHost.clanOrigin(), 'https://studio.test/s/doc-s-t0')
  dead.add('doc-s-t0') // the deploy
  await httpHost.verify('f_1', 'checked')
  const verifies = seen.filter(u => u.endsWith('/verify'))
  assert.deepEqual(verifies, ['https://studio.test/s/doc-s-t0/verify', 'https://studio.test/s/doc-s-t1/verify'])
  assert.equal(seen.filter(u => u.endsWith('/d/doc-s')).length, 2, 'one open, one re-open')
  // Everything after it, the frame's page included, is on the new token.
  assert.equal(httpHost.clanOrigin(), 'https://studio.test/s/doc-s-t1')
  await httpHost.getDecisions().catch(() => null)
  assert.equal(seen.filter(u => u.includes('/s/doc-s-t0/')).length, 1, 'the dead token is never used again')
})

test('a second stale refusal is thrown, never retried again: no loop', async () => {
  const dead = new Set<string>()
  // every token is dead: the server refuses whatever the shell gets
  const seen = afterDeploy(dead, () => STALE())
  await httpHost.openClan('doc-l')
  dead.add('doc-l-t0')
  await assert.rejects(httpHost.verify('f_1', 'checked'), /invalid or expired sandbox token/)
  assert.equal(seen.filter(u => u.endsWith('/verify')).length, 2, 'the call and one retry')
  assert.equal(seen.filter(u => u.endsWith('/d/doc-l')).length, 2, 'one re-open')
})

test('any other refusal is the caller\'s at once: nothing is re-opened', async () => {
  const seen = afterDeploy(new Set(), () => new Response(JSON.stringify({ ok: false, error: 'locked' }), { status: 403 }))
  await httpHost.openClan('doc-o')
  await assert.rejects(httpHost.verify('f_1', 'x'), /locked/)
  assert.equal(seen.filter(u => u.endsWith('/verify')).length, 1)
  assert.equal(seen.filter(u => u.endsWith('/d/doc-o')).length, 1)
})

test('the frame asks for a token the shell already renewed: the answer is the new one, with no second open', async () => {
  const dead = new Set<string>()
  const seen = afterDeploy(dead, () => new Response('{}', { status: 200 }))
  await httpHost.openClan('doc-r')
  const held = httpHost.clanOrigin()
  // two refused calls at once share one re-open
  const [a, b] = await Promise.all([renewToken(held), renewToken(held)])
  assert.equal(a, 'https://studio.test/s/doc-r-t1')
  assert.equal(b, a)
  // the frame, still on the old one, is told the new one without asking the server
  assert.equal(await renewToken(held), 'https://studio.test/s/doc-r-t1')
  assert.equal(seen.filter(u => u.endsWith('/d/doc-r')).length, 2)
})
