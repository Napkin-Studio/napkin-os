// The store Worker and its proxy (features/engine-store.clan), over an in-process
// MessageChannel with the real napkin-wasm: the proxy behaves as the store did,
// the checkpoint is written only at its four moments, the live store keeps the
// scene between checkpoints and compacts, a restarted Worker loses nothing, and no
// main-thread source can hold a second .clan writer.

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { InvalidDocument, LocalPatchBus, memoryPersistence, UnsupportedContract, type Persistence, type Saved } from '../../../clan-store/src'
import { element, SceneStore } from '../../../canvas-engine/src'
import { zstdCodec } from '../../../canvas-engine/src/checkpoint/zstd'
import { MAYA, v2Clan, wasm } from '../test/model'
import { StoreClient, type StoreWorker } from './client'
import { COMPACT_AT, memoryLiveLog, type LiveLog } from './liveLog'
import type { Endpoint } from './protocol'
import { StoreServer } from './server'

const CHECKPOINT = 'human/assets/canvas.ybin.zst'

/** What a browser keeps between visits: the .clan bytes and the live stores, by database name. */
function browserDisk() {
  const clans = new Map<string, Persistence & { last: Saved | null }>()
  const logs = new Map<string, ReturnType<typeof memoryLiveLog>>()
  return {
    clans,
    logs,
    persistence: (name: string | null) => {
      if (!name) return null
      let p = clans.get(name)
      if (!p) clans.set(name, (p = memoryPersistence()))
      return p
    },
    liveLog: (name: string | null): LiveLog => {
      const key = name ?? 'memory'
      let l = logs.get(key)
      if (!l) logs.set(key, (l = memoryLiveLog()))
      return l
    },
  }
}

const portEndpoint = (p: MessagePort): Endpoint => {
  p.start()
  return p as unknown as Endpoint
}

/** A store client whose Worker is a StoreServer on the other end of a MessageChannel. */
function open(disk = browserDisk(), idbName = 'napkin-production-tool-clan:p1') {
  const servers: StoreServer[] = []
  const channels: MessageChannel[] = []
  const spawn = (): StoreWorker => {
    const ch = new MessageChannel()
    channels.push(ch)
    servers.push(new StoreServer(portEndpoint(ch.port1), { persistence: disk.persistence, liveLog: disk.liveLog, codec: zstdCodec, wasm: wasm() }))
    const w = portEndpoint(ch.port2) as StoreWorker
    w.terminate = () => {
      ch.port1.close()
      ch.port2.close()
    }
    return w
  }
  const client = new StoreClient({ spawn, idbName, person: MAYA, saveDebounceMs: 0 })
  return { client, disk, servers, server: () => servers.at(-1)!, kill: () => channels.at(-1)!.port1.close() }
}

const tick = () => new Promise((r) => setTimeout(r, 0))
async function settle(client: StoreClient) {
  for (let i = 0; i < 50 && client.pendingSceneUpdates(); i++) await new Promise((r) => setTimeout(r, 5))
}

describe('the proxy is the store, from the main thread', () => {
  it('creates, writes through the bus, records, chains and exports; get() is current when a write resolves', async () => {
    const { client } = open()
    const seen: string[] = []
    client.onChange((d) => seen.push(d.project.title))
    // (seen: one entry per change the Worker posted, before each write's result)
    const d = await client.create({ person: MAYA, title: 'Rain' })
    expect(client.get()).toEqual(d)
    expect(client.documentId()).not.toBe('')
    expect(client.personClaim()).toBe('human:p_maya01')
    const bus = new LocalPatchBus(client)
    const sb = Object.values(client.get().storyboards)[0]
    const r = await bus.apply({ patches: [{ op: 'set', entity: 'storyboards', id: sb.id, path: 'title', value: 'Snow', base_version: sb.v }], why: { action: 'set storyboards title' } })
    expect(r.refused ?? []).toEqual([])
    expect(client.get().storyboards[sb.id].title).toBe('Snow')
    expect(seen.length).toBeGreaterThanOrEqual(2)
    expect(await client.record({ action: 'pin_decision', rationale: 'kept' })).toBe(true)
    const chain = await client.chain()
    expect(chain[0].action).toBe('pin_decision')
    const bytes = await client.exportClan()
    expect(Object.keys(unzipSync(bytes))).toContain('shared/data.yaml')
    client.dispose()
  })

  it('refusals cross as their own classes', async () => {
    const { client } = open()
    await client.create({ person: MAYA })
    await expect(client.patch({ project: { title: 42 } }, { action: 'set project title' })).rejects.toBeInstanceOf(InvalidDocument)
    await expect(client.open(await v2Clan())).rejects.toBeInstanceOf(UnsupportedContract)
    client.dispose()
  })

  it('reopens the saved bytes in a new Worker (load), as the store did', async () => {
    const disk = browserDisk()
    const a = open(disk)
    await a.client.create({ person: MAYA, title: 'Kept' })
    await a.client.flush()
    a.client.dispose()
    const b = open(disk)
    expect((await b.client.load())?.project.title).toBe('Kept')
    b.client.dispose()
  })

  it('mirror posts leave from the main thread with their reason', async () => {
    const { client } = open()
    await client.create({ person: MAYA })
    const posts: string[] = []
    client.startMirror(async (bytes, meta) => {
      expect(bytes.byteLength).toBeGreaterThan(1000)
      posts.push(meta.reason)
    }, { everyMs: 60_000 })
    await client.mirrorNow('accept')
    await client.mirrorNow('handoff')
    expect(posts).toEqual(['accept', 'handoff'])
    client.dispose()
  })
})

