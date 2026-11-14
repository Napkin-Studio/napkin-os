// Shots that join (features/connected-video.clan, design section 9): the run planner's vectors, the take's
// timing and windows, the run driver, Remake just this shot, the stitch request for end-framed clips and
// windows, and that with flags.connectedVideo absent Make clips sends exactly today's requests.

import { describe, expect, it, vi } from 'vitest'
import { CONFIGS } from '../contracts/load'
import type { Config, Job, JobInput, ProductionDocument, Shot } from '../contracts/types'
import { SnapshotDocumentStore } from '../doc/store'
import { cutItemFor, mainVideo, shotsOf, takesOf } from '../model/selectors'
import { purposeOf, purposeInputs } from '../model/purpose'
import { MAYA, addRef, snapshotDoc } from '../test/jobFixtures'
import { SHA, addFrame, addShots, addTake, job, plain } from '../test/model'
import { endFramed, makeClip, redoInTake, stitchInput } from './clips'
import { SOFTENED_NOTE, applyRunTake, applyTake, softenedWhy } from './handlers'
import type { PlanShot } from './joins'
import { joinKind } from './joins'
import { billedS, makeClips, makeRuns, modelEntry, planRuns, segmentRun, takeModelFor, takeTiming, takeWindows, type PlanModel } from './runs'
import { frameMarks, joinBefore, joinHere, joinSelection, selectionBlock, separateAll, separateSelection, splitHere, videoJoin, videoPlan, videoShots, videoUnits } from './runView'
import { END_FRAME_CHANGED, endFrameDrift } from './stale'
import { mockCuts } from '../relay/mock'
import { speedFor, stitchTimeline } from '../relay/mockRender'

vi.mock('./assets', () => ({ assetRef: async (_relay: unknown, sha: string) => ({ sha256: sha, url: `https://cdn.test/${sha}`, mime: sha.includes('v') ? 'video/mp4' : 'image/png' }) }))

const WAN3 = modelEntry('runway', 'wan3')!
const VEO_FAST = modelEntry('runway', 'veo3.1_fast')!
const VEO = modelEntry('runway', 'veo3.1')!
/** A model that lands only loosely (h3_max, T8 0.55-0.74): never planned as frames. */
const LOOSE: PlanModel = { ...VEO_FAST, model: 'h3_max', label: 'H3 Max', video: { ...VEO_FAST.video, lastFrameFidelity: 'loose', take: { ok: true, maxS: 15, maxShots: 6, withLast: false, cutAccuracyS: 0.8, field: 'prompt' } } }
const LOOSE_NO_TAKE: PlanModel = { ...LOOSE, video: { ...LOOSE.video, take: { ok: false } } }

let n = 0
/** A planner shot: 3 s, medium, eye level, scene s1, with a frame. */
function ps(extra: Partial<PlanShot> = {}): PlanShot {
  return { id: `shot_${++n}`, kind: 'shot', sceneId: 's1', camera: { size: 'medium' }, durationS: 3, hasFrame: true, spoken: false, product: false, text: false, moderated: false, ...extra }
}
const modes = (p: ReturnType<typeof planRuns>) => p.runs.map((r) => `${r.mode}:${r.shotIds.length}`)

