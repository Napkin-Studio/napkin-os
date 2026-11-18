// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The shell's side of the Production Tool at /production (features/os-sign-in.clan):
// the service worker leaves it to the server, sign-in sends a person back to
// it only by a safe `next`, and the home offers it only when the server does.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// @ts-expect-error: plain JavaScript, shared with the service worker
import { serverOwned, shellRoute } from '../pwa/routes.js'
import { MakeAnAdCard } from '../src/shell/MakeAnAdCard.tsx'
import { afterSignIn, nextFrom, nextWhenSignedIn, safeNext } from '../src/shell/next.ts'

const ORIGIN = 'https://studio.test'
const scope = new URL(`${ORIGIN}/`)
const at = (p: string) => new URL(p, ORIGIN)

test('the service worker leaves /production to the server', () => {
  for (const p of ['/production', '/production/', '/production/p/x', '/production/assets/a.js', '/production/p/x?shot=1']) {
    assert.ok(serverOwned(at(p), scope), p)
    assert.ok(!shellRoute(at(p), scope), p)
  }
})

test('the shell keeps its own routes and files', () => {
  for (const p of ['/', '/view', '/index.html']) {
    assert.ok(!serverOwned(at(p), scope), p)
    assert.ok(shellRoute(at(p), scope), p)
  }
  assert.ok(!serverOwned(at('/apps.json'), scope))
  assert.ok(!shellRoute(at('/apps.json'), scope))
  assert.ok(!serverOwned(at('/productions'), scope), 'only the /production path itself')
  assert.ok(serverOwned(at('/api/session'), scope))
  assert.ok(serverOwned(at('/s/abc/index.html'), scope))
  assert.ok(!serverOwned(new URL('https://elsewhere.test/production/'), scope))
})

test('under a base path, the base-relative /production is the server too', () => {
  const sub = new URL(`${ORIGIN}/napkin/`)
  assert.ok(serverOwned(at('/napkin/production/p/x'), sub))
  assert.ok(shellRoute(at('/napkin/view'), sub))
})

test('the built service worker carries the routes inlined', { skip: !existsSync('dist/sw.js') && 'no build yet' }, () => {
  const sw = readFileSync('dist/sw.js', 'utf8')
  assert.match(sw, /function serverOwned\(url, scope\)/)
  assert.match(sw, /'production\/'/)
  assert.doesNotMatch(sw, /__NAPKIN_[A-Z]+__/)
  assert.doesNotMatch(sw, /^export /m)
})

test('next: only a path on this origin under /production', () => {
  for (const ok of ['/production', '/production/', '/production/p/x?y', '/production/p/abc/script/s1?shot=2#n'])
    assert.equal(safeNext(ok), ok, ok)
  for (const bad of [
    null, '', '//evil.com', '//evil.com/production/', 'https://x', 'https://x/production/', '/\\evil',
    '/production\\..\\api', '/api/session', '/api/production/', 'javascript:alert(1)', '/productions',
    '/production%2f..%2fapi', '/production/%2F', '/production/%5c', '/production/../api', '/production/ x',
    '/view?next=/production',
  ])
    assert.equal(safeNext(bad), null, String(bad))
})

test('next is read from the query, decoded once', () => {
  assert.equal(nextFrom(`?next=${encodeURIComponent('/production/p/x?y=1')}`), '/production/p/x?y=1')
  assert.equal(nextFrom('?next=%2F%2Fevil.com'), null)
  assert.equal(nextFrom('?next=%252Fevil'), null)
  assert.equal(nextFrom(''), null)
})

test('after sign-in: follow a valid next, reload otherwise', () => {
  const went: string[] = []
  let reloads = 0
  afterSignIn('?next=%2Fproduction%2Fp%2Fx', p => went.push(p), () => reloads++)
  afterSignIn('?next=https%3A%2F%2Fevil.com', p => went.push(p), () => reloads++)
  afterSignIn('', p => went.push(p), () => reloads++)
  assert.deepEqual(went, ['/production/p/x'])
  assert.equal(reloads, 2)
})

test('already signed in on /?next=: straight on, only where the tool is served', () => {
  const search = '?next=%2Fproduction%2F'
  const user = { username: 'visionary@napkin', agency: 'napkin' }
  assert.equal(nextWhenSignedIn(search, { user, production: true }), '/production/')
  assert.equal(nextWhenSignedIn(search, { user, production: false }), null)
  assert.equal(nextWhenSignedIn(search, { user }), null)
  assert.equal(nextWhenSignedIn(search, { production: true }), null, 'anonymous')
  assert.equal(nextWhenSignedIn('?next=%2Fapi%2Fx', { user, production: true }), null)
  assert.equal(nextWhenSignedIn(search, null), null)
})

test('the home offers Make an ad only when the server serves the tool', () => {
  const on = renderToStaticMarkup(createElement(MakeAnAdCard, { on: true }))
  assert.match(on, /href="\/production\/"/)
  assert.match(on, /Make an ad/)
  assert.equal(renderToStaticMarkup(createElement(MakeAnAdCard, { on: false })), '')
})
