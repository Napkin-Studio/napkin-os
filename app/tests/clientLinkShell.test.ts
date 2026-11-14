// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The client's link for the brief (features/align-booth.clan; security review of 52287837). Making a link or a
// round, and withdrawing one, are the shell's own screen, started from Share, Send the client copy, and act on the
// document open in the frame, never on the server's last document and never for a file opened from this device. The
// page's frame cannot ask for a link: there is no message for it. The Booth only shows what exists, read through the
// frame's own token routes (`/client-link/list`, `/client-review/round`; crates/napkin-web/src/sandbox.rs refuses
// `/client-link/issue` and `/client-link/issue-round` to a frame).

import { dom } from './clientLinkDom.ts'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { httpHost, listClientLinksOf, makeClientLinkFor, withdrawClientLinkOf } from '../src/host/http.ts'
import { clientLinkDoc } from '../src/shell/gate/words.ts'

void dom
interface Seen { url: string; method: string }
const seen: Seen[] = []
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const url = String(input), method = init?.method ?? 'GET'
  seen.push({ url, method })
  if (url === '/api/session') return json({ tenant: 't1', sandbox_origin: null, quota: { used: 0, cap: 40 } })
  if (/\/d\/doc-[ab]$/.test(url)) {
    const path = url.slice(url.lastIndexOf('/') + 1)
    return json({ path, token: `${path}-token`, sandbox_origin: null, manifest: { title: path }, validation: 'OK', has_human_view: true, render_model: 'authored', is_template: false, trusted: false })
  }
  if (url.endsWith('/client-links')) return json({ links: [] })
  if (method === 'POST' && url.endsWith('/client-link')) return json({ ok: true, id: 'L1', path: '/c/SIGNED', expires: '' })
  return json({ ok: true })
}) as typeof fetch
const path = (u: string) => new URL(u, 'https://studio.test').pathname

test('a withdraw id is never a path: only a link id reaches the withdraw route, of the document named', async () => {
  seen.length = 0
  for (const bad of ['../../../../../auth/sign-out?', '../../doc-b/client-link/L1', 'L1/../x', '', 'a b']) {
    await assert.rejects(withdrawClientLinkOf('doc-a', bad), `"${bad}" is refused`)
  }
  assert.deepEqual(seen.filter(s => s.method === 'POST'), [], 'nothing was posted for a bad id')
  await withdrawClientLinkOf('doc-a', 'cl_01AB-x9')
  const post = seen.find(s => s.method === 'POST')!
  assert.equal(path(post.url), '/api/t/t1/d/doc-a/client-link/cl_01AB-x9/withdraw')
})

test('the shell’s form acts on the document it was opened for, not the server’s last document', async () => {
  await httpHost.openClan('doc-b')  // the server's last document is doc-b
  seen.length = 0
  await listClientLinksOf('doc-a')
  await makeClientLinkFor('doc-a', 'Client A contact', 'contact@client-a.example')
  const urls = seen.filter(s => s.url !== '/api/session').map(s => `${s.method} ${path(s.url)}`)
  assert.deepEqual(urls, ['GET /api/t/t1/d/doc-a/client-links', 'POST /api/t/t1/d/doc-a/client-link'])
})

test('the form is offered only for a locked server brief, never a file from this device or in client review', () => {
  const base = { docPath: 'store/brief-1', appId: 'ie.napkin.brief-maker', isTemplate: false, clientOn: false, locked: true, server: true }
  assert.equal(clientLinkDoc(base), 'store/brief-1')
  assert.equal(clientLinkDoc({ ...base, server: false }), null, 'a .clan opened from this device has no server document')
  assert.equal(clientLinkDoc({ ...base, locked: false }), null)
  assert.equal(clientLinkDoc({ ...base, clientOn: true }), null)
  assert.equal(clientLinkDoc({ ...base, isTemplate: true }), null)
  assert.equal(clientLinkDoc({ ...base, appId: 'ie.napkin.script-editor' }), null)
})

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : [p] })
}
function appDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 6; i++) { if (existsSync(join(dir, 'templates', 'shared', 'clan-fields.html'))) return dir; dir = dirname(dir) }
  return process.cwd()
}

test('no message from a frame can make, withdraw or read a client link through the shell', () => {
  const app = appDir()
  const said = files(join(app, 'src')).filter(f => /\.(ts|tsx)$/.test(f)).filter(f => /clan:client-link/.test(readFileSync(f, 'utf8')))
  assert.deepEqual(said, [], 'the shell listens for no client-link message')
  assert.equal(existsSync(join(app, 'src', 'shell', 'gate', 'clientLinkFeed.ts')), false)
  const page = readFileSync(join(app, 'templates', 'brief-maker', 'index.html'), 'utf8')
  assert.doesNotMatch(page, /clan:client-link/, 'the page posts no client-link message')
  // The Booth reads what exists through the frame's own token routes, read-only.
  assert.match(page, /fetch\(clanScheme\+'\/client-link\/list'\)/)
  assert.match(page, /fetch\(clanScheme\+'\/client-review\/round'\)/)
  assert.doesNotMatch(page, /clanScheme\+'\/client-link\/(issue|withdraw)/)
})
