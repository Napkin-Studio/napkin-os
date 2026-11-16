// A take made together whose shots were made apart since (live test 2026-11-16, finding 11): the 15 s take stayed
// filed under the new one-shot Box 1, which played all 15 s, and Boxes 2-4 said "No takes yet" although each shot
// had its window in that take. Now each box lists the take, plays its own window, assembles and adds its own shot.

import { describe, expect, it } from 'vitest'
import type { Generation, ProductionDocument, Shot } from '../contracts/types'
import { systemUpdate } from '../doc/store'
import { mainVideo } from '../model/selectors'
import { addShots, id, job, MAYA, modelStore, SHA, T } from '../test/model'
import { appendTake } from './editOps'
import { boxBeats, boxKeyOf, boxWindow, inBox, roomGens, type Box } from './model'
import type { RoomData } from './Rooms'
import { assemble, newerTake, readCut, topTake } from './timeline'

function gen(d: ProductionDocument, shots: Shot[], sha: string, extra: Partial<Generation> = {}): Generation {
  const j = job(d, 'clip', [], sha)
  d.jobs[j.id] = j
  const g: Generation = {
    id: id('gen'), v: 1, field_v: {}, kind: shots.length > 1 ? 'together' : 'clip', shot_ids: shots.map((s) => s.id),
    asset: sha, duration_s: 9, state: 'ready', job_id: j.id, provider: 'mock', crew: 'wren', mock: true, created_at: T, by: `human:${MAYA.id}`,
    ...extra,
  }
  d.generations[g.id] = g
  d.assets[sha] ??= { sha256: sha, kind: 'video', mime: 'video/mp4', origin: 'generated', locations: [], duration_s: g.duration_s }
  return g
}

/** Three 3 s shots made together in one 9 s take (cuts at 3 and 6), then made apart: three one-shot boxes. */
async function madeApart() {
  const store = modelStore()
  await store.create(MAYA, 'Rain')
  let out!: { shots: Shot[]; together: Generation; videoId: string }
  await systemUpdate(store, (d) => {
    const shots = addShots(d, 3, { duration_s: 3 })
    const videoId = mainVideo(d)!.id
    const runId = id('run')
    d.videos[videoId].runs = { [runId]: { shot_ids: shots.map((s) => s.id), mode: 'take', model: 'mock', state: 'done', planned_by: 'crew' } }
    const together = gen(d, shots, SHA('a'), {
      box_id: runId,
      segments: shots.map((s, i) => ({ shot_id: s.id, in_s: i * 3, out_s: i * 3 + 3, by: 'detected' as const })),
    })
    out = { shots, together, videoId }
  }, 'sync')
  await store.flush()
  if (store.trouble) throw new Error(`the fixture was refused: ${store.trouble}`)
  const boxes: Box[] = out.shots.map((s, i) => ({ key: boxKeyOf([s.id]), n: i + 1, shotIds: [s.id], together: false, endCard: false, lengthS: 3 }))
  return { store, boxes, ...out }
}

describe('a take made together, its shots made apart since', () => {
  it('is a take of every box it has footage for, each playing its own window', async () => {
    const { store, boxes, together, videoId } = await madeApart()
    const gens = roomGens(store.get(), { jobs: {} }, videoId, boxes)
    expect(gens).toHaveLength(1)
    const g = gens[0]
    expect(g.id).toBe(together.id)
    expect(g.boxKey).toBe(boxes[0].key)
    expect(boxes.map((b) => inBox(g, b.key))).toEqual([true, true, true])
    expect(boxes.map((b) => boxWindow(g, b))).toEqual([{ inS: 0, outS: 3 }, { inS: 3, outS: 6 }, { inS: 6, outS: 9 }])
    // A one-shot box shows no cut marks inside its window; the take's own box would show both.
    expect(boxBeats(g, boxes[1], () => 2)).toBeUndefined()
    expect(boxBeats(g, undefined, (sid) => boxes.findIndex((b) => b.shotIds[0] === sid) + 1)).toEqual([{ atS: 3, label: 'Shot 2' }, { atS: 6, label: 'Shot 3' }])
  })

  it('a box of exactly its shots plays all of it, as before', async () => {
    const { store, shots, videoId } = await madeApart()
    const box: Box = { key: boxKeyOf(shots.map((s) => s.id)), n: 1, shotIds: shots.map((s) => s.id), together: true, endCard: false, lengthS: 9 }
    const [g] = roomGens(store.get(), { jobs: {} }, videoId, [box])
    expect(g.boxKeys).toBeUndefined()
    expect(inBox(g, box.key)).toBe(true)
    expect(boxWindow(g, box)).toBeUndefined()
  })

  it('Assemble first cut takes each box\'s window of it', async () => {
    const { store, boxes, together, videoId } = await madeApart()
    const gens = roomGens(store.get(), { jobs: {} }, videoId, boxes)
    expect(boxes.map((b) => topTake(gens, b.key)?.id)).toEqual([together.id, together.id, together.id])
    let n = 0
    const cut = assemble(store.get(), videoId, boxes, gens, () => `c${++n}`)
    expect(cut.v1.map((c) => [c.genId, c.inS, c.outS, c.startS])).toEqual([[together.id, 0, 3, 0], [together.id, 3, 6, 3], [together.id, 6, 9, 6]])
  })

  it('Add to edit from Box 2 adds only shot 2\'s window', async () => {
    const { store, boxes, shots, videoId } = await madeApart()
    const gens = roomGens(store.get(), { jobs: {} }, videoId, boxes)
    const data: RoomData = { videoId, title: 'Rain', ratio: '16:9', targetS: 9, boxes, gens }
    await appendTake(store, store.get(), data, gens[0], boxes[1])
    await store.flush()
    expect(store.trouble).toBeNull()
    expect(readCut(store.get(), videoId).v1.map((c) => [c.inS, c.outS, c.follows?.shotId])).toEqual([[3, 6, shots[1].id]])
  })

  it('a newer take made apart for one shot is "New take ready" for that shot\'s clip only', async () => {
    const { store, boxes, shots, videoId } = await madeApart()
    await systemUpdate(store, (d) => { gen(d, [shots[1]], SHA('b'), { duration_s: 3, created_at: '2099-01-01T00:00:00Z' }) }, 'sync')
    await store.flush()
    const gens = roomGens(store.get(), { jobs: {} }, videoId, boxes)
    const old = gens.find((g) => g.segments.length === 3)!
    const lone = gens.find((g) => g.segments.length === 1)!
    const clip = (shotId: string) => ({ id: 'c', genId: old.id, inS: 0, outS: 3, startS: 0, speed: 1, holdS: 0, fadeInS: 0, fadeOutS: 0, follows: { shotId } })
    expect(newerTake(clip(shots[1].id), gens)?.id).toBe(lone.id)
    expect(newerTake(clip(shots[0].id), gens)).toBeUndefined()
  })
})
