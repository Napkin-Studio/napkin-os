// The rooms' writes, every one through the real CLAN store (modelStore: napkin-wasm behind clan-store's buses),
// never the snapshot store: a refused write fails here (features/make-and-edit.clan, test plan). Assemble first
// cut, trims, fades, a dissolve, text and the end card; Use this take; a remake landing beside its parent; the Bin.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Generation, Job, ProductionDocument, Shot } from '../contracts/types'
import { systemUpdate } from '../doc/store'
import { undo } from '../doc/undo'
import { applyRemake, landRemake } from '../jobs/handlers'
import { remakeOp, remakeProblem, remakeWith } from '../jobs/remake'
import { cutOf, currentTake, mainVideo, shotsOf } from '../model/selectors'
import type { ModelStore } from '../model/store'
import { addShots, id, job, MAYA, modelStore, SHA, T } from '../test/model'
import { clipLen } from './cut'
import { appendTake, assembleFirstCut, editCut } from './editOps'
import { boxKeyOf, roomGens, type Box } from './model'
import type { RoomData } from './Rooms'
import { compileFor, readCut, readyTakes, renderPlan } from './timeline'

const BY = `human:${MAYA.id}`

function gen(d: ProductionDocument, shots: Shot[], sha: string, extra: Partial<Generation> = {}): Generation {
  const j = job(d, 'clip', [], sha)
  d.jobs[j.id] = j
  const g: Generation = {
    id: id('gen'), v: 1, field_v: {}, kind: shots.length > 1 ? 'together' : 'clip', shot_ids: shots.map((s) => s.id),
    asset: sha, duration_s: 5, state: 'ready', job_id: j.id, provider: 'mock', crew: 'wren', mock: true, created_at: T, by: BY,
    inputs: { model: 'mock', camera: Object.fromEntries(shots.map((s) => [s.id, { ...s.camera }])) }, ...extra,
  }
  d.generations[g.id] = g
  d.assets[sha] ??= { sha256: sha, kind: 'video', mime: 'video/mp4', origin: 'generated', locations: [], duration_s: g.duration_s }
  return g
}

/** A 6.5 s film: shots 1-2 made together (one take, cut at 2 s), shot 3 alone, shot 4 the end card. */
async function film() {
  const store = modelStore()
  await store.create(MAYA, 'SuperSamurai')
  let out!: { shots: Shot[]; together: Generation; lone: Generation; runId: string; videoId: string }
  await systemUpdate(store, (d) => {
    const shots = addShots(d, 4, { duration_s: 2 })
    shots[3].kind = 'end_card'
    shots[3].action = 'Clean like a samurai.'
    const videoId = mainVideo(d)!.id
    const runId = id('run')
    d.videos[videoId].runs = { [runId]: { shot_ids: [shots[0].id, shots[1].id], mode: 'take', model: 'mock', state: 'done', planned_by: 'crew' } }
    const together = gen(d, shots.slice(0, 2), SHA('a'), { box_id: runId, segments: [{ shot_id: shots[0].id, in_s: 0, out_s: 2, by: 'detected' }, { shot_id: shots[1].id, in_s: 2, out_s: 3.5, by: 'detected' }] })
    const lone = gen(d, [shots[2]], SHA('b'), { duration_s: 3 })
    out = { shots, together, lone, runId, videoId }
  }, 'sync')
  await store.flush()
  if (store.trouble) throw new Error(`the fixture was refused: ${store.trouble}`)
  return { store, ...out }
}

function data(store: ModelStore, shots: Shot[], videoId: string): RoomData {
  const d = store.get()
  const boxes: Box[] = [
    { key: boxKeyOf([shots[0].id, shots[1].id]), n: 1, shotIds: [shots[0].id, shots[1].id], together: true, endCard: false, lengthS: 4 },
    { key: boxKeyOf([shots[2].id]), n: 2, shotIds: [shots[2].id], together: false, endCard: false, lengthS: 2 },
    { key: boxKeyOf([shots[3].id]), n: 0, shotIds: [shots[3].id], together: false, endCard: true, lengthS: 2 },
  ]
  return { videoId, title: 'SuperSamurai', ratio: '16:9', targetS: 10, boxes, gens: roomGens(d, { jobs: {} }, videoId, boxes) }
}

const ok = async (store: ModelStore) => {
  await store.flush()
  expect(store.trouble).toBeNull()
}

