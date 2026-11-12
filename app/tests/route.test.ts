// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The shell's route: four hash shapes, ASCII ids only, everything else the landing
// (features/landing-circles.clan).

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ancestry, correctRoute, formatRoute, isClientId, parseRoute, sameRoute, TOOL_IDS, up } from '../src/shell/route.ts'

const ID = 'cli_0a1b2c3d'

test('each shape parses to its level', () => {
  assert.deepEqual(parseRoute('#agency'), { level: 'agency' })
  assert.deepEqual(parseRoute('#clients'), { level: 'clients' })
  assert.deepEqual(parseRoute(`#client-${ID}`), { level: 'client', client: ID })
  assert.deepEqual(parseRoute(`#tool-${ID}-brief`), { level: 'tool', client: ID, tool: 'brief' })
})

test('every tool id round-trips, and the leading # is optional', () => {
  for (const tool of TOOL_IDS) {
    const r = { level: 'tool', client: ID, tool } as const
    assert.deepEqual(parseRoute(formatRoute(r)), r)
    assert.deepEqual(parseRoute(formatRoute(r).slice(1)), r)
  }
  for (const r of [{ level: 'agency' }, { level: 'clients' }, { level: 'client', client: ID }] as const) {
    assert.deepEqual(parseRoute(formatRoute(r)), r)
  }
})

test('anything else is the landing', () => {
  const hostile = [
    '', '#', '#nonsense', '#AGENCY', '#agency/', '#agency?x=1', '#clients-',
    '#client-', '#client-Client A', '#client-cli_0A1B2C3D', '#client-cli_0a1b2c3', '#client-cli_0a1b2c3d0',
    `#client-${ID}-brief`, `#client--${ID}`, '#tool-', `#tool-${ID}`, `#tool-${ID}-`, `#tool-${ID}-nope`,
    `#tool-${ID}-BRIEF`, '#tool-brief', '#tool-cli_0a1b2c3d-brief-extra',
    '#client-%63li_0a1b2c3d', '#client-cli_0a1b2c3d%00', '#client-<script>', '#client-../../etc',
    // non-ASCII, including look-alike letters and a name where an id belongs
    '#client-clí_0a1b2c3d', '#client-Ólafsson', '#client-カフェ', '#tool-cli_0a1b2c3d-brïef',
    '#client-cli_0a1b2c3d\n', '#client-cli_0a1b2c3d ', ' #agency', '#%23agency',
  ]
  for (const h of hostile) assert.deepEqual(parseRoute(h), { level: 'agency' }, JSON.stringify(h))
})

test('what the route formats is always ASCII, whatever it was given', () => {
  for (const h of ['#client-Ólafsson', `#client-${ID}`, '#clients', '#tool-x']) {
    assert.match(formatRoute(parseRoute(h)), /^#[\x20-\x7e]+$/)
  }
})

test('a client id is cli_ and eight lowercase hex digits, nothing else', () => {
  assert.ok(isClientId(ID))
  for (const bad of ['', 'cli_', 'cli_0a1b2c3', 'cli_0a1b2c3d0', 'cli_0g1b2c3d', 'CLI_0a1b2c3d', 'cli-0a1b2c3d', 'Client A'])
    assert.ok(!isClientId(bad), bad)
})

test('the trail is the levels above, nearest last', () => {
  assert.deepEqual(ancestry({ level: 'agency' }), [])
  assert.deepEqual(ancestry({ level: 'clients' }).map(formatRoute), ['#agency'])
  assert.deepEqual(ancestry({ level: 'client', client: ID }).map(formatRoute), ['#agency', '#clients'])
  assert.deepEqual(
    ancestry({ level: 'tool', client: ID, tool: 'deck' }).map(formatRoute),
    ['#agency', '#clients', `#client-${ID}`],
  )
  assert.ok(sameRoute(parseRoute('#clients'), { level: 'clients' }))
  assert.ok(!sameRoute(parseRoute('#clients'), { level: 'agency' }))
})

test('up is one level: tool to client to clients to agency, and the agency stays', () => {
  assert.deepEqual(up({ level: 'tool', client: ID, tool: 'ads' }), { level: 'client', client: ID })
  assert.deepEqual(up({ level: 'client', client: ID }), { level: 'clients' })
  assert.deepEqual(up({ level: 'clients' }), { level: 'agency' })
  assert.deepEqual(up({ level: 'agency' }), { level: 'agency' })
  // The same steps as the trail's last parent.
  for (const r of [{ level: 'clients' }, { level: 'client', client: ID }, { level: 'tool', client: ID, tool: 'deck' }] as const) {
    assert.ok(sameRoute(up(r), ancestry(r).at(-1)!))
  }
})

test('a route is corrected to what is here: an unknown client is #clients, a Soon tool is its client', () => {
  const here = { client: (id: string) => id === ID, tool: (t: string) => t !== 'idea' && t !== 'prod' }
  const table: [Parameters<typeof correctRoute>[0], string][] = [
    [{ level: 'agency' }, '#agency'],
    [{ level: 'clients' }, '#clients'],
    [{ level: 'client', client: ID }, `#client-${ID}`],
    [{ level: 'client', client: 'cli_00000000' }, '#clients'],
    [{ level: 'tool', client: ID, tool: 'brief' }, `#tool-${ID}-brief`],
    [{ level: 'tool', client: ID, tool: 'idea' }, `#client-${ID}`],
    [{ level: 'tool', client: ID, tool: 'prod' }, `#client-${ID}`],
    [{ level: 'tool', client: 'cli_00000000', tool: 'brief' }, '#clients'],
    [{ level: 'tool', client: 'cli_00000000', tool: 'idea' }, '#clients'],
  ]
  for (const [r, want] of table) assert.equal(formatRoute(correctRoute(r, here)), want, formatRoute(r))
})

// features/job-page.clan: #job-<number>, J and three to six digits, nothing a hash could use to point elsewhere.
test('a job hash parses, round-trips, and has the agency above it', () => {
  for (const n of ['J001', 'J042', 'J1234', 'J999999']) {
    assert.deepEqual(parseRoute(`#job-${n}`), { level: 'job', number: n })
    assert.equal(formatRoute({ level: 'job', number: n }), `#job-${n}`)
  }
  const r = parseRoute('#job-J001')
  assert.deepEqual(ancestry(r), [{ level: 'agency' }])
  assert.deepEqual(up(r), { level: 'agency' })
  assert.ok(sameRoute(r, { level: 'job', number: 'J001' }))
  assert.deepEqual(correctRoute(r, { client: () => false, tool: () => false }), r)
})

test('a malformed job hash is the landing', () => {
  const hostile = [
    '#job-', '#job-J', '#job-J1', '#job-J12', '#job-J1234567', '#job-j001', '#job-001', '#job-JOO1', '#job-J001 ', '#job- J001',
    '#job-J001/', '#job-J001?x=1', '#job-../x', '#job-J001/../x', '#job-J%30001', '#job-J001%00', '#job-J001\n', '#job-<script>',
    '#job-J١٢٣', '#job-J０１２', '#job--J001', '#jobs-J001', '#job-J001-brief',
  ]
  for (const h of hostile) assert.deepEqual(parseRoute(h), { level: 'agency' }, JSON.stringify(h))
})
