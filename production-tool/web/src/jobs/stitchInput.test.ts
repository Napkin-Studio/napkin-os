import { describe, expect, it } from 'vitest'
import type { ProductionDocument, Shot } from '../contracts/types'
import { mainVideo, shotsOf } from '../model/selectors'
import type { Relay } from '../relay/types'
import { MAYA, snapshotDoc } from '../test/jobFixtures'
import { SHA, addShots, addTake, job } from '../test/model'
import { stitchAt, stitchTimeline } from '../relay/mockRender'
import { stitchInput } from './clips'

// features/connected-video.clan, phase 1: the stitch request carries each clip's in and out points from
// its edl item; a document without them gives exactly the request it always did.

const CDN = 'https://cdn.test/out'

/** Three shots of 3, 2 and 4 s, each with a picked take the relay made (an https location: no upload). */
function made(order: number[] = [0, 1, 2]) {
  const store = snapshotDoc(MAYA)
  const d = structuredClone(store.get()) as ProductionDocument
  const shots = addShots(d, 3)
  ;[3, 2, 4].forEach((s, i) => { shots[i].duration_s = s })
  // Takes land (and get their edl items, last) in `order`, as parallel clips do.
  for (const i of order) {
    const sha = SHA('abc'[i])
    addTake(d, shots[i], sha, job(d, 'clip', [], sha), { pick: true })
    d.assets[sha] = { ...d.assets[sha], locations: [`${CDN}/${sha}`] }
  }
  return { d, shots, deps: { relay: null as unknown as Relay, doc: { get: () => d } } as unknown as Parameters<typeof stitchInput>[0] }
}

const itemOf = (d: ProductionDocument, shot: Shot) => Object.values(mainVideo(d)!.edl).find((x) => x.shot_id === shot.id)!

describe('stitchInput', () => {
  it('an old document (no in or out points) gives exactly the request it always did', async () => {
    const { d, deps } = made()
    const { input, parents } = await stitchInput(deps)
    const clip = (c: string, trimS: number) => ({ asset: { sha256: SHA(c), url: `${CDN}/${SHA(c)}`, mime: 'video/mp4' }, trimS })
    expect(JSON.stringify(input)).toBe(JSON.stringify({ clips: [clip('a', 3), clip('b', 2), clip('c', 4)], ...(mainVideo(d)!.ratio ? { ratio: mainVideo(d)!.ratio } : {}) }))
    expect(parents).toHaveLength(3)
  })

  it('sends each edl item\'s in and out points as inS and outS', async () => {
    const { d, shots, deps } = made()
    Object.assign(itemOf(d, shots[0]), { in_s: 1.5, out_s: 4 })
    Object.assign(itemOf(d, shots[1]), { in_s: 0 }) // absent or 0: the clip's start, sent as nothing
    Object.assign(itemOf(d, shots[2]), { out_s: 3.5 })
    const { input } = await stitchInput(deps)
    expect(input.clips!.map(({ trimS, inS, outS }) => ({ trimS, inS, outS }))).toEqual([
      { trimS: 3, inS: 1.5, outS: 4 }, { trimS: 2, inS: undefined, outS: undefined }, { trimS: 4, inS: undefined, outS: 3.5 },
    ])
    expect(input.clips!.every((c) => !('transition' in c))).toBe(true) // phase 1 stores no seams: every join is a cut
  })

  it('an out point at or before the in point is not sent', async () => {
    const { d, shots, deps } = made()
    Object.assign(itemOf(d, shots[0]), { in_s: 2, out_s: 2 })
    const { input } = await stitchInput(deps)
    expect(input.clips![0]).toMatchObject({ inS: 2 })
    expect('outS' in input.clips![0]).toBe(false)
  })

  it('keeps shot order when the edl ranks follow the order the clips landed in (open question)', async () => {
    const { d, deps } = made([2, 0, 1])
    const video = mainVideo(d)!
    const byRank = Object.values(video.edl).sort((a, b) => (a.rank < b.rank ? -1 : 1)).map((x) => x.shot_id)
    const byShot = shotsOf(d).map((s) => s.id)
    expect(byRank).not.toEqual(byShot) // the design's "edl by rank = shot order" does not hold here
    const { input } = await stitchInput(deps)
    expect(input.clips!.map((c) => c.asset.sha256)).toEqual([SHA('a'), SHA('b'), SHA('c')])
  })
})

describe("the browser mock's stitch timeline (mockRender), like stitch.py", () => {
  it('keeps every slot where the shots put it: a transition borrows the outgoing clip, not time', () => {
    const slots = stitchTimeline([{ dur: 2.5 }, { dur: 3, transition: { kind: 'dissolve', s: 0.5 } }, { dur: 2, transition: { kind: 'dip' } }])
    expect(slots).toEqual([
      { start: 0, dur: 2.5, kind: 'cut', s: 0 },
      { start: 2.5, dur: 3, kind: 'dissolve', s: 0.5 },
      { start: 5.5, dur: 2, kind: 'dip', s: 0.5 },
    ])
    expect(stitchAt(slots, 1)).toEqual({ idx: 0 })
    expect(stitchAt(slots, 2.75)).toEqual({ idx: 1, prev: 0, p: 0.5 })
    expect(stitchAt(slots, 3.1)).toEqual({ idx: 1 })
    expect(stitchAt(slots, 7.6)).toEqual({ idx: -1 }) // the end card
  })

  it("clamps like the stitch: a first clip's transition is a cut, and none is longer than its slot or 2 s", () => {
    const slots = stitchTimeline([{ dur: 2, transition: { kind: 'dip' } }, { dur: 0.25, transition: { kind: 'dissolve', s: 1 } },
      { dur: 4, transition: { kind: 'cut' } }, { dur: 9, transition: { kind: 'dip', s: 5 } }])
    expect(slots.map((x) => [x.kind, x.s])).toEqual([['cut', 0], ['dissolve', 0.25], ['cut', 0], ['dip', 2]])
  })
})