describe('planRuns', () => {
  it('makes wan3 and four silent shots one take, pinned on the first frame', () => {
    const shots = [ps(), ps({ camera: { size: 'close' } }), ps(), ps({ camera: { size: 'wide' } })]
    const p = planRuns(shots, WAN3)
    expect(modes(p)).toEqual(['take:4'])
    expect(p.runs[0].lands).toEqual({}) // take.withLast is false: a take never lands on a frame yet
  })

  it('breaks a run at a new scene', () => {
    const p = planRuns([ps(), ps(), ps({ sceneId: 's2' }), ps({ sceneId: 's2' })], WAN3)
    expect(modes(p)).toEqual(['take:2', 'take:2'])
    expect(Object.values(p.joins)[1]).toEqual({ kind: 'cut', by: 'crew' })
  })

  it('sends a spoken shot on its own to Veo, landing on the next frame where it carries on', () => {
    const shots = [ps(), ps({ spoken: true, durationS: 4 }), ps(), ps()]
    const p = planRuns(shots, WAN3, { speaker: VEO_FAST })
    expect(modes(p)).toEqual(['frames:1', 'frames:1', 'take:2'])
    expect(p.runs[1].model.model).toBe('veo3.1_fast')
    expect(p.runs[1].lands).toEqual({ [shots[1].id]: shots[2].id })
  })

  it('starts a run on a product shot and leaves a type shot and an end card alone', () => {
    const shots = [ps(), ps(), ps({ product: true }), ps(), ps({ text: true }), ps({ kind: 'end_card' })]
    expect(modes(planRuns(shots, WAN3))).toEqual(['take:2', 'take:2', 'frames:1', 'alone:1'])
  })

  it('splits a 40 s wan3 run into takes of at most 15 s that meet on a cut', () => {
    const shots = Array.from({ length: 8 }, () => ps({ durationS: 5 }))
    const p = planRuns(shots, WAN3)
    expect(modes(p)).toEqual(['take:3', 'take:3', 'take:2'])
    expect(segmentRun(shots.map((s) => ({ durationS: s.durationS })), 15, 6).map((g) => g.length)).toEqual([3, 3, 2])
    expect(segmentRun(Array.from({ length: 9 }, () => ({ durationS: 1 })), 15, 6).map((g) => g.length)).toEqual([6, 3])
  })

  it('never plans a loose-landing model (h3_max) as frames', () => {
    expect(modes(planRuns([ps(), ps()], LOOSE_NO_TAKE))).toEqual(['alone:2'])
    expect(modes(planRuns([ps()], LOOSE))).toEqual(['alone:1'])
    expect(modes(planRuns([ps(), ps()], LOOSE))).toEqual(['take:2']) // its takes still group
  })

  it('lands a frames clip on the next frame only on a continue join', () => {
    const shots = [
      ps({ durationS: 4 }), ps({ durationS: 4 }), // same setup: continue
      ps({ durationS: 4, camera: { size: 'close' } }), // new angle: cut
      ps({ durationS: 4, camera: { size: 'close' }, human: { kind: 'dissolve', by: 'human' } }),
      ps({ durationS: 4, camera: { size: 'wide' }, moments: ['m1'] }),
      ps({ durationS: 4, camera: { size: 'close' }, moments: ['m1'] }), // same moment, new angle: match
    ]
    const p = planRuns(shots, VEO_FAST)
    expect(p.joins[shots[1].id].kind).toBe('continue')
    expect(p.joins[shots[2].id].kind).toBe('cut')
    expect(p.joins[shots[5].id].kind).toBe('match')
    const lands = Object.assign({}, ...p.runs.map((r) => r.lands))
    expect(lands).toEqual({ [shots[0].id]: shots[1].id })
    // The person's dissolve splits the run.
    expect(modes(p)).toEqual(['frames:3', 'frames:3'])
  })

  it('does not end-frame a Veo shot it would have to speed up more than 1.33 times', () => {
    expect(billedS(2.5, VEO_FAST)).toBe(4)
    const short = [ps({ durationS: 2.5 }), ps({ durationS: 4 }), ps({ durationS: 4 })]
    const p = planRuns(short, VEO_FAST)
    expect(p.runs[0].lands).toEqual({ [short[1].id]: short[2].id }) // 2.5 s → 4 s is 1.6x: no landing
    expect(billedS(2.5, WAN3)).toBe(3) // wan3 asks the length (whole seconds): 1.2x
  })

  it('makes a run with no frames one take from the pictures', () => {
    expect(modes(planRuns([ps({ hasFrame: false }), ps({ hasFrame: false })], WAN3))).toEqual(['take_refs:2'])
  })

  it('makes every shot alone shot by shot', () => {
    expect(modes(planRuns([ps(), ps(), ps()], WAN3, { join: 'shots' }))).toEqual(['alone:1', 'alone:1', 'alone:1'])
  })

  it('plans again from the order as it is now (reorder, insert, delete)', () => {
    const a = ps(), b = ps({ sceneId: 's2' }), c = ps(), d = ps({ sceneId: 's2' })
    expect(modes(planRuns([a, b, c, d], WAN3))).toEqual(['frames:1', 'frames:1', 'frames:1', 'frames:1'])
    expect(modes(planRuns([a, c, b, d], WAN3))).toEqual(['take:2', 'take:2']) // reordered
    expect(modes(planRuns([a, c, ps(), b, d], WAN3))).toEqual(['take:3', 'take:2']) // inserted
    expect(modes(planRuns([a, b, d], WAN3))).toEqual(['frames:1', 'take:2']) // deleted
  })

  it('keeps already-made shots out of every run, as a break', () => {
    const p = planRuns([ps(), ps({ made: true }), ps(), ps()], WAN3)
    expect(modes(p)).toEqual(['frames:1', 'take:2'])
  })

  it('a person\'s join wins over Dex\'s', () => {
    expect(joinKind(ps({ sceneId: 'a' }), ps({ sceneId: 'b', human: { kind: 'continue', by: 'human' } }))).toEqual({ kind: 'continue', by: 'human' })
  })
})

describe("a take's timing and windows", () => {
  it('rounds the take up to whole seconds and puts the slack at the heads of the shots after the first', () => {
    const { totalS, starts } = takeTiming([2.5, 3, 4.2])
    expect(totalS).toBe(10)
    expect(starts).toEqual([0, 2.5, 5.65])
    const w = takeWindows([2.5, 3, 4.2], starts, undefined, totalS)
    // Each window is the shot's own length, its head trimmed; the first starts on the pinned frame.
    expect(w.map((x) => [x.in_s, x.out_s])).toEqual([[0, 2.5], [2.65, 5.65], [5.8, 10]])
    expect(w.every((x) => x.by === 'prompt')).toBe(true)
  })

  it('cuts where the take cut, found else planned', () => {
    const w = takeWindows([3, 3, 3], [0, 3, 6], [{ planned_s: 3, found_s: 3.04 }, { planned_s: 6, found_s: null }], 9)
    expect(w).toEqual([
      { in_s: 0, out_s: 3.04, by: 'detected' }, { in_s: 3.04, out_s: 6, by: 'detected' }, { in_s: 6, out_s: 9, by: 'prompt' },
    ])
  })
})

