// Delete and Undo on the real CLAN store: each delete changes the document as
// the spec says and writes one chain entry; each Undo puts it back exactly and
// writes one more. The canvas side (CanvasDocSync) is driven with plain
// elements, deleted and brought back the way Excalidraw's Ctrl+Z does.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClanDocumentStore } from '../../../clan-store/src'
import { CanvasDocSync, type SceneEl } from '../canvas/sync'
import { effectiveConfig } from '../capabilities'
import type { CustomData, DocJob, ProductionDocument, Shot } from '../contracts/types'
import { JobRunner } from '../jobs/runner'
import { newId } from '../lib/ulid'
import { HttpRelay } from '../relay/http'
import { makeAjv, SCHEMA } from '../test/schemas'
import { cancelText, mayStillCharge } from '../ui/cancel'
import { ClanBackedStore } from './clan'
import { planFollow } from '../jobs/follow'
import { deleteFrom, markStale, removeFrame, removeNote, removeShot, removeTake, restoreTo, shotDeleteText } from './remove'
import { emptyDocument, SnapshotStore, updateDoc } from './store'
import { initialUi, type UiState } from './ui'

const here = dirname(fileURLToPath(import.meta.url))
const wasmPath = join(here, '..', '..', '..', 'clan-store', 'src', 'wasm', 'napkin_wasm_bg.wasm')
if (!existsSync(wasmPath)) throw new Error(`no ${wasmPath}: run \`npm run clan-store\` first`)
const wasm = new Uint8Array(readFileSync(wasmPath))

const SHA = (c: string) => `sha256:${c.repeat(64)}`
const maya = { id: 'p_maya01', handle: 'maya' }
const T = '2026-10-07T10:40:00Z'
const validate = makeAjv().getSchema(SCHEMA('document'))!

function job(op: DocJob['op'], inputs: string[], out: string, state: DocJob['state'] = 'completed'): DocJob {
  return { id: newId('job'), op, state, parent_ids: [], input_hashes: inputs, outputs: state === 'completed' ? [out] : [], created_at: T }
}

function shot(order: number): Shot {
  return { id: newId('shot'), order, duration_s: 5, composition: 'medium', action: `shot ${order}`, camera_move: 'static', refs: ['hero_front'], status: 'locked' }
}

/** A participant part-way through: a named front, two shots with frames and clips, a note. */
function fixture() {
  const d = emptyDocument(maya)
  const gFront = job('generate', [SHA('a')], SHA('b'))
  const gFront2 = job('generate', [SHA('a')], SHA('c'))
  d.jobs.push(gFront, gFront2)
  d.keys.push({ key: 'hero', role: 'character' })
  d.refs.push({ id: newId('ref'), key: 'hero', variant: 'front', asset: SHA('b'), node: gFront.id, named_at: T })
  const s1 = shot(1)
  const s2 = shot(2)
  const s3 = shot(3)
  d.shots = [s1, s2, s3]
  const fj1 = job('frame', [SHA('b')], SHA('d'))
  const fj2 = job('frame', [SHA('b')], SHA('e'))
  const fj3 = job('frame', [SHA('b')], SHA('f'))
  const cj1 = job('clip', [SHA('e'), SHA('b')], SHA('1'))
  const cj2 = job('clip', [SHA('e'), SHA('b')], SHA('2'))
  d.jobs.push(fj1, fj2, fj3, cj1, cj2)
  const f1 = { id: newId('frame'), shot_id: s1.id, asset: SHA('d'), job_id: fj1.id, selected: false, kind: 'mock' as const }
  const f2 = { id: newId('frame'), shot_id: s1.id, asset: SHA('e'), job_id: fj2.id, selected: true, kind: 'mock' as const, parent: f1.id }
  const f3 = { id: newId('frame'), shot_id: s2.id, asset: SHA('f'), job_id: fj3.id, selected: true, kind: 'mock' as const }
  d.frames = [f1, f2, f3]
  s1.storyboard_frame = f2.asset
  s2.storyboard_frame = f3.asset
  const t1 = { id: newId('take'), shot_id: s1.id, asset: SHA('1'), job_id: cj1.id, kind: 'mock' as const, provider: 'mock' as const, selected: false }
  const t2 = { id: newId('take'), shot_id: s1.id, asset: SHA('2'), job_id: cj2.id, kind: 'mock' as const, provider: 'mock' as const, selected: true, parent: t1.id }
  d.takes = [t1, t2]
  s1.selected_take = t2.id
  const note = { id: newId('pin'), target: { kind: 'take' as const, id: t2.id }, comment: 'brighter please', at_s: 1.2, resolved: false, created_at: T }
  d.reviews = [note]
  return { d, gFront, gFront2, s1, s2, s3, f1, f2, f3, t1, t2, note }
}

