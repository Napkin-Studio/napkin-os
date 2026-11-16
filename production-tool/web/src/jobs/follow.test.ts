import { describe, expect, it, vi } from 'vitest'
import { newUlidId, rankBetween } from '../../../clan-store/src'
import type { JobInput, ProductionDocument, Review, Shot } from '../contracts/types'
import { CONFIGS } from '../contracts/load'
import { describeWrite } from '../doc/describe'
import { SnapshotStore, updateDoc } from '../doc/store'
import { initialUi, type UiState } from '../doc/ui'
import { putBlob } from '../lib/blobs'
import { beatsOf, cutItemFor, jobsList, mainVideo, shotsOf } from '../model/selectors'
import { pickTake } from '../stages/videoEdits'
import { MockRelay, type MockRenderer } from '../relay/mock'
import { addKey, addRef, addScene, addShots, note, planned, snapshotDoc } from '../test/jobFixtures'
import { END_CARD_S, adLengthS, makeClip, renderAd, selectedTake, stitchInput } from './clips'
import { fixFrameLanded, fixInShot, fixProgress, remakeFixClip, resumeFixes, shotsBeingFixed } from './fix'
import { beginFollow, cancelFollow, continueFollow, lastWorkedModel, shotsInTheMaking, makeAwaited, planFollow, planFor, planMissing, planWords, restAsTheyAre, startFollow } from './follow'
import { drawFrame, selectedFrame, selectFrame, type FrameDeps } from './frames'
import { landFrame } from './handlers'
import { JobRunner } from './runner'
import { adStatus, anythingStale, editShot, frameDrift, frameStale } from './stale'

/** Takes are never marked out of date (features/make-and-edit.clan): what marks a take would be. */
const takeMarks = (d: ProductionDocument) => Object.values(d.stale).filter((m) => m.target.kind === 'generation')
import { wireJobs } from './wire'

// "Change anything later; update what follows on request" (decided 2026-10-07):
// no text in frames, Fix it in the shot, the ad trimmed to the shots, the
// out-of-date chain, and Update what follows.

const flush = async () => {
  for (let i = 0; i < 30; i++) await new Promise<void>((r) => setImmediate(r))
}

const DIALOGUE = 'Smooth where it shines.'

async function setup(shotCount = 3) {
  let t = 1_000_000
  let renders = 0
  const renderer: MockRenderer = {
    async render(req) {
      renders++
      const mime = req.op === 'clip' || req.op === 'stitch' ? 'video/mp4' : 'image/png'
      return [{ blob: new Blob([`${req.op}-${renders}-${Math.random()}`], { type: mime }), mime, w: 9, h: 16, ...(mime === 'video/mp4' ? { durationS: 6 } : {}) }]
    },
  }
  const relay = new MockRelay({ renderer, now: () => t, delayMs: 2000, persistKey: null })
  const doc = snapshotDoc()
  const recorded: { action: string; rationale?: string }[] = []
  // The CLAN store's record() (a chain entry with no data change); the snapshot store has none.
  Object.assign(doc, { record: async (action: string, rationale?: string) => { recorded.push({ action, ...(rationale ? { rationale } : {}) }) } })
  const ui = new SnapshotStore<UiState>(initialUi())
  const runner = new JobRunner(relay, doc, ui)
  const deps: FrameDeps = { relay, doc, ui, runner }
  wireJobs(deps)

  const script = 'A razor on a marble sink. A hand picks it up. The blade glides. The logo.'
  await updateDoc(doc, (d) => {
    addScene(d, script, 'INT. BATHROOM - DAY')
    addShots(d, Array.from({ length: shotCount }, (_, i) => planned(`Beat ${i + 1}.`, [3, 2, 4, 4, 2][i], {
      ...(i === 1 ? { beats: [{ kind: 'line' as const, at_s: 0.5, text: DIALOGUE, speaker: 'VOICE' }, { kind: 'moment' as const, at_s: 1, text: 'The blade turns.' }] } : {}),
    })))
  })

  /** Every job running now finishes and lands (and any chain moves on). */
  const land = async () => {
    t += 5000
    await runner.pollNow()
    await relay.settled()
    await runner.pollNow()
    await flush()
  }
  const all = () => jobsList(doc.get()).map((j) => ({ id: j.id, op: j.op, state: j.state, ctx: runner.ctx(j.id)! }))
  const running = () => all().filter((r) => !['completed', 'failed', 'cancelled'].includes(r.state))
  /** Land jobs until nothing is running (each landing may start the next step). */
  const settle = async (max = 20) => {
    for (let i = 0; i < max; i++) {
      // A run of Update what follows sends its next step from a completion hook: wait for it, or for the run to end.
      await vi.waitFor(() => expect(running().length > 0 || !ui.get().following).toBe(true), { timeout: 2000, interval: 5 })
      if (!running().length) return
      await land()
    }
  }
  const inputOf = (jobId: string): JobInput => ui.get().jobs[jobId].request!.input
  const shots = () => shotsOf(doc.get())
  const shotId = (i: number) => shots()[i].id
  const frameOf = (i: number) => selectedFrame(doc.get(), shotId(i))!
  const takeOf = (i: number) => selectedTake(doc.get(), shotId(i))!

  /** Frames for every shot, then a clip for every shot, then the ad. */
  const makeAll = async (ad = true) => {
    for (let i = 0; i < shots().length; i++) {
      await drawFrame(deps, i, i === 0 ? 'first' : 'next')
      await land()
    }
    for (let i = 0; i < shots().length; i++) await makeClip(deps, shotId(i))
    await land()
    if (ad) {
      await renderAd(deps)
      await land()
    }
  }
  return { deps, doc, ui, runner, relay, land, settle, all, running, inputOf, shots, shotId, frameOf, takeOf, makeAll, recorded }
}

type Setup = Awaited<ReturnType<typeof setup>>

const marks = (d: ProductionDocument) => Object.values(d.stale)