// ── The driver ──────────────────────────────────────────────────────────────

const on: Config = { ...CONFIGS.live, flags: { ...CONFIGS.live.flags, connectedVideo: true } }
const off: Config = CONFIGS.live

/** Shots of `lengths` on the main storyboard, each with a picked frame, in one scene, same setup. */
function film(lengths: number[], extra: (i: number) => Partial<Shot> = () => ({}), prep?: (d: ProductionDocument, shots: Shot[]) => void) {
  const d = structuredClone(snapshotDoc(MAYA).get()) as ProductionDocument
  const shots = addShots(d, lengths.length)
  shots.forEach((s, i) => Object.assign(s, { duration_s: lengths[i], action: `Action ${i + 1}.`, ...extra(i) }))
  shots.forEach((s, i) => addFrame(d, s, SHA('0123456789'[i]), { pick: true }))
  prep?.(d, shots)
  const store = new SnapshotDocumentStore(d, null, 0)
  const submits: { op: string; input: JobInput; purpose: unknown; modelChoice?: unknown; extras?: unknown }[] = []
  let k = 0
  const runner = { submit: vi.fn(async (op: string, input: JobInput, _p: string[], purpose: unknown, _id?: string, modelChoice?: unknown, extras?: unknown) => {
    submits.push({ op, input, purpose, modelChoice, extras })
    return `job_${++k}`
  }) }
  const deps = { relay: {} as never, doc: store as never, ui: { get: () => ({ jobs: {} }) } as never, runner: runner as never }
  return { store, shots, deps, submits, videoId: mainVideo(store.get())!.id }
}

const wan3 = { provider: 'runway' as const, model: 'wan3' }
const veoFast = { provider: 'runway' as const, model: 'veo3.1_fast' }
const skipNone = () => false

describe('Make clips', () => {
  it('with the flag absent sends exactly the per-shot requests it always did', async () => {
    const a = film([3, 3, 3])
    const failed = await makeClips(a.deps, { videoId: a.videoId, shots: a.shots, ids: a.shots.map((s) => s.id), config: off, join: videoJoin(a.store.get(), a.videoId, off), modelChoice: wan3, busy: skipNone })
    expect(failed).toEqual([])
    const b = film([3, 3, 3])
    for (const s of b.shots) await makeClip(b.deps, s.id, { modelChoice: wan3, videoId: b.videoId })
    const strip = (x: typeof a.submits) => x.map((s) => ({ ...s, input: { ...s.input, shot: { ...s.input.shot!, id: '' } }, purpose: { ...(s.purpose as object), shotId: '' } }))
    expect(plain(strip(a.submits))).toEqual(plain(strip(b.submits)))
    expect(a.submits.every((s) => !('mode' in s.input) && !('lastFrame' in s.input))).toBe(true)
    expect(a.store.get().videos[a.videoId].runs).toBeUndefined()
  })

  it('as one film on wan3 sends one take for the run, timed by its cuts, and records the run', async () => {
    const a = film([3, 3, 4])
    await makeClips(a.deps, { videoId: a.videoId, shots: a.shots, ids: a.shots.map((s) => s.id), config: on, join: 'film', modelChoice: wan3, quality: 'draft', busy: skipNone })
    expect(a.submits).toHaveLength(1)
    const [t] = a.submits
    expect(t.op).toBe('clip')
    expect(t.input.mode).toBe('take')
    expect(t.input.shots).toHaveLength(3)
    expect(t.input.cuts).toEqual([{ atS: 0, text: 'Action 1.' }, { atS: 3, text: 'Action 2.' }, { atS: 6, text: 'Action 3.' }])
    expect(t.input.image?.sha256).toBe(SHA('0'))
    expect(t.input.refs).toBeUndefined() // a pinned take sends no references
    expect(t.input.lastFrame).toBeUndefined()
    expect(t.extras).toEqual({ quality: 'draft' }) // Draft / Standard / Final as today
    const runs = Object.entries(a.store.get().videos[a.videoId].runs ?? {})
    expect(runs).toHaveLength(1)
    expect(runs[0][1]).toMatchObject({ shot_ids: a.shots.map((s) => s.id), mode: 'take', model: 'wan3', state: 'running', job_id: 'job_1', planned_by: 'crew' })
    expect(t.purpose).toEqual({ for: 'run', videoId: a.videoId, runId: runs[0][0] })
  })

  it('on Veo, a separate shot ends on the next frame where the action carries on; the strip switches to WAN 3', async () => {
    const a = film([4, 4, 4], (i) => (i === 2 ? { camera: { size: 'close' } } : {}), (d, shots) => { shots[1].refs = [addRef(d, 'bottle', 'front', SHA('f'), 'product').id] })
    await makeClips(a.deps, { videoId: a.videoId, shots: a.shots, ids: a.shots.map((s) => s.id), config: on, join: 'film', modelChoice: veoFast, busy: skipNone })
    // Shot 1 is on its own (the product shot starts a video), lands on shot 2's frame, and keeps the pick.
    expect(a.submits[0].input).toMatchObject({ mode: 'frames', lastFrame: { sha256: SHA('1') } })
    expect(a.submits[0].modelChoice).toEqual(veoFast)
    expect(a.submits[0].purpose).toMatchObject({ for: 'clip', endFrameId: a.store.get().shots[a.shots[1].id].pick!.current })
    // Shots 2-3 are one video: Veo makes none, so WAN 3 makes it.
    expect(a.submits[1].input).toMatchObject({ mode: 'take' })
    expect(a.submits[1].modelChoice).toEqual(wan3)
    expect(a.submits).toHaveLength(2)
    // The crew's joins are worked out from the shots, never stored (only a person's boxes are).
    const seams = shotsOf(a.store.get()).map((s) => joinBefore(a.store.get(), a.videoId, s.id)?.kind)
    expect(seams).toEqual([undefined, 'continue', 'cut'])
  })

  it('names the run and how it is made in History, never the mode', async () => {
    const a = film([3, 3])
    const chain: string[] = []
    const change = a.store.change.bind(a.store)
    a.store.change = ((fn, why) => { if (why && !why.quiet) chain.push(why.action); return change(fn, why) }) as typeof a.store.change
    await makeClips(a.deps, { videoId: a.videoId, shots: a.shots, ids: a.shots.map((s) => s.id), config: on, join: 'film', modelChoice: wan3, busy: skipNone })
    expect(chain).toContain('plan shots 1–2 as one video on WAN 3')
    expect(chain.join(' ')).not.toMatch(/take_refs|frames|\$|credit/)
  })
})

