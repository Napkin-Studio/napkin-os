// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The landing's tool-to-app table is pinned against the makers that build the
// apps, so a renamed app id cannot silently turn a live tool into "Soon".

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'

import { TOOLS } from '../src/shell/landing/tools.ts'

// `npm test` runs from app/, and the bundled test does not sit where its source does.
const examples = resolve(process.cwd(), '..', 'crates', 'clan-sdk', 'examples')
const MAKER: Record<string, string> = {
  brief: 'make_brief_maker.rs',
  research: 'make_campaign_research.rs',
  deck: 'make_deck_maker.rs',
  idea: 'make_idea_room.rs',
  ads: 'make_advertising_studio.rs',
  script: 'make_script_editor.rs',
  visual: 'make_visual_brief.rs',
}

test('every tool with an app names an id its maker really builds', () => {
  for (const t of TOOLS.filter(t => t.appId)) {
    const file = MAKER[t.id]
    assert.ok(file, `no maker listed for tool ${t.id}`)
    const src = readFileSync(resolve(examples, file), 'utf8')
    assert.ok(src.includes(`"${t.appId}"`), `${t.id}: ${t.appId} is not in ${file}`)
  }
})

test('Prod has no app yet, and every other tool has one', () => {
  assert.deepEqual(TOOLS.filter(t => !t.appId).map(t => t.id), ['prod'])
})

// One tool table, and one place that says what a door is (features/align-landing-look.clan): a door that opens a
// document of a client is a tool and is in TOOLS; a door that opens an agency-wide page is a page door. Every door
// in roles.rs is one or the other (or the desk itself), and none is both.
test('every door in roles.rs is a TOOLS id or a page door, none is both, and the page doors have their words', () => {
  const rs = readFileSync(resolve(process.cwd(), '..', 'crates', 'napkin-web', 'src', 'roles.rs'), 'utf8')
  const kinds = rs.slice(rs.indexOf('pub fn kind_of'), rs.indexOf('/// A person\'s roles'))
  const tool = new Map([...kinds.matchAll(/"([a-z-]+)" => Kind::Tool\("([a-z]+)"\)/g)].map(m => [m[1], m[2]]))
  const desk = [...kinds.matchAll(/"([a-z-]+)" => Kind::Desk/g)].map(m => m[1])
  assert.ok(tool.size >= 6, 'the tool doors were read')
  const doors = new Set([...rs.slice(0, rs.indexOf('#[cfg(test)]')).matchAll(/\("([a-z-]+)", "[^"]+"\)/g)].map(m => m[1]))
  const ids = new Set(TOOLS.map(t => t.id as string))
  const content = new Set([...readFileSync(resolve(process.cwd(), 'src', 'components', 'states', 'doors.ts'), 'utf8').matchAll(/\{ id: '([a-z-]+)'/g)].map(m => m[1]))
  for (const [door, id] of tool) {
    assert.ok(ids.has(id) || id === 'territories', `${door} names the tool ${id}, which TOOLS does not have`)
    assert.ok(!doors.has(id) || tool.has(id), `${id} is a tool and a page door`)
  }
  for (const d of doors) {
    // People and Audit are the admin's own pages: routes of their own (#people, #audit), with a page each
    if (tool.has(d) || desk.includes(d) || d === 'people' || d === 'audit') continue
    assert.ok(!ids.has(d), `${d} is a page door and a tool`)
    assert.ok(content.has(d), `${d} is a page door with no words in doors.ts`)
  }
})