async function store(doc: ProductionDocument) {
  const s = new ClanBackedStore(new ClanDocumentStore({ wasm, persistence: null }), { debounceMs: 5 })
  await s.adopt(doc)
  return s
}

/** The participant's delete/restore entries, oldest first. */
async function entries(s: ClanBackedStore) {
  return (await s.chain()).filter((e) => e.agent === 'maya' && /^(deleted|restored) /.test(e.action)).reverse()
}

const plain = (d: ProductionDocument) => JSON.parse(JSON.stringify(d))

describe('delete and undo, in the .clan', () => {
  it('a frame version: selection moves to the version it came from; Undo puts it back exactly', async () => {
    const { d, s1, f1, f2 } = fixture()
    const s = await store(d)
    const before = plain(s.get())
    const r = await deleteFrom(s, (doc) => removeFrame(doc, f2.id))
    const after = s.get()
    expect(after.frames!.map((f) => f.id)).not.toContain(f2.id)
    expect(after.frames!.find((f) => f.id === f1.id)!.selected).toBe(true)
    expect(after.shots!.find((x) => x.id === s1.id)!.storyboard_frame).toBe(f1.asset)
    expect(after.assets).toEqual(before.assets) // files kept
    expect(validate(after), JSON.stringify(validate.errors)).toBe(true)
    let e = await entries(s)
    expect(e.map((x) => x.action)).toEqual([`deleted frame ${f2.id} (shot 1, v2)`])
    expect(e[0].rationale).toContain(f2.id)

    await restoreTo(s, r)
    expect(plain(s.get())).toEqual(before)
    e = await entries(s)
    expect(e.map((x) => x.action)).toEqual([`deleted frame ${f2.id} (shot 1, v2)`, `restored frame ${f2.id} (shot 1, v2)`])
  })

  it('the last version may go: the shot has no frame, Update what follows draws it again, Undo puts it back', async () => {
    const { d, f3 } = fixture()
    const s = await store(d)
    const before = plain(s.get())
    const r = await deleteFrom(s, (doc) => removeFrame(doc, f3.id))
    const after = s.get()
    expect(after.frames!.some((f) => f.id === f3.id)).toBe(false)
    expect(after.shots!.find((x) => x.id === f3.shot_id)!.storyboard_frame).toBeUndefined()
    expect(planFollow(after).frames).toContain(f3.shot_id)
    await restoreTo(s, r)
    expect(plain(s.get())).toEqual(before)
  })

  it('a shot takes its frames, clips and their notes with it; the rest renumber; Undo restores', async () => {
    const { d, s1, s2, s3, note } = fixture()
    const s = await store(d)
    const before = plain(s.get())
    expect(shotDeleteText(1, 2, 2)).toBe('Delete shot 1 and its 2 frames and 2 clips?')
    const r = await deleteFrom(s, (doc) => removeShot(doc, s1.id))
    const after = s.get()
    expect(after.shots!.map((x) => [x.id, x.order])).toEqual([[s2.id, 1], [s3.id, 2]])
    expect(after.frames!.every((f) => f.shot_id !== s1.id)).toBe(true)
    expect(after.frames).toHaveLength(1)
    expect(after.takes).toHaveLength(0)
    expect(after.reviews!.map((x) => x.id)).not.toContain(note.id)
    expect(after.jobs).toEqual(before.jobs)
    expect(validate(after), JSON.stringify(validate.errors)).toBe(true)
    const e = await entries(s)
    expect(e).toHaveLength(1)
    expect(e[0].action).toBe('deleted shot 1')
    expect(e[0].rationale).toContain('with 2 frames and 2 clips')

    await restoreTo(s, r)
    expect(plain(s.get())).toEqual(before)
    expect((await entries(s)).map((x) => x.action)).toEqual(['deleted shot 1', 'restored shot 1'])
  })

  it('a clip version: its notes go, the shot falls back to its parent clip; the last one may go too', async () => {
    const { d, s1, t1, t2, note } = fixture()
    const s = await store(d)
    const before = plain(s.get())
    const r = await deleteFrom(s, (doc) => removeTake(doc, t2.id))
    const after = s.get()
    expect(after.takes!.map((t) => t.id)).toEqual([t1.id])
    expect(after.takes![0].selected).toBe(true)
    expect(after.shots!.find((x) => x.id === s1.id)!.selected_take).toBe(t1.id)
    expect(after.reviews!.find((x) => x.id === note.id)).toBeUndefined()
    const last = await deleteFrom(s, (doc) => removeTake(doc, t1.id)) // the last clip may go too
    expect(s.get().takes).toEqual([])
    expect(s.get().shots!.find((x) => x.id === s1.id)!.selected_take).toBeUndefined()
    await restoreTo(s, last)
    await restoreTo(s, r)
    expect(plain(s.get())).toEqual(before)
    expect((await entries(s)).map((x) => x.action)).toEqual([
      `deleted clip ${t2.id} (shot 1, v2)`, `deleted clip ${t1.id} (shot 1, v1)`, `restored clip ${t1.id} (shot 1, v1)`, `restored clip ${t2.id} (shot 1, v2)`])
  })

  it('a note (and with it, its timeline marker)', async () => {
    const { d, note } = fixture()
    const s = await store(d)
    const before = plain(s.get())
    const r = await deleteFrom(s, (doc) => removeNote(doc, note.id))
    expect(s.get().reviews).toEqual([])
    const e = await entries(s)
    expect(e.map((x) => x.action)).toEqual(['deleted note at 0:01.2 (shot 1)'])
    expect(e[0].rationale).toContain('"brighter please"')
    await restoreTo(s, r)
    expect(plain(s.get())).toEqual(before)
    expect(await entries(s)).toHaveLength(2)
  })
})