describe('no text in frames: the spoken lines are voice-over', () => {
  it('a shot with a line keeps it in the document but never sends it to a frame or a clip', async () => {
    const s = await setup(3)
    await s.makeAll(false)
    expect(beatsOf(s.doc.get(), s.shotId(1)).map((b) => b.text)).toContain(DIALOGUE)
    const sent = s.all().filter((j) => j.op === 'frame' || j.op === 'clip')
    expect(sent).toHaveLength(6)
    for (const j of sent) {
      const input = s.inputOf(j.id)
      expect(input.shot, j.op).toBeDefined()
      expect(JSON.stringify(input)).not.toContain(DIALOGUE)
    }
    expect(s.inputOf(sent.find((j) => j.op === 'frame' && j.ctx.for === 'frame' && j.ctx.shotId === s.shotId(1))!.id).shot?.beats)
      .toEqual([{ kind: 'moment', at_s: 1, text: 'The blade turns.' }]) // the moment goes; the line does not
  })

  it('a frame drawn again by Update what follows and a fix clip carry no line either', async () => {
    const s = await setup(3)
    await s.makeAll(false)
    await drawFrame(s.deps, 0, 'again', { parent: s.frameOf(0) })
    await s.land()
    await startFollow(s.deps, undefined, { scope: { kind: 'carry' } }) // the old chain: frames 2 and 3 drawn again
    await s.settle()
    expect(s.all().filter((j) => j.op === 'frame' && j.ctx.followRun)).toHaveLength(2)
    const n = await addNote(s, 1, { region: { x: 0.1, y: 0.7, w: 0.8, h: 0.25 } })
    await fixInShot(s.deps, s.shotId(1), [n])
    await s.land()
    await vi.waitFor(() => expect(s.all().some((j) => j.op === 'clip' && j.ctx.for === 'clip' && j.ctx.reviewIds?.includes(n.id))).toBe(true), { timeout: 2000, interval: 5 })
    for (const j of s.all().filter((x) => x.op === 'frame' || x.op === 'clip')) {
      expect(JSON.stringify(s.inputOf(j.id))).not.toContain(DIALOGUE)
    }
  })
})

describe('a new take', () => {
  it('sends the shot\'s named refs and the model picked in the menu (New take and Fix share makeClip)', async () => {
    const s = await setup(2)
    const front = await putBlob(new Blob(['hero front'], { type: 'image/png' }))
    await updateDoc(s.doc, (d) => {
      const k = addKey(d, 'hero')
      addRef(d, 'hero', 'front', front)
      d.shots[s.shotId(0)].refs = [k.id]
    })
    await s.makeAll(false)
    const pick = { provider: 'runway' as const, model: 'veo3.1_fast' }
    const id = await makeClip(s.deps, s.shotId(0), { parentTake: s.takeOf(0), modelChoice: pick })
    const request = s.ui.get().jobs[id].request!
    expect(request.input.refs?.map((r) => r.name)).toEqual(['hero_front'])
    expect(request.input.shot?.refs).toEqual(['hero'])
    expect(request.modelChoice).toEqual(pick)
    expect(s.runner.ctx(id)).toMatchObject({ for: 'clip', parentTakeId: s.takeOf(0).id })
    expect(s.doc.get().jobs[id].inputs).toContainEqual({ kind: 'generation', ref: s.takeOf(0).id, used_as: 'new version of', included: true })
  })

  it('a take lands as a generation and, in the Video editor, as the shot\'s clip in the main video\'s cut, made by wren', async () => {
    const s = await setup(2)
    await s.makeAll(false)
    const d = s.doc.get()
    const video = mainVideo(d)!
    const items = Object.values(video.timeline)
    expect(items.map((i) => i.follows?.shot_id).sort()).toEqual([s.shotId(0), s.shotId(1)].sort())
    const first = s.takeOf(0)
    expect(first).toMatchObject({ kind: 'clip', crew: 'wren', mock: true, provider: 'mock', duration_s: 6, state: 'ready', shot_ids: [s.shotId(0)] })
    await makeClip(s.deps, s.shotId(0), { parentTake: first })
    await s.land()
    const second = s.takeOf(0)
    expect(second).toMatchObject({ kind: 'change', parent_id: first.id })
    const item = cutItemFor(s.doc.get(), s.shotId(0))!
    expect(item.source?.generation_id).toBe(second.id)
    expect(Object.keys(mainVideo(s.doc.get())!.timeline)).toHaveLength(2) // the same clip, playing the new take
  })
})

async function addNote(s: Setup, shotIndex: number, extra: Partial<Review> = {}): Promise<Review> {
  const take = s.takeOf(shotIndex)
  const r = note({ kind: 'generation', id: take.id }, 'Remove the card that says Dialog', { at_s: 1.2, shot_id: take.shot_ids[0], ...extra })
  await updateDoc(s.doc, (d) => { d.reviews[r.id] = r }, 'comment')
  return r
}

