// The relay's canvas.json (features/production-tool-land.clan): an Excalidraw scene is saved there with
// the .clan; a scene on our own engine is not, since it travels in the .clan's checkpoint, so a project
// converted to the own engine keeps its Excalidraw original on the relay (the rollback).
import { describe, expect, it, vi } from 'vitest'
import type { CanvasSnapshot } from '../canvas/controller'
import type { ProductionDocument } from '../contracts/types'
import { ServerCopy } from './serverCopy'
import { memoryStorage } from './storage'

function setup() {
  const storage = memoryStorage()
  const relayCanvas = new Map<string, unknown[]>()
  const server = {
    signedIn: true,
    save: vi.fn(async () => ({ etag: 'e1', savedAt: '2026-11-16T12:00:00Z' })),
    list: vi.fn(async () => []),
    putCanvas: vi.fn(async (id: string, elements: unknown[]) => { relayCanvas.set(id, elements) }),
  }
  const index = { get: () => ({ id: 'p1', name: 'Ad' }), setServer: vi.fn(async () => {}) }
  const copy = new ServerCopy({
    id: 'p1', server: server as never, index: index as never, storage, canvasKey: 'canvas:p1',
    doc: () => ({ assets: {} }) as unknown as ProductionDocument, upload: async () => undefined,
    base: { mark: null, unsaved: false },
  })
  return { storage, server, relayCanvas, copy }
}

const EX: CanvasSnapshot = { elements: [{ id: 'a', type: 'rectangle', x: 0, y: 0, width: 1, height: 1 }], files: {} } as never
const OWN: CanvasSnapshot = { elements: [{ id: 'o', type: 'rectangle', x: 9, y: 9, width: 2, height: 2 }], files: {}, engine: 'own' } as never

describe('the canvas on the relay', () => {
  it('an Excalidraw scene goes to canvas.json with each save', async () => {
    const { storage, copy, relayCanvas } = setup()
    await storage.put('canvas:p1', EX)
    await copy.post(new Uint8Array([1]), { reason: 'interval' })
    expect(relayCanvas.get('p1')).toEqual(EX.elements)
  })

  it('converting then saving leaves canvas.json the Excalidraw original', async () => {
    const { storage, copy, relayCanvas, server } = setup()
    await storage.put('canvas:p1', EX)
    await copy.post(new Uint8Array([1]), { reason: 'interval' })
    // Opened on the own engine: the controller now keeps the own scene in this browser.
    await storage.put('canvas:p1', OWN)
    await copy.post(new Uint8Array([2]), { reason: 'interval' })
    await copy.post(new Uint8Array([3]), { reason: 'manual' })
    expect(server.save).toHaveBeenCalledTimes(3) // the .clan, with its checkpoint, still goes every time
    expect(server.putCanvas).toHaveBeenCalledTimes(1)
    expect(relayCanvas.get('p1')).toEqual(EX.elements)
  })
})

describe('saves at the same moment (UAT 2026-11-21, F1)', () => {
  it('go one after the other, each on the base the one before left; no conflict', async () => {
    const { copy, server } = setup()
    const marks = ['e1', 'e2']
    const seen: (string | undefined)[] = []
    let n = 0
    server.save.mockImplementation((async (_id: string, _b: Uint8Array, o: { ifMatch?: string }) => {
      seen.push(o.ifMatch)
      await new Promise((r) => setTimeout(r, 5))
      return { etag: marks[n++], savedAt: '2026-11-21T12:00:00Z' }
    }) as never)
    // A base is known (the project was on the relay when it opened).
    ;(copy as unknown as { base: unknown }).base = { etag: 'e0', savedAt: '2026-11-21T11:00:00Z' }
    await Promise.all([copy.post(new Uint8Array([1]), { reason: 'landing' }), copy.post(new Uint8Array([2]), { reason: 'interval' })])
    expect(seen).toEqual(['e0', 'e1'])
    expect(copy.get()).toBeNull()
  })

  it('a refusal whose newer copy is our own save is taken as the base and sent again', async () => {
    const { copy, server } = setup()
    const { SaveConflict } = await import('./server')
    const { sha256Hex } = await import('../lib/hash')
    const first = new Uint8Array([7])
    const ours = await sha256Hex(first)
    ;(copy as unknown as { base: unknown }).base = { etag: 'e0', savedAt: '2026-11-21T11:00:00Z' }
    // The first save landed but its answer was lost: the relay now holds it.
    server.save.mockImplementationOnce((async () => { throw new Error('network') }) as never)
    await copy.post(first, { reason: 'landing' }).catch(() => {})
    server.list.mockImplementation((async () => [{ id: 'p1', etag: ours, savedAt: '2026-11-21T12:00:00Z' }]) as never)
    server.save.mockImplementationOnce((async () => { throw new SaveConflict('saved elsewhere') }) as never)
    server.save.mockImplementationOnce((async (_i: string, _b: Uint8Array, o: { ifMatch?: string }) => ({ etag: `after-${o.ifMatch}`, savedAt: '2026-11-21T12:01:00Z' })) as never)
    await copy.post(new Uint8Array([8]), { reason: 'interval' })
    expect(copy.get()).toBeNull()
    expect(copy.basedOn()?.etag).toBe(`after-${ours}`)
  })
})
