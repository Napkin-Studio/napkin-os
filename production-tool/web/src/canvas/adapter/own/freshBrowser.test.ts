// A project made on our own engine, opened in a fresh browser (no IndexedDB of its own, nothing
// remembered; features/production-tool-land.clan, live test 2026-11-16): it mounts the own engine and
// its scene comes from the .clan's checkpoint (human/assets/canvas.ybin.zst) through the store Worker,
// never from the relay's canvas.json, which for projects saved before 2026-11-16 holds an Excalidraw-
// shaped export of the own scene with no engine marker. Mirrors ownEngine.mount: openScene fills the
// Y.Doc first, then OwnAdapter takes `initial` only when that scene is empty.
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { memoryPersistence, type Persistence, type Saved } from '../../../../../clan-store/src'
import { element, SceneStore } from '../../../../../canvas-engine/src'
import { zstdCodec } from '../../../../../canvas-engine/src/checkpoint/zstd'
import { MAYA, wasm } from '../../../test/model'
import { StoreClient, type StoreWorker } from '../../../store/client'
import { memoryLiveLog, type LiveLog } from '../../../store/liveLog'
import type { Endpoint } from '../../../store/protocol'
import { StoreServer } from '../../../store/server'
import type { CanvasSnapshot } from '../../core/canvasAdapter'
import { converting, engineChoice, engineOf, mountPlan } from '../index'
import { OwnAdapter } from './adapter'

/** One browser profile: its .clan databases and live stores, empty when fresh. */
function profile() {
  const clans = new Map<string, Persistence & { last: Saved | null }>()
  const logs = new Map<string, ReturnType<typeof memoryLiveLog>>()
  return {
    persistence: (name: string | null) => {
      if (!name) return null
      let p = clans.get(name)
      if (!p) clans.set(name, (p = memoryPersistence()))
      return p
    },
    liveLog: (name: string | null): LiveLog => {
      let l = logs.get(name ?? 'memory')
      if (!l) logs.set(name ?? 'memory', (l = memoryLiveLog()))
      return l
    },
  }
}

function storeIn(disk: ReturnType<typeof profile>, idbName: string) {
  const spawn = (): StoreWorker => {
    const ch = new MessageChannel()
    ch.port1.start()
    ch.port2.start()
    new StoreServer(ch.port1 as unknown as Endpoint, { persistence: disk.persistence, liveLog: disk.liveLog, codec: zstdCodec, wasm: wasm() })
    const w = ch.port2 as unknown as StoreWorker
    w.terminate = () => { ch.port1.close(); ch.port2.close() }
    return w
  }
  return new StoreClient({ spawn, idbName, person: MAYA, saveDebounceMs: 0 })
}

async function settle(client: StoreClient) {
  for (let i = 0; i < 50 && client.pendingSceneUpdates(); i++) await new Promise((r) => setTimeout(r, 5))
}

describe('a fresh browser opens an own-engine project from its .clan', () => {
  it('mounts the own engine with the checkpoint scene, not the canvas.json export', async () => {
    // Made on the own engine in one browser: a shape at y 3; the .clan the relay keeps carries its checkpoint.
    const here = storeIn(profile(), 'napkin-production-tool-clan:p1')
    await here.create({ person: MAYA, title: 'Made on our engine' })
    const doc = new Y.Doc()
    await here.openScene(doc)
    new SceneStore(doc).change((tx) => tx.put([element({ id: 'k', kind: 'shape', z: 'a0', y: 3, props: { geo: 'rect' } })]))
    await settle(here)
    const clan = await here.exportClan()
    here.dispose()
    // What an old save left in the relay's canvas.json: elements only, Excalidraw-shaped, no engine marker.
    const canvasJson: CanvasSnapshot = { elements: [{ id: 'x1', type: 'rectangle', x: 500, y: 500, width: 40, height: 40 }], files: {} } as never
    expect(engineOf(canvasJson)).toBe('excalidraw')

    // A fresh profile: nothing remembered, no live store, no flag: the default engine.
    const choice = engineChoice('', null, null)
    const plan = mountPlan(choice, canvasJson)
    expect(plan.id).toBe('own')
    // CanvasMount keeps the canvas.json scene aside as the fallback's original; nothing is written to the relay.
    expect(converting(plan.id, plan.initial)).toBe(true)

    const there = storeIn(profile(), 'napkin-production-tool-clan:elsewhere')
    await there.open(clan)
    const sceneDoc = new Y.Doc()
    const opened = await there.openScene(sceneDoc)
    expect(opened.from).toBe('checkpoint')
    const adapter = new OwnAdapter(plan.initial, { doc: sceneDoc })
    const els = adapter.elements()
    expect(els.map((e) => e.id)).toEqual(['k'])
    expect(els[0].y).toBe(3)
    expect(els.some((e) => e.id === 'x1')).toBe(false) // the export was not converted over it
    there.dispose()
  })

  it('an Excalidraw project (no checkpoint) converts from canvas.json, as engine-import does', async () => {
    const s = storeIn(profile(), 'napkin-production-tool-clan:old')
    await s.create({ person: MAYA, title: 'Drawn on Excalidraw' })
    const canvasJson: CanvasSnapshot = { elements: [{ id: 'x1', type: 'rectangle', x: 10, y: 20, width: 40, height: 40 }], files: {} } as never
    const plan = mountPlan(engineChoice('', null, null), canvasJson)
    expect(plan.id).toBe('own')
    const sceneDoc = new Y.Doc()
    expect((await s.openScene(sceneDoc)).from).toBe('none')
    const els = new OwnAdapter(plan.initial, { doc: sceneDoc }).elements()
    expect(els.map((e) => [e.id, e.x, e.y])).toEqual([['x1', 10, 20]])
    s.dispose()
  })
})