describe('Fix it in the shot', () => {
  it('refuses a fix with no box drawn', async () => {
    const s = await setup(2)
    await s.makeAll(false)
    await expect(fixInShot(s.deps, s.shotId(1), [await addNote(s, 1)])).rejects.toThrow('Draw a box on the paused clip first.')
  })

  it('makes its clip on the model picked in the menu, which the fix keeps (not the routed default)', async () => {
    const s = await setup(2)
    await s.makeAll(false)
    const pick = { provider: 'runway' as const, model: 'veo3.1_fast' }
    const n = await addNote(s, 1, { region: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } })
    const editId = await fixInShot(s.deps, s.shotId(1), [n], pick)
    expect(s.ui.get().jobs[editId]).toMatchObject({ fixModelChoice: pick })
    expect(s.ui.get().jobs[editId].request!.modelChoice).toBeUndefined() // the pick is for the clip, not the frame
    await s.land()
    const clip = await vi.waitFor(() => {
      const c = s.all().find((j) => j.op === 'clip' && j.ctx.for === 'clip' && j.ctx.reviewIds?.includes(n.id))
      expect(c).toBeDefined()
      return c!
    }, { timeout: 2000, interval: 5 })
    expect(s.ui.get().jobs[clip.id].request!.modelChoice).toEqual(pick)
  })

  it('once its frame landed and only its clip failed, Fix makes only the clip, not a second frame edit', async () => {
    const s = await setup(2)
    await s.makeAll(false)
    const n = await addNote(s, 1, { region: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } })
    const ctxOf = (id: string) => s.runner.ctx(id)
    const editId = await fixInShot(s.deps, s.shotId(1), [n])
    expect(fixFrameLanded(s.doc.get(), ctxOf, [n.id])).toBeUndefined() // the frame is still being edited
    await s.land()
    const clip = await vi.waitFor(() => {
      const c = s.all().find((j) => j.op === 'clip' && j.ctx.for === 'clip' && j.ctx.reviewIds?.includes(n.id))
      expect(c).toBeDefined()
      return c!
    }, { timeout: 2000, interval: 5 })
    expect(fixFrameLanded(s.doc.get(), ctxOf, [n.id])).toBeUndefined() // the clip is under way
    await s.runner.cancel(clip.id) // like a provider's 402: the clip step ends without a take
    expect(fixFrameLanded(s.doc.get(), ctxOf, [n.id])).toBe(editId)

    const pick = { provider: 'runway' as const, model: 'veo3.1_fast' }
    const again = await remakeFixClip(s.deps, editId, pick)
    expect(s.all().filter((j) => j.op === 'region_edit')).toHaveLength(1) // the fixed frame is not edited again
    expect(ctxOf(again)).toMatchObject({ for: 'clip', reviewIds: [n.id] })
    expect(ctxOf(again)!.request!.modelChoice).toEqual(pick)
    expect(ctxOf(again)!.request!.input.image?.sha256).toBe(s.frameOf(1).asset) // from the fixed frame
  })

  it('sends the box as the region, with no mask (features/drop-hackathon-extras.clan)', async () => {
    const s = await setup(2)
    await s.makeAll(false)
    const region = { x: 0.1, y: 0.33, w: 0.6, h: 0.33 }
    const editId = await fixInShot(s.deps, s.shotId(1), [await addNote(s, 1, { region })])
    expect(s.inputOf(editId)).not.toHaveProperty('mask')
    expect(s.inputOf(editId).region).toEqual(region)
  })

  it('a boxed note edits the storyboard frame, then makes the clip from the fixed frame, then the note is resolved', async () => {
    const s = await setup(3)
    await s.makeAll(false)
    const oldFrame = s.frameOf(1)
    const oldTake = s.takeOf(1)
    const region = { x: 0.05, y: 0.72, w: 0.9, h: 0.22 }
    const n = await addNote(s, 1, { region })
    const ctxOf = (id: string) => s.runner.ctx(id)

    const editId = await fixInShot(s.deps, s.shotId(1), [n])
    const edit = s.all().find((j) => j.id === editId)!
    expect(edit.op).toBe('region_edit')
    expect(s.doc.get().jobs[editId]).toMatchObject({ crew: 'rhea', purpose: 'frame again' })
    const input = s.inputOf(editId)
    expect(input.image?.sha256).toBe(oldFrame.asset) // the storyboard frame, not the clip
    expect(input.region).toEqual(region) // the box maps across as it is (same framing)
    expect(input.text).toBe(n.text)
    expect(input.previousFrame?.sha256).toBe(s.frameOf(0).asset)
    expect(fixProgress(s.doc.get(), ctxOf, [n.id])).toEqual({ step: 'frame', jobId: editId, running: true })
    expect(s.all().filter((j) => j.op === 'clip' && j.state !== 'completed')).toHaveLength(0) // no clip before the frame

    await s.land() // the fixed frame lands and is picked; the clip starts from it
    const fixed = s.frameOf(1)
    expect(fixed.id).not.toBe(oldFrame.id)
    expect(fixed.parent_id).toBe(oldFrame.id)
    expect(fixed.crew).toBe('rhea')
    await vi.waitFor(() => expect(s.running().map((j) => j.op)).toEqual(['clip']), { timeout: 2000, interval: 5 })
    const clipJob = s.running()[0]
    expect(s.inputOf(clipJob.id).image?.sha256).toBe(fixed.asset)
    expect(clipJob.ctx).toMatchObject({ for: 'clip', shotId: s.shotId(1), parentTakeId: oldTake.id, reviewIds: [n.id] })
    expect(s.inputOf(clipJob.id).text).toBeUndefined() // the boxed note went into the frame
    expect(fixProgress(s.doc.get(), ctxOf, [n.id])).toEqual({ step: 'clip', jobId: clipJob.id, running: true })
    expect(s.doc.get().reviews[n.id].state).toBe('open')

    await s.land()
    const take = s.takeOf(1)
    expect(take.id).not.toBe(oldTake.id)
    expect(take.parent_id).toBe(oldTake.id)
    const r = s.doc.get().reviews[n.id]
    expect(r.state).toBe('resolved')
    expect(r.resolved_by_job).toBe(clipJob.id)
    expect(takeMarks(s.doc.get())).toEqual([]) // takes are never marked
    expect(frameStale(s.doc.get(), s.shotId(2))).toBeUndefined() // one to one: the next frame is not out of date
    expect(frameDrift(s.doc.get(), s.shotId(2))).toBe(2) // only drawn from an older frame 2
  })

  it('makes the clip after a reload when the fixed frame landed while the page was closed', async () => {
    const s = await setup(2)
    await s.makeAll(false)
    const n = await addNote(s, 1, { region: { x: 0, y: 0.7, w: 1, h: 0.3 } })
    await fixInShot(s.deps, s.shotId(1), [n])
    // The page closed just after the fixed frame landed: it is in the document, the clip never started.
    s.runner.onComplete('frame', (job, ctx) => void (ctx.for === 'frame' && landFrame(s.doc, job, ctx)))
    await s.land()
    expect(s.running()).toHaveLength(0)
    wireJobs(s.deps) // boot again
    await resumeFixes(s.deps)
    expect(s.running().map((j) => j.op)).toEqual(['clip'])
    await resumeFixes(s.deps) // a second boot call starts nothing more
    expect(s.running()).toHaveLength(1)
  })
})