// ── the canvas ──

function genEl(j: DocJob, extra: Partial<Extract<CustomData, { kind: 'gen' }>> = {}): SceneEl {
  const customData: CustomData = { kind: 'gen', id: j.id, op: j.op as 'generate', parentIds: [], state: j.state, ...(j.outputs?.[0] ? { asset: j.outputs[0] } : {}), ...extra }
  return { id: j.id, type: 'image', customData }
}

const del = (els: SceneEl[], id: string, isDeleted = true) => els.map((e) => (e.id === id ? { ...e, isDeleted } : e))

function canvas(s: ClanBackedStore) {
  const cancelled: string[] = []
  const sync = new CanvasDocSync({ doc: s, cancel: (id) => cancelled.push(id) })
  return { sync, cancelled }
}

describe('canvas delete ↔ document', () => {
  it('a named image: its name stays in References, nothing else changes; Ctrl+Z restores', async () => {
    const { d, gFront, gFront2 } = fixture()
    const s = await store(d)
    const before = plain(s.get())
    const { sync } = canvas(s)
    let els = [genEl(gFront), genEl(gFront2)]
    await sync.gens(els)

    els = del(els, gFront.id)
    await sync.gens(els)
    expect(plain(s.get())).toEqual(before)
    expect(s.get().refs[0].node).toBe(gFront.id)
    let e = await entries(s)
    expect(e.map((x) => x.action)).toEqual([`deleted generated image ${gFront.id}`])
    expect(e[0].rationale).toContain('its name @hero_front stays in References')

    // Excalidraw's Ctrl+Z brings the element back.
    els = del(els, gFront.id, false)
    await sync.gens(els)
    expect(plain(s.get())).toEqual(before)
    e = await entries(s)
    expect(e.map((x) => x.action)).toEqual([`deleted generated image ${gFront.id}`, `restored generated image ${gFront.id}`])
  })

  it('an image with no name: no data changes, still one entry each way', async () => {
    const { d, gFront, gFront2 } = fixture()
    const s = await store(d)
    const before = plain(s.get())
    const { sync } = canvas(s)
    let els = [genEl(gFront), genEl(gFront2)]
    await sync.gens(els)
    els = del(els, gFront2.id)
    await sync.gens(els)
    els = del(els, gFront2.id, false)
    await sync.gens(els)
    expect(plain(s.get())).toEqual(before)
    expect((await entries(s)).map((x) => x.action)).toEqual([`deleted generated image ${gFront2.id}`, `restored generated image ${gFront2.id}`])
  })

  it('something still generating is cancelled when its image is deleted; a retry is not a delete', async () => {
    const d = emptyDocument(maya)
    const running = job('generate', [SHA('a')], SHA('b'), 'submitted')
    const failed = job('generate', [SHA('a')], SHA('c'), 'failed')
    d.jobs.push(running, failed)
    const s = await store(d)
    const { sync, cancelled } = canvas(s)
    let els = [genEl(running), genEl(failed)]
    await sync.gens(els)
    sync.moved.add(failed.id)
    els = del(del(els, running.id), failed.id)
    await sync.gens(els)
    expect(cancelled).toEqual([running.id])
    expect((await entries(s)).map((x) => x.action)).toEqual([`deleted generated image ${running.id}`])
  })

  it('a name that moves to another image marks what was made from the old one out of date, once', () => {
    const { d, f2, f3 } = fixture()
    const ref = d.refs[0]
    const added = markStale(d, ref.asset, ref.id, '@hero_front now shows another image.', T)
    // Frames 2 and 3 took the old front in; frame 1 (SHA d's job) did too.
    expect(added.map((m) => m.target.id)).toEqual(expect.arrayContaining([f2.id, f3.id]))
    expect(added.every((m) => m.caused_by.kind === 'ref' && m.caused_by.id === ref.id)).toBe(true)
    expect(markStale(d, ref.asset, ref.id, 'again', T)).toEqual([])
    expect(validate(d), JSON.stringify(validate.errors)).toBe(true)
  })
})

