// @vitest-environment happy-dom
// The own engine's adapter and mount (features/engine-adapter.clan): what the
// contract test does not cover. Field-level steps, no undo stack, the snapshot
// it saves, the pointer stream with capabilities, and mount/destroy in a DOM.

import { describe, expect, it, vi } from 'vitest'
import type { PointerSample, SceneStep } from '../../core/canvasAdapter'
import { engineChoice, engineOf, engineToMount, loadEngine } from '../index'
import * as Y from 'yjs'
import { SceneStore } from '../../../../../canvas-engine/src'
import { OwnAdapter } from './adapter'
import { ownEngine } from './engine'

const rect = (a: OwnAdapter, x = 0) => a.sketchArea({ x, y: 0, w: 10, h: 10, sketchId: 's' })

describe('OwnAdapter', () => {
  it('reports only the fields that changed, and keeps no undo stack of its own', () => {
    const a = new OwnAdapter()
    const steps: SceneStep[] = []
    a.onStep((s) => steps.push(s))
    const r = rect(a)
    a.transact(() => [r], { undoable: false })
    a.transact((els) => els.map((e) => a.patch(e, { x: 5, customData: { kind: 'sketch', id: 's' } })), { undoable: true })
    expect(steps).toEqual([{ changes: [{ id: r.id, field: 'x', before: 0, after: 5 }] }])
    expect(Object.keys(a).some((k) => /undo|history|stack/i.test(k))).toBe(false)
  })

  it('opens a saved own snapshot and saves itself with the engine named', () => {
    const a = new OwnAdapter()
    const r = rect(a)
    a.transact(() => [r], { undoable: false })
    const snap = a.serialize()
    expect(snap.engine).toBe('own')
    const b = new OwnAdapter(snap)
    expect(b.elements().map((e) => e.id)).toEqual([r.id])
  })

  it('a pointer down makes it busy until the pointer is up, and listeners get every sample', () => {
    const a = new OwnAdapter()
    const got: PointerSample[] = []
    const off = a.onPointer((p) => got.push(p))
    a.pointer({ phase: 'down', x: 1, y: 2, pointerType: 'pen', pressure: 0.7, tiltX: 10, tiltY: -5 })
    expect(a.isBusy()).toBe(true)
    a.pointer({ phase: 'up', x: 1, y: 2, pointerType: 'pen', pressure: 0 })
    expect(a.isBusy()).toBe(false)
    off()
    a.pointer({ phase: 'down', x: 0, y: 0, pointerType: 'mouse', pressure: 0.5 })
    expect(got.map((p) => p.phase)).toEqual(['down', 'up'])
  })

  it('viewport changes reach onViewport and onScroll', () => {
    const a = new OwnAdapter()
    const v = vi.fn()
    const s = vi.fn()
    a.onViewport(v)
    a.onScroll(s)
    a.setViewport({ scrollX: 3, zoom: 2 })
    expect(v).toHaveBeenCalledWith({ scrollX: 3, scrollY: 0, zoom: 2 })
    expect(s).toHaveBeenCalledTimes(1)
  })
})

