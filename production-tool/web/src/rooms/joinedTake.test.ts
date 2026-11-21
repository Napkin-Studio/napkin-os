// UAT round 1, film path (features/pt-film-r1.clan): a take of shots the person joined goes into the cut in place
// of their separate clips (B2), its windows start at the cuts the take really made (B5), Assemble again asks
// before it drops edits, the box's current take is the joined one, and a gap kept apart by a line names it.

import { describe, expect, it } from 'vitest'
import type { Generation, ProductionDocument } from '../contracts/types'
import { joinBlock, takeTiming, takeWindows } from '../jobs/runs'
import type { PlanShot } from '../jobs/joins'
import { mainVideo } from '../model/selectors'
import { MAYA, snapshotDoc } from '../test/jobFixtures'
import { SHA, addShots, addTake, job } from '../test/model'
import { assembleLoses } from './editOps'
import { boxTop, type Gen } from './model'
import { placeTakeInCut, putCut, readCut } from './timeline'

function filmWithClips() {
  const d = structuredClone(snapshotDoc(MAYA).get()) as ProductionDocument
  const shots = addShots(d, 4)
  shots[0].duration_s = 3
  shots[1].duration_s = 2.5
  const takes = shots.map((s, i) => addTake(d, s, SHA(String(i + 1)), job(d, 'clip', [], SHA(String(i + 1))), { pick: true }))
  const videoId = mainVideo(d)!.id
  // The joined take of shots 1 and 2: one generation with a window each.
  const g: Generation = {
    ...takes[0], id: 'gen_joined', job_id: 'job_joined', kind: 'together', shot_ids: [shots[0].id, shots[1].id], box_id: 'run_1',
    segments: [{ shot_id: shots[0].id, in_s: 0, out_s: 3, by: 'detected' }, { shot_id: shots[1].id, in_s: 3, out_s: 5.5, by: 'detected' }],
    duration_s: 6, asset: SHA('9'),
  }
  d.generations[g.id] = g
  return { d, shots, takes, videoId, g }
}

describe('a joined take into the cut (B2)', () => {
  it("replaces exactly its shots' clips, in place, and moves the clips after by the change in length", () => {
    const { d, shots, videoId, g } = filmWithClips()
    // A person's trim on shot 3 and a text on the cut stay.
    const before = readCut(d, videoId)
    const third = before.v1.find((c) => c.follows?.shotId === shots[2].id)!
    putCut(d, videoId, { ...before, v1: before.v1.map((c) => (c.id === third.id ? { ...c, outS: c.outS - 1, fadeOutS: 0.3 } : c)), text: [{ id: 't1', words: 'Hi', style: 'title', startS: 1, durS: 2, fadeInS: 0, fadeOutS: 0 }] })
    const was = readCut(d, videoId)
    const next = placeTakeInCut(d, videoId, g.id, (() => { let n = 0; return () => `item_new${n++}` })())!
    expect(next).not.toBeNull()
    const v1 = next.v1
    expect(v1.slice(0, 2).map((c) => [c.genId, c.follows?.shotId, c.inS, c.outS, c.startS])).toEqual([
      [g.id, shots[0].id, 0, 3, 0], [g.id, shots[1].id, 3, 5.5, 3],
    ])
    // Shot 3 keeps its trim and fade and starts where the joined take ends (5.5); shot 4 follows it.
    const t3 = v1.find((c) => c.id === third.id)!
    expect(t3.outS).toBe(was.v1.find((c) => c.id === third.id)!.outS)
    expect(t3.fadeOutS).toBe(0.3)
    expect(t3.startS).toBeCloseTo(5.5)
    expect(v1).toHaveLength(4)
    expect(next.text).toEqual(was.text)
  })

  it('does nothing when the cut has none of its shots, or already plays one take of them', () => {
    const { d, videoId, g } = filmWithClips()
    const empty = structuredClone(d)
    empty.videos[videoId].timeline = {}
    expect(placeTakeInCut(empty, videoId, g.id)).toBeNull()
    const placed = placeTakeInCut(d, videoId, g.id)!
    putCut(d, videoId, placed)
    // A newer take of the same joined box is offered as New take ready, not swapped in.
    d.generations.gen_joined2 = { ...g, id: 'gen_joined2', job_id: 'job_joined2' }
    expect(placeTakeInCut(d, videoId, 'gen_joined2')).toBeNull()
  })
})

