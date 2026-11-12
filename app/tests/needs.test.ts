// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The one needs-your-call selector (decisions/needs.ts) the OS bar counts, the
// medallion lights on and the Decisions drawer lists, and the state pill's words.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { AttentionItem, DecisionsView } from '../src/host/types.ts'
import { docStateOf, isFor, looksRightOf, needKey, needsOf, splitAside } from '../src/shell/decisions/needs.ts'
import { deskCallDocs } from '../src/shell/nui/deskData.ts'
import type { LibraryItem } from '../src/host/types.ts'

const need = (code: string, address: string, blocks = true): AttentionItem =>
  ({ code, address, text: `${code} at ${address}`, blocks_lock: blocks } as AttentionItem)
const view = (attention: AttentionItem[], lock: Partial<DecisionsView['lock']> = {}): DecisionsView =>
  ({ attention, decisions: [], cites: {}, lock: { can_lock: false, blockers: 0, ...lock } } as unknown as DecisionsView)

test('needsOf: only what blocks the lock, one per place', () => {
  const v = view([need('unverified', 'a'), need('unverified', 'a'), need('flagged', 'b', false), need('rejected', 'c')])
  assert.deepEqual(needsOf(v).map(n => n.address), ['a', 'c'])
  assert.deepEqual(needsOf(null), [])
})

test('the state pill: Draft, Ready to lock, Locked, Reopened; what needs a call is counted on Decisions only', () => {
  assert.equal(docStateOf(null), null)
  assert.equal(docStateOf({ ...view([]), problem: 'unreadable' }), null)
  assert.deepEqual(docStateOf(view([])), { label: 'Draft', tone: null, locked: false })
  // One needs indicator (owner, 9 Nov 2026): the pill never repeats the count.
  assert.deepEqual(docStateOf(view([need('unverified', 'a'), need('rejected', 'c')])), { label: 'Draft', tone: null, locked: false })
  // An empty document has no blockers, so the host says can_lock: it is still a draft.
  assert.deepEqual(docStateOf(view([], { can_lock: true })), { label: 'Draft', tone: null, locked: false })
  const written = { ...view([], { can_lock: true }), decisions: [{}] } as unknown as DecisionsView
  assert.deepEqual(docStateOf(written), { label: 'Ready to lock', tone: 'ok', locked: false })
  assert.deepEqual(docStateOf(view([], { locked: true })), { label: 'Locked', tone: 'ok', locked: true })
  assert.deepEqual(docStateOf(view([], { locked: true, reopened: [{}] as never })), { label: 'Reopened', tone: 'warn', locked: false })
})

test('set aside: out of the count, still a need, and back with Bring back', () => {
  const v = view([need('unverified_finding', 'd#findings[f1]'), need('open_contest', 'd#selection.contested[c1]')])
  const all = needsOf(v)
  const none = splitAside(all, new Set())
  assert.equal(none.open.length, 2)
  assert.equal(none.aside.length, 0)
  const one = splitAside(all, new Set([needKey(all[0])]))
  assert.deepEqual(one.open.map(n => n.code), ['open_contest'])
  assert.deepEqual(one.aside.map(n => n.code), ['unverified_finding'])
  // A key whose need was settled since matches nothing.
  assert.equal(splitAside(all, new Set(['gone:x'])).open.length, 2)
})

test('Looks right only where one click is a true answer: an unchecked finding is verified', () => {
  assert.deepEqual(looksRightOf(need('unverified_finding', 'doc1#findings[f_3]')), { finding: 'f_3' })
  for (const code of ['open_contest', 'flagged_field', 'bad_verdict', 'unmerged_branch', 'client_rejected', 'client_change_asked']) {
    assert.equal(looksRightOf(need(code, 'doc1#x')), null, `${code} opens where it is settled`)
  }
  assert.equal(looksRightOf(need('unverified_finding', 'doc1')), null, 'no finding id, no verify')
})

test('desk Decisions: every call across the documents the desk has read, most calls first; the rest listed to open', () => {
  const item = (path: string, client: string | null, updated: string, needs: number, locked = false): LibraryItem => ({
    path, app_id: 'ie.napkin.brief-maker', title: path, updated_at: updated,
    client: client ? { id: client, name: client } : null, state: { needs_you: needs, locked }, run: null,
  })
  const call = (code: string, address: string) => ({ code, address, text: code, blocks_lock: true }) as never
  const facts = (calls: unknown[]) => ({ editor: null, calls, thin: [], upstreamChanged: null, locked: false, canLock: false, decisions: 1 }) as never
  const items = [
    item('a', 'Zest', '2026-11-01', 2), item('b', 'Bulmers', '2026-11-02', 1), item('c', 'Bulmers', '2026-11-05', 3),
    item('d', 'Bulmers', '2026-11-06', 0), item('e', null, '2026-11-07', 1), item('f', 'Zest', '2026-11-08', 4, true),
  ]
  const { read, unread } = deskCallDocs(items, {
    a: facts([call('unverified_finding', 'x#findings[f1]'), call('open_contest', 'x#contests[c1]')]),
    c: facts([call('unverified_finding', 'x#findings[f2]')]),
    d: facts([call('unverified_finding', 'x#findings[f3]')]),
  })
  assert.deepEqual(read.map(r => [r.item.path, r.calls.length]), [['a', 2], ['c', 1]], 'the calls themselves, most first; a document that needs nothing is left out')
  assert.deepEqual(unread.map(i => i.path), ['b', 'e'], 'not read yet: listed to open; a locked one needs nothing')
})

test('a host event is for the document it names, and no other (os-layer §8.4)', () => {
  const ev = { ok: true, source: 'middleware', path: 'doc-a' }
  assert.equal(isFor(ev, 'doc-a'), true)
  assert.equal(isFor(ev, 'doc-b'), false, 'a write to another document of the workspace is not this one\'s')
  assert.equal(isFor({ ok: true }, 'doc-a'), false, 'an event that names no document is no one\'s')
  assert.equal(isFor(null, 'doc-a'), false)
})
