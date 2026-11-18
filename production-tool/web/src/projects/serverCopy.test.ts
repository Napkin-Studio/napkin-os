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
