// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The landing's tool-to-app table is pinned against the makers that build the
// apps, so a renamed app id cannot silently turn a live tool into "Soon".

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'

import { formatRoute, parseRoute } from '../src/shell/route.ts'
import { CLIENT_TOOL_ORDER, PRODUCTION_PATH, TOOLS, liveTools, newDocHref, sendsToBrief, startsFromBrief, toolHref } from '../src/shell/landing/tools.ts'

// `npm test` runs from app/, and the bundled test does not sit where its source does.
const examples = resolve(process.cwd(), '..', 'crates', 'clan-sdk', 'examples')
const MAKER: Record<string, string> = {
  brief: 'make_brief_maker.rs',
  research: 'make_campaign_research.rs',
  deck: 'make_deck_maker.rs',
  territories: 'make_territories.rs',
}

test('every tool with an app names an id its maker really builds', () => {
  // Ads keeps the retired Advertising Studio's id for its old documents; nothing builds it any more.
  for (const t of TOOLS.filter(t => t.appId && t.id !== 'ads')) {
    const file = MAKER[t.id]
    assert.ok(file, `no maker listed for tool ${t.id}`)
    const src = readFileSync(resolve(examples, file), 'utf8')
    assert.ok(src.includes(`"${t.appId}"`), `${t.id}: ${t.appId} is not in ${file}`)
  }
})

test('Idea and Prod have no app yet, and every other tool has one', () => {
  assert.deepEqual(TOOLS.filter(t => !t.appId).map(t => t.id), ['prod', 'idea'])
})

test('Prod opens the Production Tool at /production when the server serves it, and is Soon when not', () => {
  const installed = [{ app_id: 'ie.napkin.brief-maker' }]
  assert.deepEqual([...liveTools(installed, false)].sort(), ['brief'])
  assert.deepEqual([...liveTools(installed, true)].sort(), ['brief', 'prod'])
  assert.equal(toolHref({ id: 'prod' }), PRODUCTION_PATH)
  assert.equal(PRODUCTION_PATH, '/production/')
  for (const t of TOOLS.filter(t => t.id !== 'prod')) assert.equal(toolHref(t), null, `${t.id} opens as a page here`)
})

test('Territories is a tool: it has its app, opens as a page, and its route round-trips', () => {
  const t = TOOLS.find(x => x.id === 'territories')!
  assert.equal(t.appId, 'ie.napkin.territories')
  assert.equal(TOOLS.length, 7)
  assert.deepEqual([...liveTools([{ app_id: 'ie.napkin.territories' }], false)], ['territories'])
  assert.equal(toolHref(t), null)
  const r = { level: 'tool', client: 'cli_0a1b2c3d', tool: 'territories' } as const
  assert.equal(formatRoute(r), '#tool-cli_0a1b2c3d-territories')
  assert.deepEqual(parseRoute('#tool-cli_0a1b2c3d-territories'), r)
  assert.deepEqual(parseRoute('#tool-cli_0a1b2c3d-nothing'), { level: 'agency' })
})

test('a client lists its tools Brief, Research, Territories, Production, Deck', () => {
  assert.deepEqual(CLIENT_TOOL_ORDER, ['brief', 'research', 'territories', 'prod', 'deck'])
  assert.deepEqual(TOOLS.map(t => t.id).filter(id => (CLIENT_TOOL_ORDER as readonly string[]).includes(id)), [...CLIENT_TOOL_ORDER])
})

test('Territories with no documents goes to the Brief; with some it opens as its page; "+" always starts from a brief', () => {
  const t = TOOLS.find(x => x.id === 'territories')!
  assert.equal(sendsToBrief(t, 0), true)
  assert.equal(sendsToBrief(t, 2), false)
  assert.equal(startsFromBrief(t), true)
  for (const o of TOOLS.filter(x => x.id !== 'territories')) {
    assert.equal(sendsToBrief(o, 0), false, `${o.id} opens its own page when empty`)
    assert.equal(startsFromBrief(o), false)
  }
})

test('Prod from a client\'s dial carries the client, so the film it starts belongs to them', () => {
  assert.equal(toolHref({ id: 'prod' }, 'cl_tide well'), '/production/?client=cl_tide%20well')
  assert.equal(toolHref({ id: 'brief' }, 'cl_1'), null)
})

test('Prod\'s "+" on a client\'s page starts a film for that client in the Production Tool (UAT acceptance A40: it did nothing)', () => {
  assert.equal(newDocHref({ id: 'prod' }, 'cli_e8711bc5'), '/production/?client=cli_e8711bc5&new=1')
  assert.equal(newDocHref({ id: 'prod' }, 'cl_tide well'), '/production/?client=cl_tide%20well&new=1')
  // Every app the shell launches starts in the shell, as before.
  for (const t of TOOLS.filter(t => t.id !== 'prod')) assert.equal(newDocHref(t, 'cl_1'), null, `${t.id} starts in the shell`)
  // The LandingHome wiring: both "+" handlers go through newDocHref, never the app-only path that dropped Prod.
  const home = readFileSync(resolve(process.cwd(), 'src', 'shell', 'landing', 'LandingHome.tsx'), 'utf8')
  assert.match(home, /newDocHref\(t, clientId\)/)
  assert.doesNotMatch(home, /onNew=\{t => \{ if \(t\.appId\)/)
})