describe("a take's windows (B5)", () => {
  it('start at the cut the take really made, the tail trimmed to the shot', () => {
    // The UAT take: shots of 3 and 2.5 s made as 6 s; the cut found at 3.0 s. The window was 3.5-6.
    const { totalS, starts } = takeTiming([3, 2.5])
    const w = takeWindows([3, 2.5], starts, [{ planned_s: 3, found_s: 3 }], totalS)
    expect(w.map((x) => [x.in_s, x.out_s, x.by])).toEqual([[0, 3, 'detected'], [3, 5.5, 'detected']])
  })

  it("read the job's cuts in order, whatever the web planned, and fall back to the plan", () => {
    // The relay planned the cut at 2 s (a 4 s minimum); the web, at 1.5.
    const w = takeWindows([1.5, 1.5], [0, 1.5], [{ planned_s: 2, found_s: null }], 4)
    expect(w.map((x) => [x.in_s, x.out_s])).toEqual([[0, 2], [2.5, 4]])
  })

  it("the take's length is the model's (its minimum), not the shots' sum rounded up", () => {
    expect(takeTiming([1.5, 1.5], (s) => Math.max(4, Math.ceil(s))).totalS).toBe(4)
    expect(takeTiming([1.5, 1.5], (s) => Math.max(4, Math.ceil(s))).starts).toEqual([0, 1.5])
  })
})

describe('the rooms around a joined take', () => {
  const gen = (id: string, shotIds: string[], extra: Partial<Gen> = {}): Gen => ({
    id, kind: 'clip', boxKey: 'a,b', shotIds, version: 1, delta: [], label: '', durationS: 3, segments: [], state: 'ready', ...extra,
  })

  it("the box's current take is one of the whole box, before a newer clip of one of its shots", () => {
    const box = { key: 'a,b', shotIds: ['a', 'b'] }
    expect(boxTop([gen('old', ['b']), gen('joined', ['a', 'b'])], box)?.id).toBe('joined')
    expect(boxTop([gen('old', ['b'])], box)?.id).toBe('old')
  })

  it('Assemble again counts the clips it would lose edits on', () => {
    const { d, videoId } = filmWithClips()
    const cut = readCut(d, videoId)
    const gens: Gen[] = Object.values(d.generations).map((g) => gen(g.id, g.shot_ids, { durationS: g.duration_s ?? 0, segments: [] }))
    expect(assembleLoses(cut, gens)).toBe(0)
    const edited = { ...cut, v1: cut.v1.map((c, i) => (i === 1 ? { ...c, fadeInS: 0.5 } : i === 2 ? { ...c, outS: c.outS - 1 } : c)) }
    expect(assembleLoses(edited, gens)).toBe(2)
  })

  it('a gap kept apart by a spoken line names the shot and its line', () => {
    const ps = (id: string, spoken = false): PlanShot => ({ id, kind: 'shot', durationS: 2.5, hasFrame: true, spoken, product: false, text: false, moderated: false } as unknown as PlanShot)
    expect(joinBlock(ps('s4'), ps('s5', true), 4, (id) => (id === 's5' ? 'Quietboil. Let them sleep.' : undefined)))
      .toBe('Shot 5 has a spoken line (“Quietboil. Let them sleep.”), so it is its own video, with sound: a joined video trims each shot to its storyboard length, which could cut the line off')
  })
})

