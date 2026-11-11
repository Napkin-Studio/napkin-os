// The undo stack and key handling of the open brief, and the side-by-side compare
// (features/brief-versions-undo.clan).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createUndoStack, keepsItsOwnUndo, mergeDiff, undoKeyOf } from '../src/shell/versions/undoStack.ts'
import { compareParts, labelOf } from '../src/shell/versions/compare.ts'

const key = (o: Partial<{ key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }>) =>
  ({ key: 'z', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...o })

test('Cmd or Ctrl Z undoes, with Shift or Y redoes, and nothing else is the brief\'s', () => {
  assert.equal(undoKeyOf(key({ metaKey: true })), 'undo')
  assert.equal(undoKeyOf(key({ ctrlKey: true })), 'undo')
  assert.equal(undoKeyOf(key({ metaKey: true, shiftKey: true })), 'redo')
  assert.equal(undoKeyOf(key({ ctrlKey: true, key: 'y' })), 'redo')
  assert.equal(undoKeyOf(key({})), null)
  assert.equal(undoKeyOf(key({ metaKey: true, altKey: true })), null)
  assert.equal(undoKeyOf(key({ metaKey: true, key: 'c' })), null)
})

test('a field being typed in keeps its own undo', () => {
  const el = (tag: string, attrs: Record<string, string> = {}) => ({
    closest: (sel: string) => (sel.includes(tag) || Object.entries(attrs).some(([k, v]) => sel.includes(`[${k}="${v}"]`))) ? {} : null,
  })
  // keepsItsOwnUndo reads `instanceof Element`: stand Element up for the node runner.
  const g = globalThis as unknown as { Element?: unknown }
  const was = g.Element
  g.Element = class {}
  try {
    const make = (e: { closest: (s: string) => unknown }) => Object.assign(new (g.Element as new () => object)(), e) as unknown as EventTarget
    assert.equal(keepsItsOwnUndo(make(el('textarea'))), true)
    assert.equal(keepsItsOwnUndo(make(el('div', { contenteditable: 'plaintext-only' }))), true)
    assert.equal(keepsItsOwnUndo(make(el('div'))), false)
    assert.equal(keepsItsOwnUndo(null), false)
  } finally { g.Element = was }
})

test('undo writes the inverse, redo brings the words back, and a new edit clears redo', () => {
  const s = createUndoStack()
  s.push({ id: 'd1', keys: ['audience'], before: { audience: 'Old.' }, after: { audience: 'New.' } })
  assert.equal(s.canUndo(), true)
  assert.equal(s.canRedo(), false)
  const p = s.plan('undo', { audience: 'New.' })
  assert.deepEqual(p.kind === 'write' && p.patch, { audience: 'Old.' })
  s.done('undo')
  assert.equal(s.canRedo(), true)
  const r = s.plan('redo', { audience: 'Old.' })
  assert.deepEqual(r.kind === 'write' && r.patch, { audience: 'New.' })
  s.done('redo')
  s.done('undo')
  s.push({ id: 'd2', keys: ['insight'], before: { insight: null }, after: { insight: 'A line.' } })
  assert.equal(s.canRedo(), false)
  const q = s.plan('undo', { insight: 'A line.' })
  assert.deepEqual(q.kind === 'write' && q.patch, { insight: null }, 'a part that was empty is emptied')
})

test('an edit is never pushed twice', () => {
  const s = createUndoStack()
  const e = { id: 'd1', keys: ['audience'], before: { audience: 'a' }, after: { audience: 'b' } }
  s.push(e); s.push(e)
  s.done('undo')
  assert.equal(s.canUndo(), false)
})

test('someone else\'s later edit stops the undo: it says so and writes nothing', () => {
  const s = createUndoStack()
  s.push({ id: 'd1', keys: ['audience'], before: { audience: 'Old.' }, after: { audience: 'Mine.' } })
  const p = s.plan('undo', { audience: 'Theirs.' })
  assert.equal(p.kind, 'stale')
  assert.deepEqual(p.kind === 'stale' && p.keys, ['audience'])
  assert.equal(s.canUndo(), true, 'the entry stays')
})

test('an object part is diffed key by key, so an added subkey is removed', () => {
  assert.deepEqual(mergeDiff({ a: 'x', b: 'y' }, { a: 'x' }), { b: null })
  assert.equal(mergeDiff({ a: 1 }, { a: 1 }), undefined)
  const s = createUndoStack()
  s.push({ id: 'd', keys: ['objectives'], before: { objectives: { commercial: 'A' } }, after: { objectives: { commercial: 'A', brand: 'B' } } })
  const p = s.plan('undo', { objectives: { commercial: 'A', brand: 'B' } })
  assert.deepEqual(p.kind === 'write' && p.patch, { objectives: { brand: null } })
})

test('compare lists only the parts whose words differ, a list a line to an item', () => {
  const left = { audience: 'Version two audience.', measurement: ['a', 'b'], objectives: { commercial: 'Grow.' } }
  const right = { audience: 'Version three audience.', measurement: ['a', 'b'], objectives: { commercial: 'Grow.', brand: 'Known.' } }
  const d = compareParts(left, right)
  assert.deepEqual(d.map(x => x.path), ['audience', 'objectives.brand'])
  assert.equal(d[0].left, 'Version two audience.')
  assert.equal(d[1].left, '')
  assert.equal(labelOf('single_minded_proposition'), 'Single minded proposition')
  assert.deepEqual(compareParts(left, left), [])
})
