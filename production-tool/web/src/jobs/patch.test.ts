// Fix this moment's web pieces (features/clip-moment-edit.clan): fixRoute ranks a windowed note ahead of
// fixInShot, and landPatch lands a finished clip_patch as one landing by Edie.
import { describe, expect, it, vi } from 'vitest'
import type { Job, ProductionDocument, Review } from '../contracts/types'
import { controlsFor } from '../capabilities'
import { CONFIGS } from '../contracts/load'
import { currentTake, cutItemFor, takesOf } from '../model/selectors'
import { snapshotDoc } from '../test/jobFixtures'
import { addShots, addTake, job, SHA } from '../test/model'
import { fixRoute, landPatch } from './patch'

const ON = { fixMoment: true, fixInShot: true }

function setup() {
  const store = snapshotDoc()
  const d = structuredClone(store.get())
  const [shot] = addShots(d, 1, { duration_s: 6 })
  const take = addTake(d, shot, SHA('a'), job(d, 'clip', [], SHA('a')), { pick: true })
  store.replace(d)
  return { store, shot, take }
}

function note(d: ProductionDocument, extra: Partial<Review>): Review {
  return { id: 'review_1', v: 1, field_v: {}, target: { kind: 'generation', id: Object.keys(d.generations)[0] }, by: 'human:p_maya',
           state: 'open', created_at: '2026-10-14T10:00:00Z', text: 'her eyes should open here', ...extra } as Review
}

function patchJob(over: Partial<Job> = {}): Job {
  return {
    jobId: 'job_01K7F00000000000000000CP01', op: 'clip_patch', state: 'completed', crew: 'edie', provider: 'runway', model: 'aleph2',
    kind: 'generated', outputs: [{ sha256: SHA('b'), url: 'https://cdn.test/b.mp4', mime: 'video/mp4', bytes: 9, durationS: 6 }],
    patch: { send: 'range', window: { from_s: 2, to_s: 4 }, cut: { from_s: 0, to_s: 6 }, range: { start_s: 2, end_s: 4 },
             keyframe: 'still', model: 'aleph2', exact: true, seams: [] },
    ...over,
  } as Job
}

describe('fixRoute', () => {
  it('fixes a windowed note on a take in that moment, ahead of fixing it in the shot', () => {
    const { store, shot, take } = setup()
    const d = store.get()
    const r = fixRoute(d, note(d, { at_s: 3.2, window: { from_s: 2, to_s: 4 }, region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }), ON)
    expect(r).toEqual({ route: 'patch', shotId: shot.id, takeId: take.id, window: { from_s: 2, to_s: 4 }, atS: 3.2 })
  })

  it('moves a shot-time note by the cut item in_s and widens it to whole seconds', () => {
    const { store, shot, take } = setup()
    const d = structuredClone(store.get())
    d.videos[Object.keys(d.videos)[0]].timeline[cutItemFor(d, shot.id)!.id].source!.in_s = 1
    const n = note(d, { target: { kind: 'video', id: Object.keys(d.videos)[0] }, shot_id: shot.id, at_s: 1.5, window: { from_s: 1.2, to_s: 2.6 } })
    expect(fixRoute(d, n, ON)).toEqual({ route: 'patch', shotId: shot.id, takeId: take.id, window: { from_s: 2, to_s: 4 }, atS: 2.5 })
  })

  it('a boxed note without a window is fixed in the shot; with Fix this moment off, a window is too', () => {
    const { store, shot } = setup()
    const d = store.get()
    const box = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }
    expect(fixRoute(d, note(d, { at_s: 3, region: box }), ON)).toEqual({ route: 'in_shot', shotId: shot.id })
    expect(fixRoute(d, note(d, { at_s: 3, window: { from_s: 2, to_s: 4 }, region: box }), { ...ON, fixMoment: false }))
      .toEqual({ route: 'in_shot', shotId: shot.id })
  })

  it('remakes the clip when neither narrower fix applies, saying why', () => {
    const { store, shot } = setup()
    const d = store.get()
    expect(fixRoute(d, note(d, { at_s: 3 }), ON)).toEqual({ route: 'remake', shotId: shot.id, why: 'the note has no moment' })
    expect(fixRoute(d, note(d, { at_s: 3, window: { from_s: 2, to_s: 4 } }), { fixMoment: false, fixInShot: false }).route).toBe('remake')
  })

  it('a window wholly past what the cut plays of the take is not fixed in the moment', () => {
    const { store, shot } = setup()
    const d = structuredClone(store.get())
    d.videos[Object.keys(d.videos)[0]].timeline[cutItemFor(d, shot.id)!.id].source!.out_s = 3
    expect(fixRoute(d, note(d, { at_s: 4.5, window: { from_s: 4, to_s: 6 } }), ON))
      .toEqual({ route: 'remake', shotId: shot.id, why: 'the moment is outside what the cut plays' })
  })

  it('is on only with the flag and a provider routed for clip_patch', () => {
    const testing = structuredClone(CONFIGS.testing)
    expect(controlsFor(testing).fixMoment).toBe(false)
    testing.flags.clipPatch = true
    expect(controlsFor(testing).fixMoment).toBe(!!testing.routing.clip_patch?.length)
  })
})

describe('landPatch', () => {
  it('lands the patched take beside its parent in one landing by Edie, the cut and the note left as they are', async () => {
    const { store, shot, take } = setup()
    const d = structuredClone(store.get())
    d.reviews.review_1 = note(d, { at_s: 3.2, window: { from_s: 2, to_s: 4 } })
    const jobId = patchJob().jobId  // the runner's record of the job, which the landing cites
    d.jobs[jobId] = { ...job(d, 'clip_patch', [SHA('a')], SHA('b'), { crew: 'edie' }), id: jobId }
    store.replace(d)
    const change = vi.spyOn(store, 'change')
    await landPatch(store, patchJob(), { shotId: shot.id, parentTakeId: take.id })
    expect(change).toHaveBeenCalledTimes(1)
    const why = change.mock.calls[0][1]
    expect(why).toMatchObject({ action: expect.stringMatching(/^edit take v2 for /), agent: 'edie', undo: false })
    const after = store.get()
    const landed = takesOf(after, shot.id).find((g) => g.id !== take.id)!
    expect(landed).toMatchObject({ kind: 'patch', parent_id: take.id, asset: SHA('b'), crew: 'edie', duration_s: take.duration_s, inputs: { model: 'aleph2' } })
    expect(landed.patched).toContainEqual(expect.objectContaining({ in_s: 2, out_s: 4, job_id: patchJob().jobId }))
    expect(currentTake(after, shot.id)!.id).toBe(take.id) // a new take never touches the cut
    expect(after.reviews.review_1.state).toBe('open')

    await landPatch(store, patchJob(), { shotId: shot.id, parentTakeId: take.id })  // the same job again
    expect(change).toHaveBeenCalledTimes(1)
    expect(takesOf(store.get(), shot.id)).toHaveLength(2)
  })

  it('lands nothing without an output or a patch block', async () => {
    const { store, shot, take } = setup()
    const change = vi.spyOn(store, 'change')
    await landPatch(store, patchJob({ outputs: [] }), { shotId: shot.id, parentTakeId: take.id })
    await landPatch(store, patchJob({ patch: undefined }), { shotId: shot.id, parentTakeId: take.id })
    expect(change).not.toHaveBeenCalled()
  })
})