describe('a take landing', () => {
  it('lands one generation of the box, a window per shot from the cuts the relay found', async () => {
    const a = film([3, 3, 4])
    await makeClips(a.deps, { videoId: a.videoId, shots: a.shots, ids: a.shots.map((s) => s.id), config: on, join: 'film', modelChoice: wan3, busy: skipNone })
    const d = structuredClone(a.store.get())
    const runId = Object.keys(d.videos[a.videoId].runs!)[0]
    const j = { jobId: 'job_1', op: 'clip', provider: 'runway', model: 'wan3', kind: 'generated', outputs: [{ sha256: SHA('v'), durationS: 10 }], cuts: [{ planned_s: 3, found_s: 3.05 }, { planned_s: 6, found_s: null }] } as unknown as Job
    const made = applyRunTake(d, j, { videoId: a.videoId, runId })!
    expect(made).toMatchObject({ kind: 'together', box_id: runId, shot_ids: a.shots.map((s) => s.id), asset: SHA('v'), duration_s: 10, state: 'ready', job_id: 'job_1' })
    expect(made.segments).toEqual([
      { shot_id: a.shots[0].id, in_s: 0, out_s: 3.05, by: 'detected' },
      { shot_id: a.shots[1].id, in_s: 3.05, out_s: 6, by: 'detected' },
      { shot_id: a.shots[2].id, in_s: 6, out_s: 10, by: 'prompt' },
    ])
    expect(d.videos[a.videoId].runs![runId].state).toBe('done')
    expect(applyRunTake(d, j, { videoId: a.videoId, runId })).toBeUndefined() // landing twice does nothing
    // Nothing marks a take out of date.
    expect(Object.values(d.stale)).toEqual([])
    // The Video editor puts each shot's window in the cut, its shot's length long (a short one holds its last frame).
    expect(a.shots.map((s) => cutItemFor(d, s.id, a.videoId)?.source)).toEqual([
      { generation_id: made.id, in_s: 0, out_s: 3 }, { generation_id: made.id, in_s: 3.05, out_s: 6 }, { generation_id: made.id, in_s: 6, out_s: 10 },
    ])
    expect(cutItemFor(d, a.shots[1].id, a.videoId)?.hold_s).toBe(0.05)
    // The stitch reads the windows.
    const { input } = await stitchInput({ relay: {} as never, doc: { get: () => d } as never }, a.videoId)
    expect(input.clips!.map((c) => [c.inS, c.outS, c.trimS, c.fit])).toEqual([[undefined, 3, 3, undefined], [3.05, 6, 3, undefined], [6, 10, 4, undefined]])
    // Bands and marks: one take over the three shots, its first frame pinned and the others guides.
    expect(videoUnits(d, { jobs: {} }, a.videoId, videoPlan(d, a.videoId, WAN3)).map((u) => (u.kind === 'strip' ? `${u.state}:${u.shotIds.length}` : 'shot'))).toEqual(['made:3'])
    expect(Object.values(frameMarks(d, a.videoId, undefined))).toEqual(['pin', 'guide', 'guide'])
  })

  it('Remake just this shot sends the window alone, and its neighbours stay byte for byte', async () => {
    const a = film([3, 3, 3])
    await makeClips(a.deps, { videoId: a.videoId, shots: a.shots, ids: a.shots.map((s) => s.id), config: on, join: 'film', modelChoice: wan3, busy: skipNone })
    const d = structuredClone(a.store.get())
    const runId = Object.keys(d.videos[a.videoId].runs!)[0]
    applyRunTake(d, { jobId: 'job_1', op: 'clip', provider: 'runway', model: 'wan3', kind: 'generated', outputs: [{ sha256: SHA('v'), durationS: 9 }] } as unknown as Job, { videoId: a.videoId, runId })
    const store = new SnapshotDocumentStore(d, null, 0)
    const deps = { ...a.deps, doc: store as never }
    const before = plain([a.shots[0], a.shots[2]].map((s) => takesOf(store.get(), s.id)))
    await redoInTake(deps, a.shots[1].id, { videoId: a.videoId, withLast: true, modelChoice: wan3 })
    const redo = a.submits.at(-1)!
    expect(redo.input).toMatchObject({ mode: 'redo_window', window: { inS: 3, outS: 6, withLast: true, source: { sha256: SHA('v') } } })
    expect(redo.input.image).toBeUndefined()
    // It lands as a new take of this shot only, end-framed (stitch retimes it whole).
    const x = structuredClone(store.get())
    const purpose = purposeOf({ purpose: 'clip', node: { kind: 'shot', id: a.shots[1].id }, inputs: purposeInputs(redo.purpose as never) })!
    const landed = applyTake(x, { jobId: 'job_9', op: 'clip', provider: 'runway', model: 'wan3', kind: 'generated', outputs: [{ sha256: SHA('w'), durationS: 3 }] } as unknown as Job, purpose as never)!
    x.jobs.job_9 = job(x, 'clip', [], SHA('w'), { id: 'job_9', inputs: purposeInputs(redo.purpose as never) })
    expect(plain([a.shots[0], a.shots[2]].map((s) => takesOf(x, s.id)))).toEqual(before)
    expect(endFramed(x, landed)).toBe(true)
    const { input } = await stitchInput({ relay: {} as never, doc: { get: () => x } as never }, a.videoId)
    expect(input.clips![1]).toMatchObject({ trimS: 3, fit: 'speed' })
    expect(input.clips![1].inS).toBeUndefined()
  })
})

