// @vitest-environment happy-dom
// The own engine's adapter and mount (features/engine-adapter.clan): what the
// contract test does not cover. Field-level steps, no undo stack, the snapshot
// it saves, the pointer stream with capabilities, and mount/destroy in a DOM.

import { describe, expect, it, vi } from 'vitest'
import type { PointerSample, SceneStep } from '../../core/canvasAdapter'
import { engineChoice, engineOf, engineToMount, loadEngine } from '../index'
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