describe('the Edit room on the real store', () => {
  it('Assemble first cut unpacks each box at its cuts, end to end, with the end card last; the plan is the render\'s', async () => {
    const { store, shots, together, lone, videoId, runId } = await film()
    await assembleFirstCut(store, data(store, shots, videoId))
    await ok(store)
    const cut = readCut(store.get(), videoId)
    expect(cut.v1.map((c) => [c.genId, c.inS, c.outS, c.startS, c.follows])).toEqual([
      [together.id, 0, 2, 0, { boxId: runId, shotId: shots[0].id }],
      [together.id, 2, 3.5, 2, { boxId: runId, shotId: shots[1].id }],
      [lone.id, 0, 3, 3.5, { shotId: shots[2].id }],
    ])
    expect(cut.endCard).toMatchObject({ headline: 'Clean like a samurai', line: 'Clean like a samurai', durS: 2 })
    const plan = compileFor(store.get(), videoId)
    expect(plan.clips.map((c) => [c.sha256, c.startS, c.inS, c.outS])).toEqual([[SHA('a'), 0, 0, 2], [SHA('a'), 2, 2, 3.5], [SHA('b'), 3.5, 0, 3]])
    expect(plan.lengthS).toBe(8.5)
    expect(plan.endCard).toMatchObject({ startS: 6.5, s: 2 })
    // The same plan goes to stitch, each file named for the relay.
    const sent = await renderPlan(plan, async (sha) => ({ sha256: sha, url: `https://cdn.test/${sha}`, mime: 'video/mp4' }))
    expect(sent.clips[0]).toEqual({ asset: { sha256: SHA('a'), url: `https://cdn.test/${SHA('a')}`, mime: 'video/mp4' }, startS: 0, inS: 0, outS: 2 })
    expect(sent).toMatchObject({ lengthS: 8.5, endCard: { line: 'Clean like a samurai', bg: '#14161B', s: 2 } })
    // The legacy reader agrees: shot 1's clip is the together take.
    expect(currentTake(store.get(), shots[0].id)?.id).toBe(together.id)
  })

  it('trims, fades, a dissolve, a text and the end card are each one undo step, and undo takes them back', async () => {
    const { store, shots, videoId } = await film()
    await assembleFirstCut(store, data(store, shots, videoId))
    await ok(store)
    const before = () => readCut(store.get(), videoId)
    const [a, b, c] = before().v1
    await editCut.trimHead(store, videoId, b, 2.2, true)
    await ok(store)
    expect(before().v1.map((x) => [x.startS, clipLen(x)])).toEqual([[0, 2], [2, 1.3], [3.3, 3]])
    await editCut.fades(store, videoId, a, { inS: 0.3 })
    await editCut.transition(store, videoId, c, { kind: 'dissolve', s: 0.5 })
    const textId = await editCut.addText(store, videoId, { words: 'Clean like a samurai.', style: 'super', startS: 4, durS: 1.5, fadeInS: 0.2, fadeOutS: 0.2 })
    await editCut.endCard(store, videoId, { headline: 'SuperSamurai', bg: '#FF4F2E' })
    await ok(store)
    const after = before()
    expect(after.v1[0].fadeInS).toBe(0.3)
    expect(after.v1[2].transition).toEqual({ kind: 'dissolve', s: 0.5 })
    expect(after.text).toEqual([{ id: textId, words: 'Clean like a samurai.', style: 'super', startS: 4, durS: 1.5, fadeInS: 0.2, fadeOutS: 0.2 }])
    expect(after.endCard).toMatchObject({ headline: 'SuperSamurai', bg: '#FF4F2E' })
    const tl = store.get().videos[videoId].timeline
    expect(tl[textId]).toEqual({ track: 'text', words: 'Clean like a samurai.', style: 'super', from_s: 4, to_s: 5.5, fade_in_s: 0.2, fade_out_s: 0.2 })
    for (let i = 0; i < 4; i++) await undo(store)
    await ok(store)
    expect(before().v1.map((x) => [x.startS, x.fadeInS, x.transition])).toEqual([[0, 0, undefined], [2, 0, undefined], [3.3, 0, undefined]])
    expect(before().text).toEqual([])
    await undo(store)
    expect(before().v1.map((x) => [x.startS, clipLen(x)])).toEqual([[0, 2], [2, 1.5], [3.5, 3]])
  })

  it('split, Delete (the gap closes) and Shift+Delete (it stays)', async () => {
    const { store, shots, videoId } = await film()
    await assembleFirstCut(store, data(store, shots, videoId))
    await ok(store)
    await editCut.split(store, videoId, readCut(store.get(), videoId).v1[2], 4.5)
    await ok(store)
    expect(readCut(store.get(), videoId).v1.map((x) => [x.startS, x.inS, x.outS])).toEqual([[0, 0, 2], [2, 2, 3.5], [3.5, 0, 1], [4.5, 1, 3]])
    await editCut.remove(store, videoId, readCut(store.get(), videoId).v1[1], false)
    await editCut.remove(store, videoId, readCut(store.get(), videoId).v1[1], true)
    await ok(store)
    expect(readCut(store.get(), videoId).v1.map((x) => [x.startS, x.inS])).toEqual([[0, 0], [3.5, 1]])
  })

  it('Use this take swaps every clip of the box into the same slots, keeping trims, fades and the join; undo restores the old take', async () => {
    const { store, shots, together, videoId } = await film()
    await assembleFirstCut(store, data(store, shots, videoId))
    const v1 = () => readCut(store.get(), videoId).v1
    await editCut.trimHead(store, videoId, v1()[1], 2.2, true)
    await editCut.fades(store, videoId, v1()[1], { outS: 0.3 })
    await editCut.transition(store, videoId, v1()[1], { kind: 'dissolve', s: 0.5 })
    await ok(store)
    // A new take of the box, its second cut a little later and shorter.
    let fresh!: Generation
    await systemUpdate(store, (d) => {
      fresh = gen(d, shots.slice(0, 2), SHA('c'), {
        kind: 'change', parent_id: together.id, box_id: together.box_id, created_at: '2026-10-13T11:00:00Z',
        delta: [{ field: 'camera.movement', shot_id: shots[1].id, from: 'static', to: 'handheld' }],
        segments: [{ shot_id: shots[0].id, in_s: 0, out_s: 2.1, by: 'detected' }, { shot_id: shots[1].id, in_s: 2.1, out_s: 3.2, by: 'detected' }],
      })
    }, 'sync')
    await ok(store)
    const room = data(store, shots, videoId)
    const oldGen = room.gens.find((g) => g.id === together.id)!
    const newGen = room.gens.find((g) => g.id === fresh.id)!
    expect(readyTakes(readCut(store.get(), videoId), room.gens)).toEqual(new Set([fresh.id])) // "New take ready"
    const before = v1()
    await editCut.swap(store, videoId, newGen, oldGen, before.filter((c) => c.genId === together.id).map((c) => c.id), 'hold')
    await ok(store)
    const after = v1()
    expect(after.map((c) => c.genId)).toEqual([fresh.id, fresh.id, before[2].genId])
    expect(after.map((c) => c.startS)).toEqual(before.map((c) => c.startS))
    expect(after.map((c) => clipLen(c))).toEqual(before.map((c) => clipLen(c)))
    expect(after[1]).toMatchObject({ inS: 2.3, outS: 3.2, holdS: 0.4, fadeOutS: 0.3, transition: { kind: 'dissolve', s: 0.5 } })
    await undo(store)
    await ok(store)
    expect(v1()).toEqual(before)
  })

  it('Add to edit puts a take\'s clips at the end of V1', async () => {
    const { store, shots, videoId, lone } = await film()
    const room = data(store, shots, videoId)
    await appendTake(store, store.get(), room, room.gens.find((g) => g.id === lone.id)!)
    await appendTake(store, store.get(), room, room.gens.find((g) => g.id === lone.id)!)
    await ok(store)
    expect(cutOf(store.get(), videoId).map((i) => [i.start_s, i.source?.generation_id])).toEqual([[0, lone.id], [3, lone.id]])
  })
})

