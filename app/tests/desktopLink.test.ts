// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The security review of align-booth's client link stage: the desktop app runs its frames from a url
// (host/tauri.ts, frameLoad 'url') but has no server behind them, so Share > Send the client copy must not open
// the shell's client-link form there: its routes (/s/<token>/client-links) do not exist, and the form would
// fail with a raw fetch error. The form is offered only where `hasServer` is true.

import './desktopSetup.ts'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { host, onDevice, isDesktop, hasServer } from '../src/host/index.ts'
import { listClientLinksOf } from '../src/host/http.ts'
import { clientLinkDoc } from '../src/shell/gate/words.ts'
import { clientLinkRoutes } from '../src/shell/gate/linkRoutes.ts'

test('on the desktop app Send the client copy does not open the server form', async () => {
  assert.equal(isDesktop, true)
  assert.equal(hasServer, false)
  assert.equal(host.frameLoad === 'url' && !onDevice(), true, 'the old test was true on the desktop: the frame loads from a url')
  const doc = clientLinkDoc({ docPath: '/Users/me/brief.clan', appId: 'ie.napkin.brief-maker', isTemplate: false, clientOn: false, locked: true, server: clientLinkRoutes() })
  const asked: string[] = []
  globalThis.fetch = (async (u: string | URL) => { asked.push(String(u)); throw new TypeError('Load failed') }) as typeof fetch
  if (doc) await listClientLinksOf(doc).catch(() => {})
  assert.equal(doc, null, `the form opens for ${doc} with no server behind it`)
  assert.deepEqual(asked, [], 'nothing asked a server that is not there')
})

test('AppHost asks clientLinkRoutes(), which needs hasServer', () => {
  const app = readFileSync(resolve(process.cwd(), 'src/shell/AppHost.tsx'), 'utf8')
  assert.match(app, /server: clientLinkRoutes\(\)/)
  assert.doesNotMatch(app, /server: host\.frameLoad === 'url' && !onDevice\(\)/)
  assert.match(readFileSync(resolve(process.cwd(), 'src/shell/gate/linkRoutes.ts'), 'utf8'), /hasServer && host\.frameLoad === 'url' && !onDevice\(\)/)
})
