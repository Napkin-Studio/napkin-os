// The scene part of the UndoCoordinator (features/engine-select.clan; ui-behaviour
// 4.5): only this person's steps, field inverses, the skip rule against a later
// change by someone else, the 200 cap, redo; and the probes that replace the
// spike's U21-U22: the engine keeps no undo stack, and undo leaves no Y history.

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { encodePoints } from '../src/model/points'
import { element } from '../src/model/records'
import { SceneStore } from '../src/model/store'
import { MAX_STEPS, SceneUndo } from '../src/undo/sceneUndo'

const rect = (id: string, x = 0) => element({ id, kind: 'shape', z: 'a0', x, w: 10, h: 10, style: { stroke: '#000' }, props: { geo: 'rect' } })

/** Maya and Sai on one scene, kept in step by hand. */
function two() {
  const a = new Y.Doc()
  const b = new Y.Doc()
  a.on('update', (u: Uint8Array, o: unknown) => o !== 'b' && Y.applyUpdate(b, u, 'a'))
  b.on('update', (u: Uint8Array, o: unknown) => o !== 'a' && Y.applyUpdate(a, u, 'b'))
  const maya = new SceneStore(a)
  const sai = new SceneStore(b)
  return { maya, sai, mayaUndo: new SceneUndo(maya), saiUndo: new SceneUndo(sai) }
}

describe('SceneUndo', () => {
  it('undoes and redoes a create, a move, a restyle and a delete, each one step', () => {
    const s = new SceneStore(new Y.Doc())
    const u = new SceneUndo(s)
    s.change((tx) => tx.put([rect('r')]))
    s.change((tx) => tx.put([{ ...tx.get('r')!, x: 50 }]))
    s.change((tx) => tx.put([{ ...tx.get('r')!, style: { stroke: '#f00' } }]))
    s.change((tx) => tx.remove(['r']))
    expect(u.depth()).toEqual({ undo: 4, redo: 0 })
    expect(u.undo()).toEqual({ applied: 1, skipped: 0 })
    expect(s.get('r')!.style.stroke).toBe('#f00')
    u.undo()
    expect(s.get('r')!.style.stroke).toBe('#000')
    u.undo()
    expect(s.get('r')!.x).toBe(0)
    u.undo()
    expect(s.get('r')).toBeUndefined()
    expect(u.undo()).toBeNull()
    for (let i = 0; i < 3; i++) u.redo()
    expect(s.get('r')).toMatchObject({ x: 50, style: { stroke: '#f00' } })
    u.redo()
    expect(s.get('r')).toBeUndefined()
  })

  it('a removed stroke comes back with its points', () => {
    const s = new SceneStore(new Y.Doc())
    const u = new SceneUndo(s)
    const pts = encodePoints([{ x: 0, y: 0, pressure: 0.5 }, { x: 5, y: 5, pressure: 0.5 }], { x: 0, y: 0 })
    s.change((tx) => {
      tx.put([element({ id: 'k', kind: 'stroke', z: 'a0', w: 5, h: 5 })])
      tx.setPoints('k', pts)
    })
    s.change((tx) => tx.remove(['k']))
    u.undo()
    expect(s.get('k')).toBeDefined()
    expect(s.points('k')).toEqual(pts)
  })

  it('undo is this person’s only: Maya’s undo never touches Sai’s step', () => {
    const { maya, sai, mayaUndo, saiUndo } = two()
    maya.change((tx) => tx.put([rect('m')]))
    sai.change((tx) => tx.put([rect('s', 100)]))
    expect(mayaUndo.depth().undo).toBe(1)
    expect(saiUndo.depth().undo).toBe(1)
    mayaUndo.undo()
    expect(maya.get('m')).toBeUndefined()
    expect(maya.get('s')).toBeDefined()
    expect(sai.get('s')).toBeDefined()
  })

  it('skips a field someone else changed after the step, and says so', () => {
    const { maya, sai, mayaUndo } = two()
    maya.change((tx) => tx.put([rect('r')]))
    maya.change((tx) => tx.put([{ ...tx.get('r')!, x: 50, style: { stroke: '#00f' } }]))
    // Sai moves it after Maya; Maya's colour stays hers.
    sai.change((tx) => tx.put([{ ...tx.get('r')!, x: 80 }]))
    expect(mayaUndo.undo()).toEqual({ applied: 1, skipped: 1 })
    expect(maya.get('r')).toMatchObject({ x: 80, style: { stroke: '#000' } })
    // Undoing Maya's create now: Sai changed it since, so it stays.
    expect(mayaUndo.undo()).toEqual({ applied: 0, skipped: 1 })
    expect(maya.get('r')).toBeDefined()
  })

  it('keeps at most 200 steps, and a new step clears redo', () => {
    const s = new SceneStore(new Y.Doc())
    const u = new SceneUndo(s)
    s.change((tx) => tx.put([rect('r')]))
    for (let i = 1; i <= MAX_STEPS + 20; i++) s.change((tx) => tx.put([{ ...tx.get('r')!, x: i }]))
    expect(u.depth().undo).toBe(MAX_STEPS)
    u.undo()
    expect(u.depth().redo).toBe(1)
    s.change((tx) => tx.put([{ ...tx.get('r')!, y: 3 }]))
    expect(u.depth().redo).toBe(0)
  })

  it('probes: undo and redo are no steps, the doc keeps no undo history, the store no stack', () => {
    const doc = new Y.Doc()
    const s = new SceneStore(doc)
    const u = new SceneUndo(s)
    const origins: unknown[] = []
    doc.on('afterTransaction', (tr: Y.Transaction) => origins.push(tr.origin))
    s.change((tx) => tx.put([rect('r')]))
    u.undo()
    u.redo()
    expect(origins).toEqual(['local', 'system', 'system'])
    expect(u.depth()).toEqual({ undo: 1, redo: 0 })
    expect(Object.keys(s).some((k) => /undo|history|stack/i.test(k))).toBe(false)
  })
})