describe('OwnAdapter on the engine (features/engine-ink.clan)', () => {
  it('writes the tool’s elements as napkin/1 records in its Y.Doc, and a move writes only that element', () => {
    const doc = new Y.Doc()
    const a = new OwnAdapter(null, { doc })
    const r = rect(a)
    const pic = a.imageNode({ id: 'job_1', x: 50, y: 0, width: 300, height: 400, assetSha: null, customData: { kind: 'gen', id: 'job_1' }, status: 'pending', keepIds: true })
    a.transact((els) => [...els, r, pic], { undoable: true })
    expect(new SceneStore(doc).all().map((x) => [x.id, x.kind]).sort()).toEqual([[r.id, 'sketch'], ['job_1', 'image']].sort())
    let updates = 0
    doc.on('update', () => updates++)
    a.transact((els) => els.map((e) => (e.id === r.id ? a.patch(e, { x: 40 }) : e)), { undoable: true })
    expect(updates).toBe(1)
    expect(new SceneStore(doc).get(r.id)!.x).toBe(40)
  })

  it('a deleted element is a tombstone this session, and the inline Undo brings it back', () => {
    const a = new OwnAdapter()
    const r = rect(a)
    a.transact(() => [r], { undoable: true })
    a.transact((els) => els.map((e) => a.patch(e, { isDeleted: true })), { undoable: true })
    expect(a.scene.all()).toEqual([])
    expect(a.elements({ includeDeleted: true }).map((e) => [e.id, e.isDeleted])).toEqual([[r.id, true]])
    a.transact((els) => els.map((e) => a.patch(e, { isDeleted: false })), { undoable: true })
    expect(a.elements().map((e) => e.id)).toEqual([r.id])
  })

  it('opens what the doc already holds, and a saved own snapshot seeds an empty doc once', () => {
    const first = new OwnAdapter()
    first.transact(() => [rect(first)], { undoable: false })
    const doc = new Y.Doc()
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(first.doc))
    expect(new OwnAdapter(null, { doc }).elements()).toHaveLength(1)
    expect(new OwnAdapter(first.serialize()).elements()).toHaveLength(1)
  })

  it('the router’s ink intents draw a stroke; the drawing tools map onto it', () => {
    const a = new OwnAdapter()
    a.setActiveTool({ type: 'native', id: 'freedraw' })
    expect(a.router.tool).toBe('ink')
    a.setActiveTool({ type: 'native', id: 'eraser' })
    expect(a.inkTool).toBe('eraser')
    a.setActiveTool({ type: 'native', id: 'freedraw' })
    a.ink.begin(a.inkTool, { x: 0, y: 0, pressure: 0.5 }, a.inkStyle)
    a.ink.add([{ x: 20, y: 10, pressure: 0.6 }])
    a.ink.end()
    const [s] = a.elements()
    expect(s.type).toBe('freedraw')
    expect(s.points).toHaveLength(2)
    a.setActiveTool({ type: 'native', id: 'selection' })
    expect(a.router.tool).toBe('select')
  })
})

describe('the own engine mount', () => {
  it('puts a canvas in the host, hands back the adapter, and destroy takes it out', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const onChange = vi.fn()
    const adapter = await ownEngine.mount(host, { initial: null, onChange, theme: 'light' })
    expect(adapter.engine).toBe('own')
    expect(host.querySelector('canvas')).not.toBeNull()
    adapter.transact((els) => [...els, adapter.sketchArea({ x: 0, y: 0, w: 10, h: 10, sketchId: 's' })], { undoable: true })
    expect(onChange).toHaveBeenCalled()
    adapter.destroy()
    expect(host.querySelector('canvas')).toBeNull()
  })
})

describe('choosing the engine', () => {
  it('?engine= wins for one person, then the remote flag, then Excalidraw', () => {
    expect(engineChoice('', null)).toBe('excalidraw')
    expect(engineChoice('', { ownCanvas: true })).toBe('own')
    expect(engineChoice('?engine=own', { ownCanvas: false })).toBe('own')
    expect(engineChoice('?engine=excalidraw', { ownCanvas: true })).toBe('excalidraw')
    expect(engineChoice('?engine=other', null)).toBe('excalidraw')
  })

  it('remembers ?engine= in this browser, since the app’s routes drop the query', () => {
    const kv = new Map<string, string>()
    const store = { getItem: (k: string) => kv.get(k) ?? null, setItem: (k: string, v: string) => void kv.set(k, v) }
    expect(engineChoice('?engine=own', null, store)).toBe('own')
    expect(engineChoice('', { ownCanvas: false }, store)).toBe('own')
    expect(engineChoice('?engine=excalidraw', null, store)).toBe('excalidraw')
    expect(engineChoice('', { ownCanvas: true }, store)).toBe('excalidraw')
    expect(engineChoice('', { ownCanvas: true }, null)).toBe('own')
  })

  it('a saved scene opens in the engine that made it; the choice applies to an empty project', () => {
    const ex = { elements: [{ id: 'a', type: 'rectangle', x: 0, y: 0, width: 1, height: 1 }], files: {} }
    const own = { ...ex, engine: 'own' as const }
    expect(engineOf(ex)).toBe('excalidraw')
    expect(engineToMount('own', ex)).toBe('excalidraw')
    expect(engineToMount('excalidraw', own)).toBe('own')
    expect(engineToMount('own', { elements: [], files: {} })).toBe('own')
    expect(engineToMount('own', null)).toBe('own')
  })

  it('loads the own engine by dynamic import', async () => {
    expect((await loadEngine('own')).id).toBe('own')
  })
})