describe('end frames', () => {
  it('stitch retimes a clip that ends on the next frame and never cuts it from its head', async () => {
    const a = film([4, 4])
    const d = structuredClone(a.store.get())
    const next = d.shots[a.shots[1].id].pick!.current
    const t = applyTake(d, { jobId: 'job_1', op: 'clip', provider: 'runway', model: 'veo3.1_fast', kind: 'generated', outputs: [{ sha256: SHA('a'), durationS: 4 }] } as unknown as Job, { shotId: a.shots[0].id, endFrameId: next })!
    expect(t.end).toEqual({ kind: 'next_storyboard', frame_id: next })
    applyTake(d, { jobId: 'job_2', op: 'clip', provider: 'runway', model: 'veo3.1_fast', kind: 'generated', outputs: [{ sha256: SHA('b'), durationS: 4 }] } as unknown as Job, { shotId: a.shots[1].id })
    const { input } = await stitchInput({ relay: {} as never, doc: { get: () => d } as never }, a.videoId)
    expect(input.clips!.map((c) => [c.fit, c.transition, c.inS])).toEqual([['speed', undefined, undefined], [undefined, undefined, undefined]])
  })

  it('a landing clip is used up to the frame where it reached its last frame (landS), retimed into its slot', async () => {
    const a = film([3.2, 4])
    const d = structuredClone(a.store.get())
    const next = d.shots[a.shots[1].id].pick!.current
    // veo3.1_fast live (2026-10-19): 97 frames, the given last frame reached at frame 89, overshot after it.
    const landing = { jobId: 'job_1', op: 'clip', provider: 'runway', model: 'veo3.1_fast', kind: 'generated',
      outputs: [{ sha256: SHA('a'), durationS: 4.042 }], landS: 3.708, landScore: 0.954 }
    const t = applyTake(d, landing as unknown as Job, { shotId: a.shots[0].id, endFrameId: next })!
    expect(t.end).toEqual({ kind: 'next_storyboard', frame_id: next, at_s: 3.708, score: 0.954 })
    applyTake(d, { jobId: 'job_2', op: 'clip', provider: 'runway', model: 'veo3.1_fast', kind: 'generated', outputs: [{ sha256: SHA('b'), durationS: 4 }] } as unknown as Job, { shotId: a.shots[1].id })
    const { input } = await stitchInput({ relay: {} as never, doc: { get: () => d } as never }, a.videoId)
    // outS is the landing frame's end (landS plus one 24 fps frame): it is the last frame shown, nothing after it.
    expect(input.clips![0]).toMatchObject({ trimS: 3.2, outS: 3.75, fit: 'speed' })
    expect(input.clips![1].outS).toBe(4)
    // A person's out point on the cut still wins.
    d.videos[a.videoId].timeline[cutItemFor(d, a.shots[0].id, a.videoId)!.id].source!.out_s = 3.5
    const again = await stitchInput({ relay: {} as never, doc: { get: () => d } as never }, a.videoId)
    expect(again.input.clips![0].outS).toBe(3.5)
  })

  it('a changed landing frame is a quiet note on the clip before it, not a mark, and nothing cascades', () => {
    const a = film([4, 4])
    const d = structuredClone(a.store.get())
    const next = d.shots[a.shots[1].id].pick!.current
    applyTake(d, { jobId: 'job_1', op: 'clip', provider: 'runway', model: 'veo3.1_fast', kind: 'generated', outputs: [{ sha256: SHA('a') }] } as unknown as Job, { shotId: a.shots[0].id, endFrameId: next })
    expect(endFrameDrift(d, a.shots[0].id)).toBeUndefined()
    addFrame(d, d.shots[a.shots[1].id], SHA('e'), { pick: true })
    expect(endFrameDrift(d, a.shots[0].id)).toEqual({ reason: END_FRAME_CHANGED, shot: 2 })
    expect(Object.keys(d.stale)).toEqual([])
  })
})

