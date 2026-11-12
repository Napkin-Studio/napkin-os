// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The web frame's fetch shim (src/shell/bridge/webShim.js) after a deploy
// (features/stale-token-and-menus.clan): napkin-web keeps sandbox tokens in
// memory, so an open page's token dies with the old process. A call refused
// for it asks the shell for the document's origin now and is sent once more on
// it, so the person's edit is kept; later calls use the new origin; a second
// refusal, or any other one, is the app's to see.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The shim as the composer reads it, found from wherever the runner put this bundle. */
function shimSource(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 6; i++) {
    const f = join(dir, 'src', 'shell', 'bridge', 'webShim.js')
    if (existsSync(f)) return readFileSync(f, 'utf8')
    dir = dirname(dir)
  }
  return readFileSync(join(process.cwd(), 'src', 'shell', 'bridge', 'webShim.js'), 'utf8')
}
// The composer drops the leading `//` lines first (napkin-host frame.rs script_body).
const SHIM = shimSource().replace(/^(\/\/[^\n]*\n)+/, '')
const OLD = 'https://studio.test/s/old'
const NEW = 'https://studio.test/s/new'

const stale = () => new Response(JSON.stringify({ ok: false, error: 'invalid or expired sandbox token', code: 'sandbox_token' }), { status: 403 })
const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 })

/**
 * A frame page with the shim in it, as the composer writes it (the base in
 * place of "__CLAN_ORIGIN__"). `server` answers each URL the page fetches;
 * `shell` answers its `clan:token?` (undefined: never answers).
 */
function page(server: (url: string, init?: RequestInit) => Response, shell: (held: string) => string | null | undefined) {
  const fetched: { url: string; body?: unknown }[] = []
  const asked: string[] = []
  const listeners = new Set<(e: { source: unknown; data: unknown }) => void>()
  const parent = {
    postMessage(m: { type: string; held: string }) {
      if (m.type !== 'clan:token?') return
      asked.push(m.held)
      const origin = shell(m.held)
      if (origin === undefined) return
      setTimeout(() => { for (const l of [...listeners]) l({ source: parent, data: { type: 'clan:token', origin } }) }, 1)
    },
  }
  const win: Record<string, unknown> = {
    parent,
    fetch: async (url: string, init?: RequestInit) => { fetched.push({ url, body: init?.body }); return server(url, init) },
    addEventListener: (_: string, l: (e: { source: unknown; data: unknown }) => void) => listeners.add(l),
    removeEventListener: (_: string, l: (e: { source: unknown; data: unknown }) => void) => listeners.delete(l),
  }
  new Function('window', SHIM.replace('"__CLAN_ORIGIN__"', JSON.stringify(OLD)))(win)
  return { fetch: win.fetch as typeof fetch, fetched, asked }
}

test('a write refused for a dead token asks the shell for the new one and goes through, edit and all', async () => {
  const p = page(url => (url.startsWith(OLD) ? stale() : ok()), () => NEW)
  // The page's own literal base (the composer rewrote clan://localhost to it) and a base built later.
  const body = JSON.stringify({ patch: { insight: 'my words' } })
  const r = await p.fetch(`${OLD}/patch-data`, { method: 'POST', body })
  assert.equal(r.status, 200)
  assert.deepEqual(p.fetched, [{ url: `${OLD}/patch-data`, body }, { url: `${NEW}/patch-data`, body }], 'the same write, once more, on the new token')
  assert.deepEqual(p.asked, [OLD])
  // Every later call goes to the new origin at once, however it names the base.
  await p.fetch('clan://localhost/chain')
  await p.fetch(`${OLD}/decisions`)
  assert.deepEqual(p.fetched.slice(2).map(f => f.url), [`${NEW}/chain`, `${NEW}/decisions`])
  assert.equal(p.asked.length, 1)
})

test('calls refused together ask once', async () => {
  const p = page(url => (url.startsWith(OLD) ? stale() : ok()), () => NEW)
  const rs = await Promise.all([p.fetch(`${OLD}/patch-data`, { method: 'POST' }), p.fetch(`${OLD}/chain`)])
  assert.deepEqual(rs.map(r => r.status), [200, 200])
  assert.equal(p.asked.length, 1)
})

test('a second refusal is the app\'s: one retry, never a loop', async () => {
  const p = page(() => stale(), held => (held === OLD ? NEW : `${NEW}2`))
  const r = await p.fetch(`${OLD}/patch-data`, { method: 'POST' })
  assert.equal(r.status, 403)
  assert.deepEqual((await r.json()).code, 'sandbox_token', 'the app reads the refusal as it would have')
  assert.equal(p.fetched.length, 2)
  assert.equal(p.asked.length, 1)
})

test('a shell with no new token, or any other refusal, leaves the call as it was answered', async () => {
  const none = page(() => stale(), () => null)
  assert.equal((await none.fetch(`${OLD}/patch-data`)).status, 403)
  assert.equal(none.fetched.length, 1)

  const locked = page(() => new Response(JSON.stringify({ ok: false, error: 'locked' }), { status: 403 }), () => NEW)
  assert.equal((await locked.fetch(`${OLD}/patch-data`)).status, 403)
  assert.equal(locked.fetched.length, 1)
  assert.deepEqual(locked.asked, [], 'nothing is asked of the shell for a refusal that is not the token')

  // A call to somewhere else is never the shim's to retry.
  const elsewhere = page(() => stale(), () => NEW)
  assert.equal((await elsewhere.fetch('https://fonts.example/x.css')).status, 403)
  assert.deepEqual(elsewhere.asked, [])
})