describe('the ad is trimmed to the shots', () => {
  it('the stitch request carries trimS = each shot\'s duration_s, in order', async () => {
    const s = await setup(5)
    await s.makeAll(false)
    const { input } = await stitchInput(s.deps)
    expect(input.clips!.map((c) => c.trimS)).toEqual([3, 2, 4, 4, 2])
    expect(input.clips!.map((c) => c.asset.sha256)).toEqual(s.shots().map((_, i) => s.takeOf(i).asset))
    const id = await renderAd(s.deps)
    expect(s.inputOf(id).clips!.map((c) => c.trimS)).toEqual([3, 2, 4, 4, 2])
  })

  it('ad length = the sum of the shots + the 2.5 s end card (the FACET ad: 15 s of shots is 17.5 s, not 21)', () => {
    expect(END_CARD_S).toBe(2.5)
    expect(adLengthS([{ duration_s: 3 }, { duration_s: 2 }, { duration_s: 2 }, { duration_s: 4 }, { duration_s: 4 }])).toBe(17.5)
    expect(adLengthS([{ duration_s: 2.5 }, { duration_s: 4 }])).toBe(9)
  })

  it('the ad lands as a render of the main video, picked, by edie', async () => {
    const s = await setup(2)
    await s.makeAll()
    const d = s.doc.get()
    const video = mainVideo(d)!
    const render = d.renders[video.pick!.current]
    expect(render).toMatchObject({ video_id: video.id, version: 1 })
    expect(d.jobs[render.job_id]).toMatchObject({ op: 'stitch', crew: 'edie', node: { kind: 'video', id: video.id } })
    expect(adStatus(d)).toMatchObject({ ad: render, stale: false })
  })
})

describe('out of date, one to one (features/one-to-one-updates.clan)', () => {
  it('a new frame never marks a take, nor the next frame; going back to the old frame lifts the quiet note', async () => {
    const s = await setup(2)
    await s.makeAll(false)
    const old = s.frameOf(0)
    await drawFrame(s.deps, 0, 'again', { parent: old })
    await s.land()
    expect(takeMarks(s.doc.get())).toEqual([]) // the take keeps what it was made from
    expect(frameStale(s.doc.get(), s.shotId(1))).toBeUndefined() // never the next frame
    expect(frameDrift(s.doc.get(), s.shotId(1))).toBe(1) // a quiet note instead
    await selectFrame(s.doc, s.shotId(0), old.id)
    expect(frameDrift(s.doc.get(), s.shotId(1))).toBeUndefined()
  })

  it('a shot\'s words, framing or refs mark only its own frame; one mark however many edits', async () => {
    const s = await setup(3)
    await s.makeAll(false)
    await updateDoc(s.doc, (d) => editShot(d, s.shotId(1), { action: 'Beat 2, closer.' }), 'edit shot')
    expect(marks(s.doc.get())).toEqual([expect.objectContaining({
      target: { kind: 'frame', id: s.frameOf(1).id }, caused_by: { kind: 'shot', id: s.shotId(1) }, reason: "Shot 2's words changed",
    })])
    await updateDoc(s.doc, (d) => editShot(d, s.shotId(1), { action: 'Beat 2, closer still.' }), 'edit shot')
    await updateDoc(s.doc, (d) => editShot(d, s.shotId(1), { camera: { ...d.shots[s.shotId(1)].camera, size: 'over_shoulder' } }), 'edit shot')
    expect(marks(s.doc.get())).toHaveLength(1) // replaced, not appended
    expect(frameStale(s.doc.get(), s.shotId(1))?.reason).toBe("Shot 2's framing changed")
    await updateDoc(s.doc, (d) => editShot(d, s.shotId(2), { refs: [addKey(d, 'hero').id] }), 'edit shot')
    expect(frameStale(s.doc.get(), s.shotId(2))?.reason).toBe("Shot 3's refs changed")
    expect(takeMarks(s.doc.get())).toEqual([]) // takes are never marked
    expect(frameStale(s.doc.get(), s.shotId(0))).toBeUndefined()
    await updateDoc(s.doc, (d) => editShot(d, s.shotId(0), { action: 'Beat 1.' }), 'edit shot') // the same words: nothing changed
    expect(frameStale(s.doc.get(), s.shotId(0))).toBeUndefined()
  })

  it('a camera move or length marks nothing: it changes the next take only', async () => {
    const s = await setup(3)
    await s.makeAll(false)
    await updateDoc(s.doc, (d) => editShot(d, s.shotId(0), { camera: { ...d.shots[s.shotId(0)].camera, movement: 'orbit' } }), 'edit shot')
    await updateDoc(s.doc, (d) => editShot(d, s.shotId(2), { duration_s: 3 }), 'edit shot')
    expect(frameStale(s.doc.get(), s.shotId(0))).toBeUndefined()
    expect(frameStale(s.doc.get(), s.shotId(2))).toBeUndefined()
    expect(marks(s.doc.get())).toEqual([])
  })

  it('a frame redrawn from the current words lifts its mark and marks no take', async () => {
    const s = await setup(3)
    await s.makeAll(false)
    await updateDoc(s.doc, (d) => editShot(d, s.shotId(1), { action: 'Beat 2, closer.' }), 'edit shot')
    const id = await drawFrame(s.deps, 1, 'again', { parent: s.frameOf(1) })
    expect(s.inputOf(id).shot?.action).toBe('Beat 2, closer.')
    await s.land()
    expect(frameStale(s.doc.get(), s.shotId(1))).toBeUndefined()
    expect(frameStale(s.doc.get(), s.shotId(2))).toBeUndefined()
    expect(takeMarks(s.doc.get())).toEqual([])
  })

  it('a new clip made from the current frame lands beside the old one, and nothing is marked', async () => {
    const s = await setup(2)
    await s.makeAll(false)
    const old = s.takeOf(0)
    await drawFrame(s.deps, 0, 'again', { parent: s.frameOf(0) })
    await s.land()
    await makeClip(s.deps, s.shotId(0), { parentTake: old })
    await s.land()
    expect(s.doc.get().generations[old.id]).toBeDefined()
    expect(takeMarks(s.doc.get())).toEqual([])
  })

  it('clip → ad: a new clip, or picking another, puts the ad out of date; picking the old one back clears it', async () => {
    const s = await setup(2)
    await s.makeAll()
    expect(adStatus(s.doc.get())).toMatchObject({ stale: false })
    const old = s.takeOf(1)
    await makeClip(s.deps, s.shotId(1), { parentTake: old })
    await s.land()
    expect(adStatus(s.doc.get())).toMatchObject({ stale: true, reason: "Shot 2's clip changed", shotId: s.shotId(1) })
    await updateDoc(s.doc, (d) => pickTake(d, old.shot_ids[0], old.id), 'pick take')
    expect(adStatus(s.doc.get()).stale).toBe(false)
  })

  it('adding a shot puts the ad out of date; deleting one puts the ad out of date but not the next shot\'s frame; putting it back clears it', async () => {
    const s = await setup(3)
    await s.makeAll()
    const added = newUlidId('shot')
    await updateDoc(s.doc, (d) => {
      const sb = s.shots()[0].storyboard_id
      d.shots[added] = { id: added, v: 1, field_v: {}, storyboard_id: sb, rank: rankBetween(s.shots().at(-1)!.rank, null), kind: 'shot', duration_s: 2, camera: { size: 'medium' }, status: 'planned', action: 'The logo.' }
    }, 'add shot')
    expect(adStatus(s.doc.get())).toMatchObject({ stale: true, reason: 'Shot 4 has no clip in it' })
    await updateDoc(s.doc, (d) => { delete d.shots[added] }, 'delete shot')
    expect(adStatus(s.doc.get()).stale).toBe(false)

    const third = s.frameOf(2)
    const second: Shot = structuredClone(s.doc.get().shots[s.shotId(1)])
    await updateDoc(s.doc, (d) => { delete d.shots[second.id] }, 'delete shot')
    expect(s.frameOf(1).id).toBe(third.id)
    expect(marks(s.doc.get())).toEqual([]) // its own shot did not change (features/one-to-one-updates.clan)
    expect(adStatus(s.doc.get())).toMatchObject({ stale: true, reason: 'A shot was deleted' })
    await updateDoc(s.doc, (d) => { d.shots[second.id] = second }, 'create again shot')
    expect(marks(s.doc.get())).toEqual([])
    expect(adStatus(s.doc.get()).stale).toBe(false)
  })

  it('reordering the shots puts the ad out of date; putting them back clears it (features/video-stage-findings.clan)', async () => {
    const s = await setup(3)
    await s.makeAll()
    expect(adStatus(s.doc.get()).stale).toBe(false)
    const swap = () => updateDoc(s.doc, (d) => {
      const [a, b] = [d.shots[s.shotId(0)], d.shots[s.shotId(1)]];
      [a.rank, b.rank] = [b.rank, a.rank]
    }, 'move shot')
    await swap()
    expect(adStatus(s.doc.get())).toMatchObject({ stale: true, reason: 'The shots were reordered' })
    await swap()
    expect(adStatus(s.doc.get()).stale).toBe(false)
  })
})