describe('what the editors say', () => {
  it('is off with the flag absent, and As one film by default with it on', () => {
    const a = film([3])
    expect(videoJoin(a.store.get(), a.videoId, off)).toBeNull()
    expect(videoJoin(a.store.get(), a.videoId, on)).toBe('film')
  })

  it('pins the frames a planned take starts on, and guides the rest', () => {
    const a = film([3, 3, 3])
    const d = a.store.get()
    expect(Object.values(frameMarks(d, a.videoId, videoPlan(d, a.videoId, WAN3)))).toEqual(['pin', 'guide', 'guide'])
    expect(Object.values(frameMarks(d, a.videoId, planRuns(videoShots(d, a.videoId), VEO)))).toEqual(['pin', 'pin', 'pin'])
  })
})

describe('the browser mock', () => {
  it('cuts a take where its prompt does, and finds each cut there', () => {
    expect(mockCuts({ cuts: [{ atS: 0, text: 'a' }, { atS: 3, text: 'b' }, { atS: 6.5, text: 'c' }] })).toEqual([{ planned_s: 3, found_s: 3 }, { planned_s: 6.5, found_s: 6.5 }])
    expect(mockCuts({ shots: [{ duration_s: 2 }, { duration_s: 4 }] as never })).toEqual([{ planned_s: 2, found_s: 2 }])
  })

  it('retimes an end-framed clip to its slot within 1.33 times, and plays a continue as a cut', () => {
    expect(speedFor(4, 3.2)).toBeCloseTo(1.25, 3)
    expect(speedFor(4, 2.5)).toBe(1) // 1.6x: the stitch trims it instead
    expect(stitchTimeline([{ dur: 3 }, { dur: 3, transition: { kind: 'continue' } }]).map((x) => x.kind)).toEqual(['cut', 'cut'])
  })
})

// ── Strips + select (the owner's redesign, 2026-10-19) ─────────────────────

/** Three shots as one strip whose take Runway refused twice (the samurai ad, 2026-10-19). */
function refusedFilm() {
  const a = film([3, 3, 3])
  const d = structuredClone(a.store.get())
  const runId = 'run_01K7A00000000000000000RUN1'
  d.videos[a.videoId].runs = { [runId]: { shot_ids: a.shots.map((s) => s.id), mode: 'take', model: 'wan3', state: 'failed', planned_by: 'crew' } }
  d.jobs.job_r = job(d, 'clip', [], null, {
    id: 'job_r', state: 'failed', purpose: `run ${runId}`, node: { kind: 'video', id: a.videoId },
    error: { code: 'moderated', message: 'Runway refused the words twice (INPUT_PREPROCESSING.SAFETY.TEXT).', retryable: false },
  })
  const store = new SnapshotDocumentStore(d, null, 0)
  return { ...a, store }
}

const OMNI = modelEntry('runway', 'gemini_omni_flash_1.1')!
const omni = { provider: 'runway' as const, model: 'gemini_omni_flash_1.1' }
const unitsOf = (a: ReturnType<typeof film>, m: PlanModel = WAN3) => {
  const d = a.store.get()
  return videoUnits(d, { jobs: {} }, a.videoId, videoPlan(d, a.videoId, m))
    .map((u) => (u.kind === 'strip' ? `${u.state}:${u.shotIds.map((id) => a.shots.findIndex((s) => s.id === id) + 1).join('')}` : `shot:${a.shots.findIndex((s) => s.id === u.shotId) + 1}`))
}