/** A main-thread scene: the engine's SceneStore over a Y.Doc the client keeps in step with the Worker. */
async function sceneOn(client: StoreClient) {
  const doc = new Y.Doc()
  const opened = await client.openScene(doc)
  return { doc, opened, store: new SceneStore(doc) }
}

describe('the scene: live store and checkpoint', () => {
  it("a close's save reaches the server when the scene changed since the last checkpoint", async () => {
    // As session.close and ModelStore.close do it: the save is asked for, not awaited, and the store
    // is disposed. The Worker disposed under the checkpoint and the save was dropped, so pictures
    // placed in the last five minutes stayed only in this browser (features/picture-storage.clan).
    const { client } = open()
    await client.create({ person: MAYA })
    const posts: string[] = []
    client.startMirror(async (_bytes, meta) => {
      await new Promise((r) => setTimeout(r, 20))
      posts.push(meta.reason)
    }, { everyMs: 60_000 })
    const { store } = await sceneOn(client)
    store.change((tx) => tx.put([element({ id: 'p', kind: 'shape', z: 'a0', w: 10, h: 10, props: { geo: 'rect' } })]))
    await settle(client)
    await client.patch({ project: { title: 'Rain' } }, { action: 'set project title' })
    void client.mirrorNow('manual').catch(() => {})
    await client.flush()
    client.dispose()
    for (let i = 0; i < 100 && !posts.length; i++) await new Promise((r) => setTimeout(r, 10))
    expect(posts).toEqual(['manual'])
  })

  it('writes the checkpoint only at mirror, accept, handoff and export, and only when the scene changed', async () => {
    const { client, server } = open()
    await client.create({ person: MAYA })
    client.startMirror(async () => {}, { everyMs: 60_000 })
    const { opened, store } = await sceneOn(client)
    expect(opened.from).toBe('none')
    // No scene yet: nothing to checkpoint.
    await client.mirrorNow('accept')
    expect(server().checkpoints).toBe(0)
    store.change((tx) => tx.put([element({ id: 'r', kind: 'shape', z: 'a0', w: 10, h: 10, props: { geo: 'rect' } })]))
    await settle(client)
    const chainBefore = (await client.chain()).length
    // A document write is not a checkpoint moment.
    await client.patch({ project: { title: 'Rain' } }, { action: 'set project title' })
    expect(server().checkpoints).toBe(0)
    await client.mirrorNow('accept')
    expect(server().checkpoints).toBe(1)
    // Unchanged since: the next mirror writes none; an export always carries the latest.
    await client.mirrorNow('handoff')
    expect(server().checkpoints).toBe(1)
    const bytes = await client.exportClan()
    expect(server().checkpoints).toBe(2)
    const files = unzipSync(bytes)
    expect([...files[CHECKPOINT].subarray(0, 4)]).toEqual([0x4e, 0x43, 0x59, 1])
    expect(Object.keys(files).filter((n) => n.includes('.extracted'))).toEqual([])
    // Checkpoints are quiet: only the title's decision was added.
    expect((await client.chain()).length).toBe(chainBefore + 1)
    client.dispose()
  })

  it('a reload restores the scene from the live store, with no checkpoint written', async () => {
    const disk = browserDisk()
    const a = open(disk)
    await a.client.create({ person: MAYA })
    const s = await sceneOn(a.client)
    s.store.change((tx) => tx.put([element({ id: 'k', kind: 'shape', z: 'a0', x: 7, props: { geo: 'ellipse' } })]))
    await settle(a.client)
    await a.client.flush()
    expect(a.server().checkpoints).toBe(0)
    a.client.dispose()
    const b = open(disk)
    await b.client.load()
    const again = await sceneOn(b.client)
    expect(again.opened.from).toBe('live')
    expect(again.store.get('k')?.x).toBe(7)
    b.client.dispose()
  })

  it('a browser with no live store opens the scene from the .clan checkpoint', async () => {
    const disk = browserDisk()
    const a = open(disk)
    await a.client.create({ person: MAYA })
    const s = await sceneOn(a.client)
    s.store.change((tx) => tx.put([element({ id: 'k', kind: 'shape', z: 'a0', y: 3, props: { geo: 'rect' } })]))
    await settle(a.client)
    const bytes = await a.client.exportClan()
    a.client.dispose()
    // Elsewhere: the same .clan, no live store.
    const b = open(browserDisk(), 'napkin-production-tool-clan:elsewhere')
    await b.client.open(bytes)
    const there = await sceneOn(b.client)
    expect(there.opened.from).toBe('checkpoint')
    expect(there.store.get('k')?.y).toBe(3)
    b.client.dispose()
  })

  it('the live store compacts every 500 updates', async () => {
    const { client, disk } = open()
    await client.create({ person: MAYA })
    const s = await sceneOn(client)
    s.store.seed([element({ id: 'm', kind: 'shape', z: 'a0', props: { geo: 'rect' } })])
    for (let i = 0; i < COMPACT_AT + 100; i++) s.store.change((tx) => tx.put([{ ...tx.get('m')!, x: i }]))
    await settle(client)
    await client.flush()
    const log = [...disk.logs.values()][0]
    expect(log.compactions).toBeGreaterThanOrEqual(1)
    expect(log.records.length).toBeLessThan(COMPACT_AT)
    client.dispose()
  })

  it('a Worker that dies loses nothing: the new one reopens from the live store and gets what it missed', async () => {
    const h = open()
    await h.client.create({ person: MAYA })
    await h.client.flush()
    const s = await sceneOn(h.client)
    s.store.change((tx) => tx.put([element({ id: 'a', kind: 'shape', z: 'a0', props: { geo: 'rect' } })]))
    await settle(h.client)
    // The Worker stops answering; two more edits go unacknowledged.
    h.kill()
    s.store.change((tx) => tx.put([element({ id: 'b', kind: 'shape', z: 'a1', props: { geo: 'rect' } })]))
    s.store.change((tx) => tx.put([{ ...tx.get('a')!, x: 99 }]))
    await tick()
    expect(h.client.pendingSceneUpdates()).toBe(2)
    await h.client.restart()
    await settle(h.client)
    expect(h.client.pendingSceneUpdates()).toBe(0)
    expect(h.client.restarts).toBe(1)
    // A third Worker, from the stores alone, sees every edit.
    const c = open(h.disk)
    await c.client.load()
    const after = await sceneOn(c.client)
    expect(after.store.get('a')?.x).toBe(99)
    expect(after.store.get('b')).toBeDefined()
    c.client.dispose()
    h.client.dispose()
  })

  it('50 checkpoints of an unchanged scene leave the .clan within 5% of the first', async () => {
    const { client } = open()
    await client.create({ person: MAYA })
    const s = await sceneOn(client)
    s.store.seed(Array.from({ length: 200 }, (_, i) => element({ id: `e${i}`, kind: 'shape', z: `a${i}`, x: i * 10, props: { geo: 'rect' } })))
    await settle(client)
    const first = (await client.exportClan()).byteLength
    let last = first
    for (let i = 0; i < 49; i++) last = (await client.exportClan()).byteLength
    expect(Math.abs(last - first) / first).toBeLessThanOrEqual(0.05)
    client.dispose()
  })
})

describe('one .clan writer', () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(join(dir, d.name)) : [join(dir, d.name)]))

  it('only src/store/ (and tests) name ClanDocumentStore or loadWasm', () => {
    const STORE = join(SRC, 'store') + sep
    const TESTS = join(SRC, 'test') + sep
    const leaks = files(SRC)
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith(STORE) && !f.startsWith(TESTS))
      .filter((f) => /\bClanDocumentStore\b|\bloadWasm\b/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f))
    expect(leaks).toEqual([])
  })
})