describe('Update what follows', () => {


  it('plans only what is out of date itself, in shot order, then the ad; carrying forward plans the old chain', async () => {
    const s = await setup(4)
    await s.makeAll()
    expect(planFollow(s.doc.get())).toEqual({ frames: [], clips: [], ad: false })
    await drawFrame(s.deps, 1, 'again', { parent: s.frameOf(1) })
    await s.land()
    // One to one: only shot 2's clip (its frame changed), then the ad it feeds.
    const plan = planFollow(s.doc.get())
    expect(plan).toEqual({ frames: [], clips: [s.shotId(1)], ad: true })
    expect(planWords(plan)).toBe('1 clip, 1 ad')  // no price (owner, 2026-10-13)
    // Carry forward: frames 3 and 4 follow frame 2; clips for shots 2-4 (2's frame changed); then the ad.
    const carry = planFor(s.doc.get(), { kind: 'carry' })
    expect(carry).toEqual({ frames: [s.shotId(2), s.shotId(3)], clips: [s.shotId(1), s.shotId(2), s.shotId(3)], ad: true })
    expect(planWords(carry)).toBe('2 frames, 3 clips, 1 ad')
  })

  it('edits plan their own frames in shot order (a camera move plans nothing: it is for the next take); not made yet is a plan of its own', async () => {
    const s = await setup(4)
    await s.makeAll()
    await updateDoc(s.doc, (d) => editShot(d, s.shotId(2), { action: 'Beat 3, slower.' }), 'edit shot')
    await updateDoc(s.doc, (d) => editShot(d, s.shotId(0), { camera: { ...d.shots[s.shotId(0)].camera, movement: 'orbit' } }), 'edit shot')
    await updateDoc(s.doc, (d) => editShot(d, s.shotId(3), { action: 'Beat 4, the logo.' }), 'edit shot')
    expect(planFollow(s.doc.get())).toEqual({ frames: [s.shotId(2), s.shotId(3)], clips: [], ad: false })
    expect(planMissing(s.doc.get())).toEqual({ frames: [], clips: [], ad: false })
    // Carry forward from the first out-of-date frame: frames 3-4, their clips, the ad.
    expect(planFor(s.doc.get(), { kind: 'carry' })).toEqual({ frames: [s.shotId(2), s.shotId(3)], clips: [s.shotId(2), s.shotId(3)], ad: true })
    // A card: this one, or this and those after.
    expect(planFor(s.doc.get(), { kind: 'one', item: { kind: 'frame', shotId: s.shotId(2) } })).toEqual({ frames: [s.shotId(2)], clips: [], ad: false })
    expect(planFor(s.doc.get(), { kind: 'after', item: { kind: 'frame', shotId: s.shotId(1) } })).toEqual({ frames: [s.shotId(1), s.shotId(2), s.shotId(3)], clips: [], ad: false })
    expect(planFor(s.doc.get(), { kind: 'after', item: { kind: 'clip', shotId: s.shotId(2) } })).toEqual({ frames: [], clips: [s.shotId(2), s.shotId(3)], ad: true })
  })

  it('a run of what is out of date makes only those items: the frame (a length is for the next take); its clip is offered next', async () => {
    const s = await setup(4)
    await s.makeAll()
    await updateDoc(s.doc, (d) => editShot(d, s.shotId(2), { action: 'Beat 3, slower.' }), 'edit shot')
    await updateDoc(s.doc, (d) => editShot(d, s.shotId(0), { duration_s: 2 }), 'edit shot')
    await startFollow(s.deps)
    await s.settle()
    const ran = s.all().filter((j) => j.ctx?.followRun)
    const where = (j: (typeof ran)[number]) => `${j.op}:${'shotId' in j.ctx ? s.shots().findIndex((x) => x.id === (j.ctx as { shotId: string }).shotId) + 1 : ''}`
    expect(ran.map(where)).toEqual(['frame:3'])
    expect(frameStale(s.doc.get(), s.shotId(2))).toBeUndefined() // drawn from the current words
    expect(frameStale(s.doc.get(), s.shotId(3))).toBeUndefined() // frame 4 was never touched
    expect(frameDrift(s.doc.get(), s.shotId(3))).toBe(3) // only the quiet note
    // Clip 3 is now behind its new frame: asked for next, not made behind the user's back.
    expect(planFollow(s.doc.get())).toEqual({ frames: [], clips: [s.shotId(2)], ad: true })
  })

  it('a steered plan of more than one item is shown first; nothing is sent until Start, and Cancel makes nothing', async () => {
    const s = await setup(3)
    await s.makeAll(false)
    await updateDoc(s.doc, (d) => editShot(d, s.shotId(1), { action: 'Beat 2, slower.' }), 'edit shot')
    await updateDoc(s.doc, (d) => editShot(d, s.shotId(2), { action: 'Beat 3, slower.' }), 'edit shot')
    const before = s.all().length
    await startFollow(s.deps, CONFIGS.testing, { steer: true })
    expect(s.ui.get().following).toMatchObject({ reviewing: true, frameShots: [s.shotId(1), s.shotId(2)], total: 2 })
    expect(s.ui.get().following?.awaiting).toBeUndefined()
    expect(s.all()).toHaveLength(before)
    await cancelFollow(s.deps)
    expect(s.ui.get().following).toBeUndefined()
    expect(s.recorded).toEqual([]) // nothing made, nothing in the chain
    await startFollow(s.deps, CONFIGS.testing, { steer: true })
    await beginFollow(s.deps)
    expect(s.ui.get().following?.awaiting).toEqual({ kind: 'frame', shotId: s.shotId(1) })
    // One item goes straight to the box: there is no plan to check.
    await cancelFollow(s.deps)
    await s.settle()
    await startFollow(s.deps, CONFIGS.testing, { steer: true, scope: { kind: 'one', item: { kind: 'frame', shotId: s.shotId(2) } } })
    expect(s.ui.get().following).toMatchObject({ awaiting: { kind: 'frame', shotId: s.shotId(2) }, total: 1 })
    expect(s.ui.get().following?.reviewing).toBeUndefined()
  })

  it('"Carry the look forward" from a frame runs the old chain from it: that frame and every one after, their clips, the ad', async () => {
    const s = await setup(4)
    await s.makeAll()
    await drawFrame(s.deps, 1, 'again', { parent: s.frameOf(1) })
    await s.land()
    expect(frameDrift(s.doc.get(), s.shotId(2))).toBe(2)
    await startFollow(s.deps, undefined, { scope: { kind: 'carry', from: s.shotId(2) } })
    await s.settle()
    const ran = s.all().filter((j) => j.ctx?.followRun)
    expect(ran.map((j) => j.op)).toEqual(['frame', 'frame', 'clip', 'clip', 'clip', 'stitch'])
    expect(frameDrift(s.doc.get(), s.shotId(2))).toBeUndefined()
    expect(frameDrift(s.doc.get(), s.shotId(3))).toBeUndefined()
    expect(anythingStale(s.doc.get())).toBe(false)
  })

  it('steered: each item waits in the box; Make it sends its words and model, and the new one replaces the old once it lands', async () => {
    const s = await setup(2)
    await s.makeAll(false)
    await drawFrame(s.deps, 0, 'again', { parent: s.frameOf(0) })
    await s.land() // shot 1's frame changed: carrying the look forward redraws frame 2, then both clips
    const both = { ...CONFIGS.testing, routing: { ...CONFIGS.testing.routing, clip: ['runway', 'mock'] as const } } as unknown as typeof CONFIGS.testing
    const before = s.all().length
    await startFollow(s.deps, both, { steer: true, scope: { kind: 'carry' } })
    expect(s.ui.get().following?.reviewing).toBe(true) // the plan first
    await beginFollow(s.deps)
    expect(s.all()).toHaveLength(before) // nothing is sent until the user says so
    expect(s.ui.get().following?.awaiting).toEqual({ kind: 'frame', shotId: s.shotId(1) })
    const oldFrame = s.frameOf(1)

    const veo = { provider: 'runway' as const, model: 'veo3.1_fast' }
    const id = (await makeAwaited(s.deps, { text: 'no flames', modelChoice: null }))!
    expect(s.inputOf(id).text).toBe('no flames') // the words go to this request only
    expect(s.doc.get().shots[s.shotId(1)].action).not.toContain('no flames') // never into the script
    expect(s.frameOf(1).id).toBe(oldFrame.id) // the old frame stays until the new one lands
    await s.land()
    await vi.waitFor(() => expect(s.ui.get().following?.awaiting).toEqual({ kind: 'clip', shotId: s.shotId(0) }), { timeout: 2000, interval: 5 })
    expect(s.frameOf(1).id).not.toBe(oldFrame.id)
    expect(s.doc.get().frames[oldFrame.id]).toBeUndefined() // replaced, not stacked

    const clipId = (await makeAwaited(s.deps, { modelChoice: veo }))!
    expect(s.ui.get().jobs[clipId].request!.modelChoice).toEqual(veo)
    expect(s.ui.get().following?.models?.clip).toEqual(veo) // the box's pick is kept for the rest
  })

  it('steered: a failed item keeps its old version and waits, to be made again on another model', async () => {
    const s = await setup(1)
    await s.makeAll(false)
    await drawFrame(s.deps, 0, 'again', { parent: s.frameOf(0) })
    await s.land()
    await startFollow(s.deps, CONFIGS.testing, { steer: true })
    expect(s.ui.get().following?.awaiting).toEqual({ kind: 'clip', shotId: s.shotId(0) })
    const oldTake = s.takeOf(0)
    const first = (await makeAwaited(s.deps))!
    await s.runner.cancel(first) // like a provider out of credit
    await continueFollow(s.deps)
    expect(s.ui.get().following?.awaiting).toEqual({ kind: 'clip', shotId: s.shotId(0) }) // back in the box
    expect(s.takeOf(0).id).toBe(oldTake.id) // the old clip is still there
    const veo = { provider: 'runway' as const, model: 'veo3.1_fast' }
    const second = (await makeAwaited(s.deps, { modelChoice: veo }))!
    expect(s.ui.get().jobs[first].dismissed).toBe(true)
    expect(s.ui.get().jobs[second].request!.modelChoice).toEqual(veo)
  })

  it('"Do the rest as they are" makes this and every later item on the box\'s models, then renders the ad by itself', async () => {
    const s = await setup(2)
    await s.makeAll()
    await drawFrame(s.deps, 0, 'again', { parent: s.frameOf(0) })
    await s.land()
    await startFollow(s.deps, CONFIGS.testing, { steer: true, scope: { kind: 'carry' } })
    await beginFollow(s.deps)
    expect(s.ui.get().following?.awaiting).toEqual({ kind: 'frame', shotId: s.shotId(1) })
    await restAsTheyAre(s.deps)
    await s.settle()
    expect(s.ui.get().following).toBeUndefined()
    expect(anythingStale(s.doc.get())).toBe(false)
    const ran = s.all().filter((j) => j.ctx?.followRun)
    expect(ran.map((j) => j.op)).toEqual(['frame', 'clip', 'clip', 'stitch'])
    expect(Object.values(s.doc.get().frames).filter((f) => f.shot_id === s.shotId(1))).toHaveLength(1) // each old one replaced
  })

  it('"Do them as they are" on a plan shown first makes the plan\'s items: one to one, only the clip and the ad', async () => {
    const s = await setup(2)
    await s.makeAll()
    await drawFrame(s.deps, 0, 'again', { parent: s.frameOf(0) })
    await s.land()
    await startFollow(s.deps, CONFIGS.testing, { steer: true })
    expect(s.ui.get().following).toMatchObject({ reviewing: true, clipShots: [s.shotId(0)], ad: true })
    await restAsTheyAre(s.deps)
    await s.settle()
    expect(s.ui.get().following).toBeUndefined()
    expect(anythingStale(s.doc.get())).toBe(false)
    const ran = s.all().filter((j) => j.ctx?.followRun)
    expect(ran.map((j) => j.op)).toEqual(['clip', 'stitch'])
    expect(frameDrift(s.doc.get(), s.shotId(1))).toBe(1) // frame 2 is left as it is: a quiet note
  })

  it('the box starts on the last model that worked for the step, not on one that just failed', async () => {
    const s = await setup(1)
    await s.makeAll(false)
    const both = { ...CONFIGS.testing, routing: { ...CONFIGS.testing.routing, clip: ['runway', 'mock'] as const } } as unknown as typeof CONFIGS.testing
    await updateDoc(s.doc, (d) => {
      const clip = jobsList(d).filter((j) => j.op === 'clip').at(-1)!
      Object.assign(clip, { provider: 'runway', model: 'veo3.1_fast', state: 'completed' })
      const id = newUlidId('job')
      d.jobs[id] = { ...clip, id, provider: 'runway', model: 'veo3.1', state: 'failed', created_at: new Date(Date.now() + 1000).toISOString() }
    })
    expect(lastWorkedModel(s.doc.get(), 'clip', both)).toEqual({ provider: 'runway', model: 'veo3.1_fast' })
  })

  it('leaves out a clip that is being made now: it is not behind', async () => {
    // 2026-10-09: four first clips in the making showed as "4 behind your changes".
    const s = await setup(3)
    await s.makeAll(false)
    await updateDoc(s.doc, (d) => {
      for (const g of Object.values(d.generations)) if (!g.shot_ids.includes(s.shotId(0))) delete d.generations[g.id]
      for (const v of Object.values(d.videos)) for (const [id, it] of Object.entries(v.timeline)) if (it.follows?.shot_id !== s.shotId(0)) delete v.timeline[id]
    })
    const owed = planMissing(s.doc.get())
    expect(owed.clips).toEqual([s.shotId(1), s.shotId(2)])
    expect(planFollow(s.doc.get()).clips).toEqual([]) // not made yet is never counted as out of date
    const making = shotsInTheMaking(s.doc.get(), () => undefined)
    expect(making.clips.size).toBe(0)
    expect(planMissing(s.doc.get(), new Set([s.shotId(1), s.shotId(2)])).clips).toEqual([])
  })

  it('starts on a real provider, not on mock, when one is offered', async () => {
    // 2026-10-09: mock stills were the last clips that "worked", so an update run sent clips to mock again.
    const s = await setup(1)
    await s.makeAll(false)
    const both = { ...CONFIGS.testing, routing: { ...CONFIGS.testing.routing, clip: ['mock', 'runway'] as const } } as unknown as typeof CONFIGS.testing
    await updateDoc(s.doc, (d) => {
      for (const j of Object.values(d.jobs)) if (j.op === 'clip') Object.assign(j, { provider: 'mock', model: 'mock', state: 'completed' })
    })
    expect(lastWorkedModel(s.doc.get(), 'clip', both)?.provider).toBe('runway')
    const mockOnly = { ...CONFIGS.testing, routing: { ...CONFIGS.testing.routing, clip: ['mock'] as const } } as unknown as typeof CONFIGS.testing
    expect(lastWorkedModel(s.doc.get(), 'clip', mockOnly)?.provider).toBe('mock') // nothing real offered: mock still answers
  })

  it('leaves a shot that a fix is redoing alone: not out of date in the plan while the fix runs', async () => {
    const s = await setup(2)
    await s.makeAll(false)
    const n = await addNote(s, 1, { region: { x: 0.1, y: 0.1, w: 0.4, h: 0.4 } })
    await fixInShot(s.deps, s.shotId(1), [n])
    await s.land() // the fixed frame lands; the fix's clip is running and shot 2's old clip is marked
    await vi.waitFor(() => expect(s.all().some((j) => j.op === 'clip' && j.state !== 'completed')).toBe(true), { timeout: 2000, interval: 5 })
    const fixing = shotsBeingFixed(s.doc.get(), (id) => s.runner.ctx(id))
    expect([...fixing]).toEqual([s.shotId(1)])
    expect(planFollow(s.doc.get(), fixing).clips).not.toContain(s.shotId(1))
  })

  it('a failed job can be sent again on another model (the error card\'s "Try another model")', async () => {
    const s = await setup(1)
    await s.makeAll(false)
    const id = await makeClip(s.deps, s.shotId(0), { parentTake: s.takeOf(0) })
    await s.runner.cancel(id) // like a provider out of credit: the step ended without a clip
    const veo = { provider: 'runway' as const, model: 'veo3.1_fast' }
    const again = (await s.runner.retry(id, veo))!
    expect(s.ui.get().jobs[again].request!.modelChoice).toEqual(veo)
    expect(s.runner.ctx(again)).toMatchObject({ for: 'clip', parentTakeId: s.takeOf(0).id })
    expect(s.ui.get().jobs[id]).toMatchObject({ dismissed: true, retriedAs: again })
    expect(s.doc.get().jobs[again].nonce).not.toBe(s.doc.get().jobs[id].nonce) // another take, never deduped
    await s.runner.cancel(again)
    const routed = (await s.runner.retry(again, null))! // the routed default this time
    expect(s.ui.get().jobs[routed].request!.modelChoice).toBeUndefined()
  })

  it('carrying forward runs frames one at a time in order, then the clips, then the ad, and writes one chain entry', async () => {
    const s = await setup(4)
    await s.makeAll()
    await drawFrame(s.deps, 1, 'again', { parent: s.frameOf(1) })
    await s.land()
    const before = Object.keys(s.doc.get().jobs).length
    const framesBefore = Object.keys(s.doc.get().frames).length

    await startFollow(s.deps, undefined, { scope: { kind: 'carry' } })
    const order: string[] = []
    for (let i = 0; i < 10; i++) {
      // The next step is sent from a completion hook: wait for it, or for the run to end.
      await vi.waitFor(() => expect(s.running().length > 0 || !s.ui.get().following).toBe(true), { timeout: 2000, interval: 5 })
      if (!s.running().length) break
      expect(s.running()).toHaveLength(1) // one at a time
      const j = s.running()[0]
      order.push(`${j.op}:${'shotId' in j.ctx ? s.shots().findIndex((x) => x.id === (j.ctx as { shotId: string }).shotId) + 1 : ''}`)
      if (j.op === 'frame') {
        const k = s.shots().findIndex((x) => x.id === (j.ctx as { shotId: string }).shotId)
        expect(s.inputOf(j.id).previousFrame?.sha256).toBe(s.frameOf(k - 1).asset) // from the frame drawn just before
        expect(s.inputOf(j.id).anchorFrame?.sha256).toBe(s.frameOf(0).asset)
      }
      await s.land()
    }
    expect(order).toEqual(['frame:3', 'frame:4', 'clip:2', 'clip:3', 'clip:4', 'stitch:'])
    expect(Object.keys(s.doc.get().jobs).length).toBe(before + 6)
    expect(Object.keys(s.doc.get().frames).length).toBe(framesBefore) // each new frame replaced the one it updated (2026-10-09)
    expect(anythingStale(s.doc.get())).toBe(false)
    expect(adStatus(s.doc.get()).stale).toBe(false)
    expect(s.ui.get().following).toBeUndefined()
    expect(s.recorded.at(-1)!.action).toBe('render what follows: 2 frames, 3 clips, ad')
  })

  it('the chain names each step of a carried-forward run', async () => {
    const s = await setup(3)
    await s.makeAll()
    await drawFrame(s.deps, 1, 'again', { parent: s.frameOf(1) })
    await s.land()
    let prev = s.doc.get()
    const said: string[] = []
    s.doc.subscribe(() => {
      const now = s.doc.get()
      const d = describeWrite('submit job', prev, now)
      if (d && Object.keys(now.jobs).length > Object.keys(prev.jobs).length) said.push(d.action)
      prev = now
    })
    await startFollow(s.deps, undefined, { scope: { kind: 'carry' } })
    await s.settle()
    expect(said).toEqual(['start frame for shot 3', 'start clip for shot 2', 'start clip for shot 3', 'start the ad render'])
  })

  it('Stop finishes the job running now and starts nothing more', async () => {
    const s = await setup(4)
    await s.makeAll()
    await drawFrame(s.deps, 1, 'again', { parent: s.frameOf(1) })
    await s.land()
    await startFollow(s.deps, undefined, { scope: { kind: 'carry' } })
    expect(s.running()).toHaveLength(1)
    await cancelFollow(s.deps)
    expect(s.ui.get().following?.cancel).toBe(true)
    expect(s.running()).toHaveLength(1) // not cancelled at the provider
    const jobs = Object.keys(s.doc.get().jobs).length
    await s.land()
    await vi.waitFor(() => expect(s.ui.get().following).toBeUndefined(), { timeout: 2000, interval: 5 })
    expect(Object.keys(s.doc.get().jobs).length).toBe(jobs) // nothing new started
    expect(s.recorded.at(-1)!.action).toBe('set the update stopped after 1 frame')
    expect(frameDrift(s.doc.get(), s.shotId(3))).toBe(3) // what is left stays as it was: frame 4 is still drawn from the older frame 3
    expect(takeMarks(s.doc.get())).toEqual([]) // and no take is marked, though clip 3's frame is new
  })

  it('resumes after a reload, and waits on a failed step until it is retried', async () => {
    const s = await setup(3)
    await s.makeAll()
    await drawFrame(s.deps, 0, 'again', { parent: s.frameOf(0) })
    await s.land()
    await startFollow(s.deps, undefined, { scope: { kind: 'carry' } })
    // The page reloads while frame 2 is drawing: the run is in the UI snapshot; boot calls continueFollow.
    await continueFollow(s.deps)
    expect(s.running()).toHaveLength(1) // nothing doubled
    s.runner.onComplete('frame', (job, ctx) => void (ctx.for === 'frame' && landFrame(s.doc, job, ctx))) // closed as it landed
    await s.land()
    expect(s.running()).toHaveLength(0)
    wireJobs(s.deps)
    await continueFollow(s.deps) // boot
    expect(s.running().map((j) => j.op)).toEqual(['frame']) // frame 3

    // Frame 3's request fails: the run waits (it does not skip it), and a retry moves it on.
    const failing = s.running()[0]
    s.ui.update((u) => { u.jobs[failing.id].request!.input.text = '#fail' })
    await s.runner.cancel(failing.id)
    await continueFollow(s.deps)
    expect(s.running()).toHaveLength(0)
    expect(s.ui.get().following).toBeDefined()
    s.ui.update((u) => { delete u.jobs[failing.id].request!.input.text })
    await s.runner.retry(failing.id)
    await s.settle()
    expect(s.ui.get().following).toBeUndefined()
    expect(anythingStale(s.doc.get())).toBe(false)
    expect(s.recorded.at(-1)!.action).toBe('render what follows: 2 frames, 3 clips, ad')
  })
})