describe('the box says its sound (B6)', () => {
  it('with sound on a model with the switch, and names a model that makes none', async () => {
    const { boxSound } = await import('./boxModel')
    const { d, shots } = filmWithClips()
    d.beats = { ...(d.beats ?? {}), beat_1: { id: 'beat_1', v: 1, field_v: {}, shot_id: shots[1].id, kind: 'line', at_s: 1, text: 'Let them sleep.', speaker: 'HER', rank: 'a0' } as never }
    const box = { shotIds: [shots[0].id, shots[1].id] }
    expect(boxSound(d, box, { provider: 'runway', model: 'veo3.1' })).toEqual({ on: true, words: 'Sound on: Veo 3.1 makes the spoken line in the clip.' })
    expect(boxSound(d, { shotIds: [shots[2].id] }, { provider: 'runway', model: 'veo3.1' })).toBeUndefined()
  })
})

describe('the joined take through the .clan store (B2)', () => {
  it('is written as the document allows, one undo step, and the note puts the clips back', async () => {
    const { modelStore, seedStages, job: mkJob, addShots: add, addTake: take, id } = await import('../test/model')
    const { systemUpdate } = await import('../doc/store')
    const { placeJoinedTake, undoJoinedTake } = await import('./editOps')
    const store = modelStore({ undo: { saved: null, save: () => {} } })
    await store.create(MAYA, 'Joined')
    await seedStages(store)
    let videoId = ''
    let shotIds: string[] = []
    const runId = id('run')
    const jobId = id('job')
    await systemUpdate(store, (d) => {
      const shots = add(d, 3)
      shots[0].duration_s = 3
      shots[1].duration_s = 2.5
      shotIds = shots.map((s) => s.id)
      shots.forEach((s, i) => take(d, s, SHA(String(i + 1)), mkJob(d, 'clip', [], SHA(String(i + 1))), { pick: true }))
      videoId = mainVideo(d)!.id
      d.videos[videoId].runs = { [runId]: { shot_ids: [shotIds[0], shotIds[1]], mode: 'take_refs', model: 'mock', state: 'done', planned_by: 'human', job_id: jobId } }
      const j = mkJob(d, 'clip', [], SHA('9'), { id: jobId } as never)
      d.jobs[jobId] = { ...j, id: jobId }
      const g = id('gen')
      d.generations[g] = {
        id: g, v: 1, field_v: {}, kind: 'together', inputs: { model: 'mock', length_s: 6 }, box_id: runId, shot_ids: [shotIds[0], shotIds[1]],
        segments: [{ shot_id: shotIds[0], in_s: 0, out_s: 3, by: 'detected' }, { shot_id: shotIds[1], in_s: 3, out_s: 5.5, by: 'detected' }],
        asset: SHA('9'), duration_s: 6, state: 'ready', job_id: jobId, provider: 'mock', crew: 'wren', mock: true, created_at: '2026-11-21T10:00:00Z', by: `human:${MAYA.id}`,
      } as never
      d.assets[SHA('9')] = { sha256: SHA('9'), kind: 'video', mime: 'video/mp4', origin: 'generated', locations: [], duration_s: 6 } as never
    }, 'seed')
    let ui: Record<string, unknown> = { jobs: {} }
    const uiStore = { get: () => ui, update: (fn: (u: typeof ui) => void) => { const n = structuredClone(ui); fn(n); ui = n } } as never
    const before = readCut(store.get(), videoId).v1.map((c) => c.genId)
    expect(await placeJoinedTake(store, uiStore, videoId, jobId)).toBe(true)
    const after = readCut(store.get(), videoId).v1
    expect(after.map((c) => c.follows?.shotId)).toEqual(shotIds)
    expect(after[0].genId).toBe(after[1].genId)
    expect(after[0].genId).not.toBe(before[0])
    expect((ui.joinedInCut as { text: string }).text).toBe('Joined take of shots 1–2 is in the cut.')
    expect(await undoJoinedTake(store, uiStore)).toBe(true)
    expect(readCut(store.get(), videoId).v1.map((c) => c.genId)).toEqual(before)
    expect(ui.joinedInCut).toBeUndefined()
    // F12: the bar's Redo puts it in again.
    expect(store.redo).toBeDefined()
    await store.redo!()
    expect(readCut(store.get(), videoId).v1.map((c) => c.genId)).toEqual(after.map((c) => c.genId))
  })
})