describe('strips', () => {
  it('groups as the planner does: a scene, no spoken line, no end card', () => {
    const a = film([3, 3, 3, 3, 2.5], (i) => ({ ...(i >= 2 ? { scene_id: 'scene_b' } : {}), ...(i === 4 ? { kind: 'end_card' as const } : {}) }))
    expect(unitsOf(a)).toEqual(['new:12', 'new:34', 'shot:5'])
  })

  it('✂ splits a strip and 🔗 joins it again, each one History entry', async () => {
    const a = film([3, 3, 3])
    const chain: string[] = []
    const change = a.store.change.bind(a.store)
    a.store.change = ((fn, why) => { if (why && !why.quiet) chain.push(why.action); return change(fn, why) }) as typeof a.store.change
    await splitHere(a.store, a.videoId, a.shots[1].id)
    expect(unitsOf(a)).toEqual(['shot:1', 'new:23'])
    expect(joinBefore(a.store.get(), a.videoId, a.shots[1].id)).toEqual({ kind: 'cut', by: 'human' })
    await joinHere(a.store, a.videoId, a.shots[1].id)
    expect(unitsOf(a)).toEqual(['new:123'])
    expect(chain).toEqual(['split the video between shot 1 and shot 2', 'join shot 1 and shot 2 into one video'])
  })

  it('a selection becomes one video, or separate shots', async () => {
    const a = film([3, 3, 3, 3])
    await joinSelection(a.store, a.videoId, [a.shots[2].id, a.shots[1].id])
    expect(unitsOf(a)).toEqual(['shot:1', 'new:23', 'shot:4'])
    await separateSelection(a.store, a.videoId, [a.shots[1].id, a.shots[2].id])
    expect(unitsOf(a)).toEqual(['shot:1', 'shot:2', 'shot:3', 'shot:4'])
    await separateAll(a.store, a.videoId)
    expect(unitsOf(a)).toEqual(['shot:1', 'shot:2', 'shot:3', 'shot:4'])
    expect(selectionBlock(a.store.get(), a.videoId, [a.shots[0].id, a.shots[2].id])).toBe('Pick shots that sit next to each other')
    expect(selectionBlock(a.store.get(), a.videoId, [a.shots[0].id])).toBe('Pick two shots or more')
  })

  it('a strip Runway refused as one video says so, and Make as separate clips splits it', async () => {
    const a = refusedFilm()
    const d = a.store.get()
    expect(videoUnits(d, { jobs: {} }, a.videoId, videoPlan(d, a.videoId, WAN3))[0]).toMatchObject({ kind: 'strip', state: 'refused', jobId: 'job_r' })
    expect(unitsOf(a)).toEqual(['refused:123'])
    await separateSelection(a.store, a.videoId, a.shots.map((s) => s.id))
    expect(unitsOf(a)).toEqual(['shot:1', 'shot:2', 'shot:3'])
  })

  it("Dex's History line says the words were made plainer, once", () => {
    const why = { action: 'render one take', rationale: 'Dex: one take of three shots.' }
    expect(softenedWhy({ softened: true }, why).rationale).toBe(`${SOFTENED_NOTE} Dex: one take of three shots.`)
    expect(softenedWhy({}, why)).toBe(why)
    const once = softenedWhy({ softened: true }, { ...why, rationale: `Dex: ${SOFTENED_NOTE}` })
    expect(once.rationale).toBe(`Dex: ${SOFTENED_NOTE}`)
  })

  it('says why shots cannot be one video', () => {
    const a = film([3, 3], () => ({}), (d, shots) => { shots[1].refs = [addRef(d, 'bottle', 'front', SHA('f'), 'product').id] })
    expect(selectionBlock(a.store.get(), a.videoId, a.shots.map((s) => s.id))).toBe('Shot 2 shows the product: it starts its own video')
  })

  it('switches a strip to a model that can make it as one video, and says why; separate shots keep the pick', () => {
    const shots = [ps(), ps(), ps(), ps({ sceneId: 's2' })] // 9 s strip, then a lone shot
    const veo = planRuns(shots, VEO_FAST, { takeModel: takeModelFor(VEO_FAST) })
    expect(veo.runs.map((r) => [r.mode, r.model.model, r.switched])).toEqual([['take', 'wan3', 'Veo 3.1 Fast cannot make one video'], ['frames', 'veo3.1_fast', undefined]])
    const long = planRuns([ps(), ps(), ps(), ps()], OMNI, { takeModel: takeModelFor(OMNI) }) // 12 s
    expect(long.runs.map((r) => [r.model.model, r.switched])).toEqual([['wan3', '12 s is longer than Gemini Omni Flash 1.1 makes in one go (10 s)']])
    const short = planRuns([ps({ durationS: 5 }), ps({ durationS: 5 })], OMNI, { takeModel: takeModelFor(OMNI) }) // 10 s: Omni
    expect(short.runs.map((r) => [r.model.model, r.switched])).toEqual([['gemini_omni_flash_1.1', undefined]])
    // Longer than any model's one video: two strips, the first noting it.
    const twenty = planRuns(Array.from({ length: 4 }, () => ps({ durationS: 5 })), OMNI, { takeModel: takeModelFor(OMNI) })
    expect(twenty.runs.map((r) => [r.shotIds.length, !!r.splitAfter])).toEqual([[3, true], [1, false]])
  })
})