describe('Change this… on the real store', () => {
  it('sends one remake of the parent: clip for a camera move or words, clip_patch for a moment, clip_edit for the feel', async () => {
    const { store, together, videoId, shots } = await film()
    const sent: unknown[][] = []
    const runner = { submit: async (...args: unknown[]) => { sent.push(args); return 'job_x' } }
    await remakeWith({ doc: store, runner: runner as never }, { videoId, parentId: together.id, delta: [{ field: 'camera.movement', shotId: shots[1].id, to: 'handheld' }] })
    const [op, input, parents, purpose, , , extras] = sent[0]
    expect([op, input, parents, purpose]).toEqual(['clip', {}, [together.job_id], { for: 'remake', videoId, parentId: together.id }])
    expect(extras).toEqual({ remakeWith: { parentJobId: together.job_id, parentId: together.id, delta: [{ field: 'camera.movement', shotId: shots[1].id, to: 'handheld' }] } })
    expect(remakeOp([{ field: 'moment', to: { inS: 0, outS: 2, note: 'red shirt' } }])).toBe('clip_patch')
    expect(remakeOp([{ field: 'feel', to: { words: 'dusk' } }])).toBe('clip_edit')
    expect(remakeProblem([{ field: 'feel', to: {} }, { field: 'words', to: 'x' }])).toBe('A moment or the whole feel is changed on its own.')
  })

  it('a remake lands beside its parent, with what changed, and never touches the cut', async () => {
    const { store, shots, together, videoId } = await film()
    await assembleFirstCut(store, data(store, shots, videoId))
    await ok(store)
    const cutBefore = store.get().videos[videoId].timeline
    const j = job(store.get(), 'clip', [], SHA('d'), { purpose: `remake ${together.id}`, node: { kind: 'video', id: videoId }, started_by: BY })
    await systemUpdate(store, (d) => { d.jobs[j.id] = j }, 'sync')
    const done = {
      jobId: j.id, op: 'clip', provider: 'mock', model: 'mock', kind: 'mock', outputs: [{ sha256: SHA('d'), durationS: 3.4 }],
      remake: { parentJobId: together.job_id, parentId: together.id, delta: [{ field: 'camera.movement', shotId: shots[1].id, from: 'static', to: 'handheld' }] },
    } as unknown as Job
    await landRemake(store, done, { for: 'remake', videoId, parentId: together.id })
    await ok(store)
    const d = store.get()
    const made = Object.values(d.generations).find((g) => g.job_id === j.id)!
    expect(made).toMatchObject({
      kind: 'change', parent_id: together.id, box_id: together.box_id, shot_ids: together.shot_ids, asset: SHA('d'), duration_s: 3.4, state: 'ready',
      delta: [{ field: 'camera.movement', shot_id: shots[1].id, from: 'static', to: 'handheld' }],
    })
    expect(made.segments?.map((s) => s.shot_id)).toEqual(together.shot_ids)
    expect(made.inputs?.camera?.[shots[1].id]?.movement).toBe('handheld')
    expect(d.videos[videoId].timeline).toEqual(cutBefore)
    expect(applyRemake(structuredClone(d), done, { videoId, parentId: together.id })).toBeUndefined() // landing twice does nothing
    // The Bin files it under its box, newest first, with its change label.
    const room = data(store, shots, videoId)
    expect(room.gens.filter((g) => g.boxKey === room.boxes[0].key).map((g) => [g.version, g.label])).toEqual([[2, 'Camera: handheld (shot 2)'], [1, 'First take']])
  })
})