describe('cancel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('calls DELETE /jobs/{id}', async () => {
    const calls: { url: string; method: string }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET' })
      return new Response(JSON.stringify({
        contractVersion: '2', jobId: decodeURIComponent(String(url).split('/').pop()!), participantId: 'p_maya01', op: 'clip', quotaClass: 'video', state: 'cancelled', inputHashes: [],
        cost: { currency: 'USD', unknown: true }, kind: 'real', provider: 'heygen', model: 'avatar-iv', createdAt: T, updatedAt: T,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
    const d = emptyDocument(maya)
    const j = job('clip', [], SHA('a'), 'submitted')
    d.jobs.push(j)
    const s = await store(d)
    const runner = new JobRunner(new HttpRelay('http://relay.test'), s, new SnapshotStore<UiState>(initialUi()))
    await runner.cancel(j.id)
    expect(calls).toEqual([{ url: `http://relay.test/jobs/${j.id}`, method: 'DELETE' }])
    expect(s.get().jobs[0].state).toBe('cancelled')
  })

  it('says "may still be charged" when the provider cannot cancel (results.cancel false)', () => {
    const heygen = effectiveConfig('event', 'heygen')
    expect(heygen.routing.clip?.[0]).toBe('heygen')
    expect(mayStillCharge({ op: 'clip' }, heygen)).toMatch(/HeyGen .*may still be charged/)
    expect(cancelText({ op: 'clip', provider: 'heygen' }, heygen, true)).toMatch(/^Stop making this and remove it\? HeyGen .*may still be charged/)
    expect(mayStillCharge({ op: 'generate' }, heygen)).toBeNull()
    expect(cancelText({ op: 'generate', provider: 'runway' }, heygen)).toBe('Stop making this?')
  })
})

describe('who wrote it', () => {
  it('signing in is the new handle\'s entry, and so is what follows', async () => {
    const s = new ClanBackedStore(new ClanDocumentStore({ wasm, persistence: null }), { debounceMs: 5 })
    await s.create({ participant: { id: 'p_local', handle: 'guest' } })
    void updateDoc(s, (d) => { d.participant = maya }, 'sign in')
    void updateDoc(s, (d) => { d.shots = [shot(1), shot(2)] }, 'add shot')
    const chain = (await s.chain()).reverse().filter((e) => e.agent !== 'clan-store').map((e) => [e.agent, e.action])
    expect(chain).toEqual([['guest', 'started the document'], ['maya', 'signed in as @maya'], ['maya', 'added shot 1']])
  })
})
