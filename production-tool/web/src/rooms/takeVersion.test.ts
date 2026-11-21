// One version number per take everywhere (UAT round 3, F15 leftover): the Bin said "Box 1 · v1 · New take", the
// agent's note "Made take v2 for shot 1" and the zip "shot1-clip-v2" for the same take, and the Use this take sheet
// said "Now: v1 / New: v1" for takes of different boxes. And a box added before the end card (R3-F13): the end card
// stays last and is never called by the number the new box takes; a box whose frame Make draws first says so.

import { describe, expect, it } from 'vitest'
import type { Generation, ProductionDocument, Shot } from '../contracts/types'
import { systemUpdate } from '../doc/store'
import { mainVideo, nextTakeVersion, shotName, shotNumber, takeNumber, takeVersion } from '../model/selectors'
import { addShots, id, job, MAYA, modelStore, SHA } from '../test/model'
import { boxHow } from './joinCut'
import { boxKeyOf, genTitle, roomGens, takeName, type Box } from './model'
import { addBox } from './newBox'

function gen(d: ProductionDocument, shots: Shot[], sha: string, at: string, extra: Partial<Generation> = {}): Generation {
  const j = job(d, 'clip', [], sha)
  d.jobs[j.id] = j
  const g: Generation = {
    id: id('gen'), v: 1, field_v: {}, kind: shots.length > 1 ? 'together' : 'clip', shot_ids: shots.map((s) => s.id),
    asset: sha, duration_s: 4, state: 'ready', job_id: j.id, provider: 'mock', crew: 'wren', mock: true, created_at: at, by: `human:${MAYA.id}`,
    ...extra,
  }
  d.generations[g.id] = g
  d.assets[sha] ??= { sha256: sha, kind: 'video', mime: 'video/mp4', origin: 'generated', locations: [], duration_s: 4 }
  return g
}

/** The UAT's order: shots 1+2 made together (Box 1–2 v1), then shot 1 on its own twice, then shot 2 on its own. */
async function film() {
  const store = modelStore()
  await store.create(MAYA, 'Quietboil')
  let out!: { shots: Shot[]; videoId: string; joined: Generation; one: Generation; oneAgain: Generation; two: Generation }
  await systemUpdate(store, (d) => {
    const shots = addShots(d, 2, { duration_s: 2 })
    const videoId = mainVideo(d)!.id
    const runId = id('run')
    d.videos[videoId].runs = { [runId]: { shot_ids: shots.map((s) => s.id), mode: 'take', model: 'mock', state: 'done', planned_by: 'crew' } }
    const joined = gen(d, shots, SHA('a'), '2026-11-21T01:00:00Z', { box_id: runId, segments: [{ shot_id: shots[0].id, in_s: 0, out_s: 2, by: 'detected' }, { shot_id: shots[1].id, in_s: 2, out_s: 4, by: 'detected' }] })
    const one = gen(d, [shots[0]], SHA('b'), '2026-11-21T01:05:00Z')
    const oneAgain = gen(d, [shots[0]], SHA('c'), '2026-11-21T01:10:00Z')
    const two = gen(d, [shots[1]], SHA('d'), '2026-11-21T01:06:00Z')
    out = { shots, videoId, joined, one, oneAgain, two }
  }, 'sync')
  await store.flush()
  if (store.trouble) throw new Error(`the fixture was refused: ${store.trouble}`)
  const boxes: Box[] = out.shots.map((s, i) => ({ key: boxKeyOf([s.id]), n: i + 1, shotIds: [s.id], together: false, endCard: false, lengthS: 2 }))
  return { store, boxes, ...out }
}

describe('one version number per take (UAT round 3, F15)', () => {
  it('the Bin, the notes, History and the zip read the same number: v1…vn among the takes made of the same shots', async () => {
    const { store, boxes, videoId, joined, one, oneAgain, two, shots } = await film()
    const d = store.get()
    const bin = new Map(roomGens(d, { jobs: {} }, videoId, boxes).map((g) => [g.id, g.version]))
    for (const g of [joined, one, oneAgain, two]) expect(takeVersion(d, g.id)).toBe(bin.get(g.id))
    expect([joined, one, oneAgain, two].map((g) => takeVersion(d, g.id))).toEqual([1, 1, 2, 1])
    // History's "clip v… of shot 1" (takeNumber): the same number, not its place among every take showing shot 1.
    expect(takeNumber(d, one.id, shots[0].id)).toBe(1)
    expect(takeNumber(d, oneAgain.id, shots[0].id)).toBe(2)
    expect(takeNumber(d, two.id, shots[0].id)).toBe(0)
    // The next landing's note: shot 1's next take is its v3, the joined box's next is its v2.
    expect(nextTakeVersion(d, { shot_ids: [shots[0].id] })).toBe(3)
    expect(nextTakeVersion(d, joined)).toBe(2)
    await store.close()
  })

  it('two takes that are both v1 of different boxes are named with their box on the Use this take sheet', async () => {
    const { store, boxes, videoId, joined, one } = await film()
    const gens = roomGens(store.get(), { jobs: {} }, videoId, boxes)
    const j = gens.find((g) => g.id === joined.id)!
    const o = gens.find((g) => g.id === one.id)!
    expect(takeName(j, boxes)).toBe('Box 1–2 · v1')
    expect(takeName(o, boxes)).toBe('Box 1 · v1')
    expect(genTitle(o, boxes)).toBe('Box 1 · v1 · 4 s')
    await store.close()
  })
})

describe('a box added before the end card (UAT round 3, R3-F13)', () => {
  it('goes before the end card, which stays last and is called the end card, never by a shot number', async () => {
    const store = modelStore()
    await store.create(MAYA, 'Quietboil')
    let videoId = ''
    let endId = ''
    await systemUpdate(store, (d) => {
      const shots = addShots(d, 3, { duration_s: 2 })
      shots[2].kind = 'end_card'
      endId = shots[2].id
      videoId = mainVideo(d)!.id
    }, 'sync')
    await store.flush()
    expect(shotName(store.get(), endId)).toBe('the end card')
    const made = await addBox(store, videoId)
    const d = store.get()
    expect(shotNumber(d, made)).toBe(3)
    expect(shotNumber(d, endId)).toBe(4)
    expect(shotName(d, made)).toBe('shot 3')
    expect(shotName(d, endId)).toBe('the end card')
    await store.close()
  })

  it('a box whose frame Make draws first says its clip starts on that frame, not that it is made from its words alone', async () => {
    const store = modelStore()
    await store.create(MAYA, 'Quietboil')
    let box!: Box
    await systemUpdate(store, (d) => {
      const [s] = addShots(d, 1, { duration_s: 4 })
      box = { key: boxKeyOf([s.id]), n: 1, shotIds: [s.id], together: false, endCard: false, lengthS: 4 }
    }, 'sync')
    await store.flush()
    const pics = [{ kind: 'character', label: '@maya · front' }] as never
    expect(boxHow(store.get(), box, pics)).toBe('Made on its own from its words and @maya’s pictures.')
    const first = boxHow(store.get(), box, pics, true)
    expect(first).toBe('Made on its own: its frame is drawn from its words and @maya’s pictures, then the clip starts on that frame.')
    expect(first).not.toMatch(/made on its own from its words/i)
    await store.close()
  })
})