describe('a project from before generations (the owner\'s samurai copy), moved when it opens', () => {
  const bytes = () => new Uint8Array(readFileSync(new URL('../../../clan-store/test/fixtures/samurai.clan', import.meta.url)))

  it('reads as generations and a timeline: the Bin, the cut, the plan and the old player agree', async () => {
    const store = modelStore()
    const d = await store.open(bytes())
    expect(store.trouble).toBeNull()
    const v = mainVideo(d)!
    const shots = shotsOf(d)
    const cut = readCut(d, v.id)
    expect(cut.v1.length).toBeGreaterThan(0)
    // Every clip plays a generation that is there and long enough.
    for (const c of cut.v1) {
      const g = d.generations[c.genId]
      expect(g?.state).toBe('ready')
      expect(c.outS).toBeLessThanOrEqual((g!.duration_s ?? 0) + 1e-3)
    }
    const plan = compileFor(d, v.id)
    expect(plan.missing).toEqual([])
    expect(plan.lengthS).toBeGreaterThan(0)
    // Each shot in the cut has its take; the Bin lists every generation of the film once.
    for (const c of cut.v1) if (c.follows?.shotId) expect(currentTake(d, c.follows.shotId)?.id).toBe(c.genId)
    const boxes: Box[] = shots.map((s, i) => ({ key: boxKeyOf([s.id]), n: i + 1, shotIds: [s.id], together: false, endCard: s.kind === 'end_card', lengthS: s.duration_s }))
    const gens = roomGens(d, { jobs: {} }, v.id, boxes)
    expect(new Set(gens.map((g) => g.id)).size).toBe(gens.length)
    expect(gens.every((g) => g.label.length > 0)).toBe(true)
    // An edit of the moved cut is accepted by the store.
    await editCut.fades(store, v.id, cut.v1[0], { inS: 0.2 })
    await ok(store)
  })
})
