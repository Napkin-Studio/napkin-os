// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// A locked document keeps the page its client approved, and says quietly when
// a newer version of its app is installed (features/doc-app-upgrade.clan).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { AppUpdate, DecisionBlock, DecisionsView } from '../src/host/types.ts'
import { AppUpdateNotice } from '../src/shell/AppUpdateNotice.tsx'
import { appUpdateWords } from '../src/shell/appUpdateWords.ts'
import { didWhat } from '../src/shell/decisions/words.ts'

const ref = (version: string) => ({ app_id: 'ie.napkin.campaign-research', version, digest: `sha256:${version}`, name: 'Research Tool' })
const update: AppUpdate = { available: true, name: 'Research Tool', from: ref('0.5.1'), to: ref('0.6.0') }
const render = (props: Partial<Parameters<typeof AppUpdateNotice>[0]>) =>
  renderToStaticMarkup(createElement(AppUpdateNotice, { update, locked: true, noun: 'report', busy: false, onUpdate: () => {}, ...props }))

test('a locked document is told a newer app is installed, with Update', () => {
  const html = render({})
  assert.match(html, /A newer Research Tool is available/)
  assert.match(html, /0\.6\.0, you have 0\.5\.1/)
  assert.match(html, /<button[^>]*>Update<\/button>/)
  assert.match(html, /role="status"/)
})

test('nothing is said on an unlocked document, or when nothing is newer', () => {
  assert.equal(render({ locked: false }), '')
  assert.equal(render({ update: null }), '')
  assert.equal(appUpdateWords(undefined, true, 'report'), null)
})

test('while it updates it says so; data that does not fit offers nothing', () => {
  assert.match(render({ busy: true }), /disabled=""[^>]*>Updating…</)
  const html = render({ update: { ...update, blocked: ['objectives.commercial'] } })
  assert.match(html, /This Research Tool can’t take this report’s data as it stands: objectives\.commercial/)
  assert.doesNotMatch(html, /<button/)
})

test('the Decisions drawer reads an update by its versions', () => {
  const view: DecisionsView = { document_id: 'd', version: 'v', attention: [], cites: {}, lock: { can_lock: true, blockers: 0 }, decisions: [] }
  const block: DecisionBlock = {
    decision: { kind: 'app_update', agent: 'human:shrey', action: 'update_app', rationale: 'Brought the locked version up to Research Tool 0.6.0; the content is unchanged.',
      timestamp: '2026-11-09T10:00:00Z', from: ref('0.5.1'), to: ref('0.6.0'), trigger: 'update' },
    who: { kind: 'person', id: 'shrey', name: 'Shrey' }, targets: [], attention: [], superseded: false,
  }
  assert.equal(didWhat(block, view), 'updated Research Tool 0.5.1 → 0.6.0')
  // Caught up on save, by the host: the same words.
  const saved = { ...block, decision: { ...block.decision, agent: 'napkin-host', trigger: 'save' }, who: { kind: 'agent' as const, id: 'napkin-host', name: 'napkin-host' } }
  assert.equal(didWhat(saved, view), 'updated Research Tool 0.5.1 → 0.6.0')
})
