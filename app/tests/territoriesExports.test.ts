// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Territories exports (territories-exports): the Export window's rows and what each button does. Every file goes middleware (fetch_territories_file)
// -> host export (clan.exportDoc: Chromium prints a PDF, the shell saves it), never a blob link (the app frame has no allow-downloads); a failure
// is said in words and the window says nothing was changed; Export waits for a greenlit route and says why; a file made before a change reads stale.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

let root = new URL('.', import.meta.url)
while (!existsSync(new URL('package.json', root))) root = new URL('..', root)
const dir = new URL('templates/territories/', root)
const html = readFileSync(new URL('index.html', dir), 'utf8')
const X = vm.runInNewContext(`${/<script id="territories-exports-logic">([\s\S]*?)<\/script>/.exec(html)![1]}; TerritoriesExports`, { atob: (s: string) => Buffer.from(s, 'base64').toString('binary'), TextDecoder, Uint8Array }) as any // eslint-disable-line @typescript-eslint/no-explicit-any
type Doc = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const doc = (): Doc => JSON.parse(readFileSync(new URL('example/data.json', dir), 'utf8'))
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64')
const plain = (h: string) => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')

function host(over: Doc = {}) {
  const calls: { task?: string; name?: string; kind?: string; filename?: string; html?: string }[] = []
  return {
    calls,
    apiProxy: (_: string, req: Doc) => { calls.push({ task: req.task, name: req.input.name }); return Promise.resolve(over.proxy ? over.proxy(req) : { ok: true, data: { api: 'x', result: { data_b64: b64('<p>é ' + req.input.name + '</p>') } } }) },
    exportDoc: (kind: string, filename: string, h: string) => { calls.push({ kind, filename, html: h }); return Promise.resolve(over.export ? over.export() : { ok: true }) },
  }
}

test('the window lists the board, its client copy, a one-pager and a client copy per greenlit route, and the JSON', () => {
  const d = doc(), f = X.files(d) as Doc[], n = d.greenlit.length
  assert.equal(f.length, 2 + 2 * n + 1)
  assert.equal(f.map((x) => x.key).slice(0, 2).join(), 'board,board-client')
  assert.equal(f[f.length - 1].file, 'territories.json')
  assert.ok(f.every((x) => /^[\w.-]+$/.test(x.name)), 'file names are safe')
  const ranks = X.routes(d).map((t: Doc) => t.rank) as number[]
  assert.equal(ranks.join(), [...ranks].sort((a, b) => a - b).join(), 'the judge\'s order')
})

test('each button fetches its file by name and hands it to the host export with the right kind', async () => {
  const d = doc()
  for (const f of X.files(d) as Doc[]) {
    const h = host(), r = await X.run(d, f.key, h)
    assert.equal(r.ok, true, f.key)
    assert.equal(h.calls[0].task, 'fetch_territories_file'); assert.equal(h.calls[0].name, f.file)
    assert.equal(h.calls[1].kind, f.kind, 'PDFs and the JSON both leave through exportDoc'); assert.equal(h.calls[1].filename, f.name)
    assert.ok(h.calls[1].html!.startsWith('<p>é '), 'the bytes are read as UTF-8')
    assert.ok(r.name.endsWith(f.kind === 'json' ? '.json' : '.pdf'))
  }
})

test('a failure is said in words and the file is not marked made', async () => {
  const d = doc()
  let r = await X.run(d, 'board', host({ proxy: () => ({ error: { type: 'x', message: 'Nothing is greenlit yet.' } }) }))
  assert.equal(r.ok, false); assert.equal(r.why, 'Nothing is greenlit yet.')
  r = await X.run(d, 'board', host({ proxy: () => ({ ok: true, data: { api: 'x', error: { message: 'It could not be made just now. Nothing was changed; try again.' } } }) }))
  assert.match(r.why, /could not be made/)
  r = await X.run(d, 'board', host({ export: () => ({ ok: false }) })); assert.match(r.why, /could not start the download/)
  r = await X.run(d, 'board', { apiProxy: () => Promise.reject(new Error('offline')), exportDoc: () => Promise.resolve({ ok: true }) }); assert.match(r.why, /offline/)
  r = await X.run(d, 'board', {}); assert.match(r.why, /host and the engine/)
  r = await X.run(d, 'nope', host()); assert.match(r.why, /not on offer/)
})

test('Export waits for a greenlit route and says why', async () => {
  const d = doc(); d.greenlit = []
  assert.equal(X.can(d).ok, false); assert.match(X.can(d).why, /Greenlight a route first/)
  const h = host(), r = await X.run(d, 'board', h)
  assert.equal(r.ok, false); assert.equal(h.calls.length, 0, 'no call is made')
  assert.match(plain(X.dialog(d, {}).html), /Greenlight a route first/)
})

test('a file made before a change reads stale', () => {
  const d = doc(), made = { board: X.sign(d) }, win = (dd: Doc) => plain(X.dialog(dd, { exp: { made } }).html)
  assert.match(win(d), /saved/); assert.doesNotMatch(win(d), /before your last change/)
  d.territories.find((t: Doc) => t.id === d.greenlit[0].territory_id).world.headlines.wq = 'A new line.'
  assert.match(win(d), /made before your last change/)
})

test('the window shows no id, no price and no score', () => {
  const t = plain(X.dialog(doc(), {}).html)
  assert.doesNotMatch(t, /\bt_[a-z0-9]+\b|\$|usd|price|\/\s?35/i)
})