describe('the live case (2026-10-19): one shot made alone, then every gap set to One take, on Omni', () => {
  // 6 shots in one scene, shot 6 the end card; shot 1 (and the end card) made alone first.
  async function replay() {
    const a = film([2, 2, 2, 2, 2, 2.5], (i) => (i === 5 ? { kind: 'end_card' as const } : {}), (d, shots) => {
      for (const i of [0, 5]) addTake(d, shots[i], SHA(`${i}`), job(d, 'clip', [], SHA(`${i}`)), { pick: true })
    })
    for (const s of a.shots.slice(1)) await joinHere(a.store, a.videoId, s.id)
    return a
  }

  it('shows shots 1–5 as one strip made as separate clips, the end card on its own', async () => {
    const a = await replay()
    expect(unitsOf(a, OMNI)).toEqual(['separate:12345', 'shot:6'])
  })

  it("the strip's Make as one video sends one take of shots 1–5 on Omni, and nothing for the end card", async () => {
    const a = await replay()
    const strip = videoUnits(a.store.get(), { jobs: {} }, a.videoId, videoPlan(a.store.get(), a.videoId, OMNI))[0]
    expect(strip.kind).toBe('strip')
    await makeClips(a.deps, { videoId: a.videoId, shots: a.shots, ids: strip.kind === 'strip' ? strip.shotIds : [], config: on, join: 'film', modelChoice: omni, busy: skipNone })
    expect(a.submits).toHaveLength(1)
    const [t] = a.submits
    expect(t.input.mode).toBe('take')
    expect(t.input.shots).toHaveLength(5)
    expect(t.input.cuts!.map((c) => c.atS)).toEqual([0, 2, 4, 6, 8])
    expect(t.modelChoice).toEqual(omni)
    // The run made (beside the person's boxes, which are runs they planned).
    expect(Object.values(a.store.get().videos[a.videoId].runs!).find((r) => !!r.job_id)!.shot_ids).toEqual(a.shots.slice(0, 5).map((s) => s.id))
  })

  it('Make all does the same: the end card already has its clip', async () => {
    const a = await replay()
    await makeClips(a.deps, { videoId: a.videoId, shots: a.shots, ids: a.shots.map((s) => s.id), config: on, join: 'film', modelChoice: omni, busy: skipNone })
    expect(a.submits.map((x) => [x.input.mode, x.input.shots?.length])).toEqual([['take', 5]])
  })

  it("a card's Make on shot 3 makes the whole video, never a clip of its own", async () => {
    const a = await replay()
    await makeRuns(a.deps, { videoId: a.videoId, shotIds: [a.shots[2].id], config: on, modelChoice: omni })
    expect(a.submits).toHaveLength(1)
    expect(a.submits[0].input).toMatchObject({ mode: 'take' })
    expect(a.submits[0].input.shots).toHaveLength(5)
    expect(a.submits[0].purpose).toMatchObject({ for: 'run' })
  })

  it('once landed it is one video; the separate clip stays as a version', async () => {
    const a = await replay()
    await makeClips(a.deps, { videoId: a.videoId, shots: a.shots, ids: a.shots.map((s) => s.id), config: on, join: 'film', modelChoice: omni, busy: skipNone })
    const d = structuredClone(a.store.get())
    const runId = Object.entries(d.videos[a.videoId].runs!).find(([, r]) => !!r.job_id)![0]
    applyRunTake(d, { jobId: 'job_1', op: 'clip', provider: 'runway', model: 'gemini_omni_flash_1.1', kind: 'generated', outputs: [{ sha256: SHA('v'), durationS: 10 }] } as unknown as Job, { videoId: a.videoId, runId })
    expect(takesOf(d, a.shots[0].id)).toHaveLength(2)
    expect(videoUnits(d, { jobs: {} }, a.videoId, videoPlan(d, a.videoId, OMNI))[0]).toMatchObject({ kind: 'strip', state: 'made' })
    // A New take now makes the whole video again; Make all leaves it alone.
    const store = new SnapshotDocumentStore(d, null, 0)
    const deps = { ...a.deps, doc: store as never }
    const before = a.submits.length
    await makeClips(deps, { videoId: a.videoId, shots: a.shots, ids: a.shots.map((s) => s.id), config: on, join: 'film', modelChoice: omni, busy: skipNone })
    expect(a.submits.length).toBe(before)
    await makeRuns(deps, { videoId: a.videoId, shotIds: [a.shots[1].id], config: on, modelChoice: omni, again: true })
    expect(a.submits.at(-1)!.input.shots).toHaveLength(5)
  })
})
