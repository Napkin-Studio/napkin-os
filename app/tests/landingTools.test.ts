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
