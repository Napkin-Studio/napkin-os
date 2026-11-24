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
import { clipLen, cutLength } from './cut'
import { appendTake, assembleFirstCut, editCut } from './editOps'
import { boxKeyOf, roomGens, type Box } from './model'
import type { RoomData } from './Rooms'
import { compileFor, endCardFrom, newEndCard, readCut, readyTakes, renderPlan, writeCut } from './timeline'
import { linkInput } from '../canvas/nodes/nodes'


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
    shots[2].duration_s = 3 // its lone take is its planned length (a take longer than its shot plays the shot's, R3-F2)
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

  it('Assemble first cut over the film\'s length takes the over-run off the last clip, the end card kept whole (UAT round 4 F22)', async () => {
    const { store, shots, videoId } = await film()
    // 6.5 s of clips and a 2 s card against a 7 s target: 1.5 s over.
    await assembleFirstCut(store, { ...data(store, shots, videoId), targetS: 7 })
    await ok(store)
    const plan = compileFor(store.get(), videoId)
    expect(plan.lengthS).toBe(7)
    expect(plan.endCard).toMatchObject({ startS: 5, s: 2 })
    expect(plan.clips.map((c) => [c.startS, c.inS, c.outS])).toEqual([[0, 0, 2], [2, 2, 3.5], [3.5, 0, 1.5]])
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

describe('the end card\'s Legal line (owner 2026-11-23: its own key, from the LINKED Brief; the call to action is only that)', () => {
  const brief = (mandatories: string[]) => ({ id: id('brief'), v: 1, field_v: {}, title: 'Brief', source: { document_id: 'doc_1', app_id: 'ie.napkin.brief-maker', data_sha256: SHA('b'), taken: 1, version: 1, at: T, how: 'link' }, spine: { mandatories } }) as unknown as NonNullable<ProductionDocument['briefs']>[string]
  /** A Brief in the project; linked to the film when `linked`. */
  async function withBrief(store: ModelStore, videoId: string, mandatories: string[], linked = true) {
    const b = brief(mandatories)
    await systemUpdate(store, (d) => { d.briefs = { [b.id]: b } }, 'sync')
    if (linked) expect((await linkInput(store, store.get(), { kind: 'brief', id: b.id }, { kind: 'video', id: videoId })).ok).toBe(true)
    return b
  }

  it('the card from the storyboard\'s end card shot leads with the Brief\'s end line, never the project\'s name (UAT round 4 F34)', async () => {
    const { store, shots, videoId } = await film()
    // The end card shot only labels the card, so it would read the project's name; the Brief has the agreed line,
    // written as Brief Maker writes it (PR #306).
    await systemUpdate(store, (d) => { d.project.title = 'Copperell Refill'; d.shots[shots[3].id].action = 'End card.' }, 'sync')
    await withBrief(store, videoId, ["End line: 'Refill. Not landfill.' (word for word)", 'Legal: Recycle the glass.'])
    const card = endCardFrom(store.get(), videoId)!
    expect(card.headline).toBe('Refill. Not landfill.')
    expect(card.line).not.toBe('Refill. Not landfill.')
    // A card that already says the line (the shot quotes it: "Refill" over "Not landfill.") is left as the shot has it.
    await systemUpdate(store, (d) => { d.shots[shots[3].id].action = 'End card: "Refill. Not landfill."' }, 'sync')
    expect(endCardFrom(store.get(), videoId)).toMatchObject({ headline: 'Refill', line: 'Not landfill.' })
  })

  it('a new card starts with the linked Brief\'s legal mandatory as its legal, and the call to action stays empty', async () => {
    const { store, videoId } = await film()
    await withBrief(store, videoId, ['No apples anywhere', 'Legal: Please drink responsibly. 18+ only.'])
    expect(newEndCard(store.get(), videoId)).toMatchObject({ legal: 'Please drink responsibly. 18+ only.' })
    expect(newEndCard(store.get(), videoId).cta).toBeUndefined()
  })

  it('a new card\'s headline starts as the linked Brief\'s end line, and the person can overwrite it (UAT round 3: it was empty)', async () => {
    const { store, videoId } = await film()
    await withBrief(store, videoId, ['End line must be "Proper crunch."', 'Legal: Contains wheat.'])
    expect(newEndCard(store.get(), videoId)).toMatchObject({ headline: 'Proper crunch.', legal: 'Contains wheat.' })
    await editCut.endCard(store, videoId, { headline: 'Mine' })
    expect(readCut(store.get(), videoId).endCard?.headline).toBe('Mine')
  })

  it('with no Brief line the headline is the script\'s end line, the last thing it says', async () => {
    const { store, shots, videoId } = await film()
    await systemUpdate(store, (d) => {
      d.project.title = 'Hollow Oak'
      d.beats = { ...(d.beats ?? {}), beat_end: { id: 'beat_end', shot_id: shots[shots.length - 1].id, kind: 'vo', at_s: 0, text: 'Slow down. Warm up.' } as never }
    }, 'sync')
    const card = newEndCard(store.get(), videoId)
    expect(card.headline).toBe('Slow down. Warm up.')
    expect(card.line).toBe('Hollow Oak')
  })

  it('the card made from the storyboard\'s end card shot has it too, and it is saved in the document with the card', async () => {
    const { store, shots, videoId } = await film()
    await systemUpdate(store, (d) => { d.shots[shots[3].id].action = 'SuperSamurai end card.' }, 'sync')
    await withBrief(store, videoId, ['Terms apply. See hollowoak.example'])
    expect(endCardFrom(store.get(), videoId)).toMatchObject({ legal: 'Terms apply. See hollowoak.example' })
    await editCut.endCard(store, videoId, { cta: 'Find it' })
    expect(store.get().videos[videoId].end_card).toMatchObject({ cta: 'Find it', legal: 'Terms apply. See hollowoak.example' })
    expect(compileFor(store.get(), videoId).endCard).toMatchObject({ cta: 'Find it', legal: 'Terms apply. See hollowoak.example' })
  })

  it('the render takes the Brand board\'s logo for a card without its own (UAT round 4 F23)', async () => {
    const { store, videoId } = await film()
    await editCut.endCard(store, videoId, {})
    expect(compileFor(store.get(), videoId).endCard?.logo_sha256).toBeUndefined()
    await systemUpdate(store, (d) => {
      d.assets[SHA('l')] = { sha256: SHA('l'), kind: 'image', mime: 'image/png', origin: 'uploaded', bytes: 10, locations: [], w: 400, h: 160 } as never
      d.refs.ref_logo = { id: 'ref_logo', v: 1, field_v: {}, key: 'logo', variant: 'copperell', role: 'logo', asset: SHA('l') } as never
    }, 'sync')
    expect(compileFor(store.get(), videoId).endCard?.logo_sha256).toBe(SHA('l'))
    const sent = await renderPlan(compileFor(store.get(), videoId), async (sha) => ({ sha256: sha, url: `https://cdn.test/${sha}`, mime: 'image/png' }))
    expect(sent.endCard?.logo).toMatchObject({ sha256: SHA('l') })
    // The card's own logo, when it has one, wins.
    await systemUpdate(store, (d) => { d.videos[videoId].end_card!.logo_asset = SHA('m') }, 'sync')
    expect(compileFor(store.get(), videoId).endCard?.logo_sha256).toBe(SHA('m'))
  })

  it('a new end card makes room for itself inside the film\'s length (UAT round 4 F22)', async () => {
    const { store, videoId } = await film()
    // One take filling the 15 s, as UAT round 4 had it.
    await writeCut(store, videoId, 'seed the cut', () => ({ v1: [{ id: 'c1', genId: 'gen_x', inS: 0, outS: 15, startS: 0, speed: 1, holdS: 0, fadeInS: 0, fadeOutS: 0 }], v2: [], text: [] }))
    await editCut.endCard(store, videoId, {}, 15)
    const cut = readCut(store.get(), videoId)
    expect(cut.endCard).toBeDefined()
    expect(cutLength(cut)).toBe(15)
    expect(cut.v1[0].outS).toBe(15 - cut.endCard!.durS)
  })

  it('a Brief that is only in the project, not linked to the film, fills nothing', async () => {
    const { store, videoId } = await film()
    await withBrief(store, videoId, ['Legal: Please drink responsibly.'], false)
    expect(newEndCard(store.get(), videoId).legal).toBeUndefined()
  })

  it('the person\'s own words overwrite it and stay (saved under legal, 200 characters at most); clearing it keeps it empty', async () => {
    const { store, videoId } = await film()
    await withBrief(store, videoId, ['Legal: Please drink responsibly.'])
    await editCut.endCard(store, videoId, { headline: 'A', line: 'B' })
    expect(readCut(store.get(), videoId).endCard?.legal).toBe('Please drink responsibly.')
    await editCut.endCard(store, videoId, { legal: 'Ask a grown-up first.' })
    expect(store.get().videos[videoId].end_card?.legal).toBe('Ask a grown-up first.')
    expect(readCut(store.get(), videoId).endCard?.legal).toBe('Ask a grown-up first.')
    await editCut.endCard(store, videoId, { legal: '' })
    expect(readCut(store.get(), videoId).endCard?.legal).toBe('')
    expect(compileFor(store.get(), videoId).endCard?.legal).toBeUndefined()
  })

  it('a saved card with no legal of its own follows the Brief when it is linked later, in the Edit room and in the plan', async () => {
    const { store, videoId } = await film()
    await editCut.endCard(store, videoId, { headline: 'A', line: 'B' })
    expect(readCut(store.get(), videoId).endCard?.legal).toBeUndefined()
    await withBrief(store, videoId, ['Legal: Please recycle.'])
    expect(readCut(store.get(), videoId).endCard?.legal).toBe('Please recycle.')
    expect(compileFor(store.get(), videoId).endCard?.legal).toBe('Please recycle.')
  })

  it('with no legal ask in the Brief the card has none, and a new card is the brand name set in type', async () => {
    const { store, shots, videoId } = await film()
    await systemUpdate(store, (d) => {
      d.shots[shots[3].id].action = 'SuperSamurai end card.'
      d.project.title = 'Hollow Oak'
    }, 'sync')
    await withBrief(store, videoId, ['No apples anywhere'])
    expect(endCardFrom(store.get(), videoId)?.legal).toBeUndefined()
    expect(newEndCard(store.get(), videoId)).toMatchObject({ headline: '', line: 'Hollow Oak' })
  })

  it('the cutdowns carry it to the relay as legal, apart from the call to action', async () => {
    const { store, videoId } = await film()
    await withBrief(store, videoId, ['Legal: Please recycle.'])
    await editCut.endCard(store, videoId, { headline: 'A', line: 'B', cta: 'Find it' })
    const { clientCardOf } = await import('../campaign/filmJobs')
    const card = await clientCardOf({ relay: {} as never, doc: store as never }, { master: { kind: 'video', id: videoId } } as never)
    expect(card).toMatchObject({ cta: 'Find it', legal: 'Please recycle.' })
  })
})

describe('the end card\'s words (live test 2026-11-18: "Hearth Oats end card" as headline and line)', () => {
  it('a label of a shot takes the brand from the label and the film\'s closing VO as the line; words stay words', async () => {
    const { store, shots, videoId } = await film()
    await systemUpdate(store, (d) => {
      d.shots[shots[3].id].action = 'SuperSamurai end card.'
      const b = { id: id('beat'), v: 1, field_v: {}, shot_id: shots[2].id, rank: 'a0', at_s: 0.5, kind: 'vo' as const, text: 'SuperSamurai. Clean in one sweep.' }
      d.beats[b.id] = b
    }, 'sync')
    expect(endCardFrom(store.get(), videoId)).toMatchObject({ headline: 'SuperSamurai', line: 'Clean in one sweep.' })
    await systemUpdate(store, (d) => { d.shots[shots[3].id].action = 'Clean like a samurai. Sweep once.' }, 'sync')
    expect(endCardFrom(store.get(), videoId)).toMatchObject({ headline: 'Clean like a samurai', line: 'Sweep once.' })
  })

  it('a direction that labels the card and quotes its super shows the quoted words (UAT 2026-11-18, U5)', async () => {
    const { store, shots, videoId } = await film()
    const said = async (action: string) => {
      await systemUpdate(store, (d) => { d.shots[shots[3].id].action = action }, 'sync')
      return endCardFrom(store.get(), videoId)
    }
    // It read 'End card with the super: "Quietboil' over 'Let them sleep."'.
    expect(await said('End card with the super: "Quietboil. Let them sleep."')).toMatchObject({ headline: 'Quietboil', line: 'Let them sleep.' })
    expect(await said('End card with the super \u201cQuietboil. Let them sleep.\u201d')).toMatchObject({ headline: 'Quietboil', line: 'Let them sleep.' })
    expect(await said('End card: Quietboil. Let them sleep.')).toMatchObject({ headline: 'Quietboil', line: 'Let them sleep.' })
    // One sentence is the line, under the brand the label names.
    expect(await said('Quietboil end card \u2013 "Let them sleep."')).toMatchObject({ headline: 'Quietboil', line: 'Let them sleep.' })
  })
})

describe('the end card from a planner\'s staged shot (UAT 2026-11-24: "appears, the legal line small beneath" became the card)', () => {
  const FERNCLIFF = 'END CARD: the can centred on clean colour. Flat out good. appears, the legal line small beneath.'
  const CAFFEINE = 'Contains caffeine. Not recommended for children or pregnant women.'

  it('the headline is the words said; the stage directions are not on the card', async () => {
    const { store, shots, videoId } = await film()
    await systemUpdate(store, (d) => { d.shots[shots[3].id].action = FERNCLIFF }, 'sync')
    const card = endCardFrom(store.get(), videoId)!
    expect(card).toMatchObject({ headline: 'Flat out good.', line: 'Flat out good.' })
    expect(JSON.stringify(card)).not.toMatch(/appears|beneath|centred|legal line/)
  })

  it('the quoted words win when the direction quotes them; one without any words falls back to the project name', async () => {
    const { store, shots, videoId } = await film()
    const said = async (action: string, title = 'Flat Out Good') => {
      await systemUpdate(store, (d) => { d.shots[shots[3].id].action = action; d.project.title = title }, 'sync')
      return endCardFrom(store.get(), videoId)!
    }
    expect(await said('END CARD: the can centred on clean colour. "Flat out good." appears, the legal line small beneath.')).toMatchObject({ headline: 'Flat out good.' })
    expect(await said('END CARD: the can centred on clean colour, the legal line small beneath.', 'Ferncliff')).toMatchObject({ headline: 'Ferncliff', line: 'Ferncliff' })
    // No label: a direction after the words is dropped too.
    expect(await said('Flat out good. The can sits centred on clean colour.')).toMatchObject({ headline: 'Flat out good.' })
  })

  it('puts the linked brief\'s quoted legal line in the card\'s legal (not its call to action), only the quoted words', async () => {
    const { store, shots, videoId } = await film()
    await systemUpdate(store, (d) => {
      d.shots[shots[3].id].action = FERNCLIFF
      const b = { id: id('brief'), title: 'Brief', source: { taken: 1 }, spine: { mandatories: [`Include '${CAFFEINE}' To confirm: the wording against GB rules.`] } } as unknown as NonNullable<ProductionDocument['briefs']>[string]
      d.briefs = { [b.id]: b }
    }, 'sync')
    await linkInput(store, store.get(), { kind: 'brief', id: Object.keys(store.get().briefs!)[0] }, { kind: 'video', id: videoId })
    const card = endCardFrom(store.get(), videoId)
    expect(card).toMatchObject({ headline: 'Flat out good.', legal: CAFFEINE })
    expect(card?.cta).toBeUndefined()
  })
})
