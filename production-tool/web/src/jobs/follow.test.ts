import { describe, expect, it, vi } from 'vitest'
import type { JobInput, Review } from '../contracts/types'
import { CONFIGS } from '../contracts/load'
import { describeWrite } from '../doc/describe'
import { deleteFrom, removeShot, restoreTo } from '../doc/remove'
import { emptyDocument, SnapshotDocumentStore, SnapshotStore, updateDoc } from '../doc/store'
import { initialUi, type UiState } from '../doc/ui'
import { putBlob } from '../lib/blobs'
import { newId } from '../lib/ulid'
import { MockRelay, mockShotList, type MockRenderer } from '../relay/mock'
import { effectiveConfig } from '../capabilities'
import { END_CARD_S, adLengthS, makeClip, renderAd, selectedTake, stitchInput } from './clips'
import { fixFrameLanded, fixInShot, fixProgress, remakeFixClip, resumeFixes, shotsBeingFixed } from './fix'
import { cancelFollow, continueFollow, lastWorkedModel, shotsInTheMaking, makeAwaited, planCost, planFollow, planSummary, restAsTheyAre, startFollow } from './follow'
import { drawFrame, selectedFrame, selectFrame, type FrameDeps } from './frames'
import { JobRunner } from './runner'
import { applyFrame } from './handlers'
import { adStatus, anythingStale, frameStale, takeStale } from './stale'
import { wireJobs } from './wire'
import { boxMaskPng } from '../lib/mask'

// Node has no canvas: the box mask is a stand-in blob that records what it was asked for.
vi.mock('../lib/mask', async (original) => ({
  ...(await original<typeof import('../lib/mask')>()),
  boxMaskPng: vi.fn(async (r: unknown, w: number, h: number) => new Blob([`mask ${w}x${h} ${JSON.stringify(r)}`], { type: 'image/png' })),
}))

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
  const doc = new SnapshotDocumentStore(emptyDocument({ id: 'p_test01', handle: 'maya' }), null, 0)
  const recorded: { action: string; rationale?: string }[] = []
  // The CLAN store's record() (a chain entry with no data change); the snapshot store has none.
  Object.assign(doc, { record: async (action: string, rationale?: string) => { recorded.push({ action, ...(rationale ? { rationale } : {}) }) } })
  const ui = new SnapshotStore<UiState>(initialUi())
  const runner = new JobRunner(relay, doc, ui)
  const deps: FrameDeps = { relay, doc, ui, runner }
  wireJobs(deps)

  const script = 'A razor on a marble sink. A hand picks it up. The blade glides. The logo.'
  await updateDoc(doc, (d) => {
    const rev = newId('rev')
    d.script = { current: rev, revisions: [{ id: rev, created_at: new Date().toISOString(), imported_text: script, target_s: 15, status: 'draft' }] }
    const base = mockShotList(script, 15)[0]
    d.shots = Array.from({ length: shotCount }, (_, i) => ({
      ...base, id: newId('shot'), order: i + 1, duration_s: [3, 2, 4, 4, 2][i], action: `Beat ${i + 1}.`,
      ...(i === 1 ? { dialogue: DIALOGUE } : {}),
    }))
  })

  /** Every job running now finishes and lands (and any chain moves on). */
  const land = async () => {
    t += 5000
    await runner.pollNow()
    await relay.settled()
    await runner.pollNow()
    await flush()
  }
  const all = () => doc.get().jobs.map((j) => ({ id: j.id, op: j.op, state: j.state, ctx: ui.get().jobCtx[j.id] }))
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
  const inputOf = (jobId: string): JobInput => ui.get().jobCtx[jobId].request.input
  const shotId = (i: number) => doc.get().shots![i].id
  const frameOf = (i: number) => selectedFrame(doc.get(), shotId(i))!
  const takeOf = (i: number) => selectedTake(doc.get(), shotId(i))!

  /** Frames for every shot, then a clip for every shot, then the ad. */
  const makeAll = async (ad = true) => {
    for (let i = 0; i < doc.get().shots!.length; i++) {
      await drawFrame(deps, i, i === 0 ? 'first' : 'next')
      await land()
    }
    for (let i = 0; i < doc.get().shots!.length; i++) await makeClip(deps, shotId(i))
    await land()
    if (ad) {
      await renderAd(deps)
      await land()
    }
  }
  return { deps, doc, ui, runner, relay, land, settle, all, running, inputOf, shotId, frameOf, takeOf, makeAll, recorded }
}

describe('no text in frames: the dialogue is voice-over', () => {
  it('a shot with a dialogue line keeps it in the document but never sends it to a frame or a clip', async () => {
    const s = await setup(3)
    await s.makeAll(false)
    expect(s.doc.get().shots![1].dialogue).toBe(DIALOGUE)
    const sent = s.all().filter((j) => j.op === 'frame' || j.op === 'clip')
    expect(sent).toHaveLength(6)
    for (const j of sent) {
      const input = s.inputOf(j.id)
      expect(input.shot, j.op).toBeDefined()
      expect(input.shot).not.toHaveProperty('dialogue')
      expect(JSON.stringify(input)).not.toContain(DIALOGUE)
    }
  })

  it('a frame drawn again by Update what follows and a fix clip carry no dialogue either', async () => {
    const s = await setup(3)
    await s.makeAll(false)
    await drawFrame(s.deps, 0, 'again', { parent: s.frameOf(0) })
    await s.land()
    await startFollow(s.deps)
    await s.settle()
    const note = await addNote(s, 1, { region: { x: 0.1, y: 0.7, w: 0.8, h: 0.25 } })
    await fixInShot(s.deps, s.shotId(1), [note])
    await s.land()
    await vi.waitFor(() => expect(s.all().some((j) => j.op === 'clip' && j.ctx.for === 'clip' && j.ctx.reviewIds?.includes(note.id))).toBe(true), { timeout: 2000, interval: 5 })
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
      d.keys.push({ key: 'hero', role: 'character' })
      d.refs.push({ id: newId('ref'), key: 'hero', variant: 'front', asset: front, node: newId('node') })
      d.shots![0].refs = ['hero']
    })
    await s.makeAll(false)
    const pick = { provider: 'fal' as const, model: 'veo3.1-fast-i2v' }
    const id = await makeClip(s.deps, s.shotId(0), { parentTake: s.takeOf(0), modelChoice: pick })
    const request = s.ui.get().jobCtx[id].request
    expect(request.input.refs?.map((r) => r.name)).toEqual(['hero_front'])
    expect(request.input.shot).not.toHaveProperty('dialogue')
    expect(request.modelChoice).toEqual(pick)
    expect(s.ui.get().jobCtx[id]).toMatchObject({ for: 'clip', parentTakeId: s.takeOf(0).id })
  })
})

async function addNote(s: Awaited<ReturnType<typeof setup>>, shotIndex: number, extra: Partial<Review> = {}): Promise<Review> {
  const take = s.takeOf(shotIndex)
  const r: Review = { id: newId('pin'), target: { kind: 'take', id: take.id }, comment: 'Remove the card that says Dialog', at_s: 1.2, resolved: false, created_at: new Date().toISOString(), ...extra }
  await updateDoc(s.doc, (d) => { d.reviews = [...(d.reviews ?? []), r] }, 'comment')
  return r
}

describe('Fix it in the shot', () => {
  it('sends the box as a mask the size of the frame, for fal (features/harness-refusals.clan)', async () => {
    vi.stubGlobal('createImageBitmap', async () => ({ width: 720, height: 1280, close() {} }))
    try {
      const s = await setup(2)
      await s.makeAll(false)
      const region = { x: 0.1, y: 0.33, w: 0.6, h: 0.33 } // over a quarter of the frame: masked all the same
      const editId = await fixInShot(s.deps, s.shotId(1), [await addNote(s, 1, { region })])
      const input = s.inputOf(editId)
      expect(input.mask?.sha256).toMatch(/^sha256:/)
      expect(input.region).toEqual(region)
      expect(boxMaskPng).toHaveBeenLastCalledWith(region, 720, 1280)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('makes its clip on the model picked in the menu, which the fix keeps (not the routed default)', async () => {
    const s = await setup(2)
    await s.makeAll(false)
    const pick = { provider: 'fal' as const, model: 'veo3.1-fast-i2v' }
    const note = await addNote(s, 1, { region: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } })
    const editId = await fixInShot(s.deps, s.shotId(1), [note], pick)
    expect(s.ui.get().jobCtx[editId]).toMatchObject({ fixModelChoice: pick })
    expect(s.ui.get().jobCtx[editId].request.modelChoice).toBeUndefined() // the pick is for the clip, not the frame
    await s.land()
    const clip = await vi.waitFor(() => {
      const c = s.all().find((j) => j.op === 'clip' && j.ctx.for === 'clip' && j.ctx.reviewIds?.includes(note.id))
      expect(c).toBeDefined()
      return c!
    }, { timeout: 2000, interval: 5 })
    expect(s.ui.get().jobCtx[clip.id].request.modelChoice).toEqual(pick)
  })

  it('once its frame landed and only its clip failed, Fix makes only the clip, not a second frame edit', async () => {
    const s = await setup(2)
    await s.makeAll(false)
    const note = await addNote(s, 1, { region: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } })
    const ctxOf = (id: string) => s.ui.get().jobCtx[id]
    const editId = await fixInShot(s.deps, s.shotId(1), [note])
    expect(fixFrameLanded(s.doc.get(), ctxOf, [note.id])).toBeUndefined() // the frame is still being edited
    await s.land()
    const clip = await vi.waitFor(() => {
      const c = s.all().find((j) => j.op === 'clip' && j.ctx.for === 'clip' && j.ctx.reviewIds?.includes(note.id))
      expect(c).toBeDefined()
      return c!
    }, { timeout: 2000, interval: 5 })
    expect(fixFrameLanded(s.doc.get(), ctxOf, [note.id])).toBeUndefined() // the clip is under way
    await s.runner.cancel(clip.id) // like HeyGen's 402: the clip step ends without a take
    expect(fixFrameLanded(s.doc.get(), ctxOf, [note.id])).toBe(editId)

    const pick = { provider: 'fal' as const, model: 'veo3.1-fast-i2v' }
    const again = await remakeFixClip(s.deps, editId, pick)
    expect(s.all().filter((j) => j.op === 'region_edit')).toHaveLength(1) // the fixed frame is not edited again
    expect(ctxOf(again)).toMatchObject({ for: 'clip', reviewIds: [note.id] })
    expect(ctxOf(again).request.modelChoice).toEqual(pick)
    expect(ctxOf(again).request.input.image?.sha256).toBe(s.frameOf(1).asset) // from the fixed frame
  })

  it('goes by the box alone where the browser cannot read the frame\'s size', async () => {
    const s = await setup(2)
    await s.makeAll(false)
    const editId = await fixInShot(s.deps, s.shotId(1), [await addNote(s, 1, { region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } })])
    expect(s.inputOf(editId)).not.toHaveProperty('mask')
  })

  it('a boxed note edits the storyboard frame, then makes the clip from the fixed frame, then the note is addressed', async () => {
    const s = await setup(3)
    await s.makeAll(false)
    const oldFrame = s.frameOf(1)
    const oldTake = s.takeOf(1)
    const region = { x: 0.05, y: 0.72, w: 0.9, h: 0.22 }
    const note = await addNote(s, 1, { region })
    const ctxOf = (id: string) => s.ui.get().jobCtx[id]

    const editId = await fixInShot(s.deps, s.shotId(1), [note])
    const edit = s.all().find((j) => j.id === editId)!
    expect(edit.op).toBe('region_edit')
    const input = s.inputOf(editId)
    expect(input.image?.sha256).toBe(oldFrame.asset) // the storyboard frame, not the clip
    expect(input.region).toEqual(region) // the box maps across as it is (same framing)
    expect(input.text).toBe(note.comment)
    expect(input.previousFrame?.sha256).toBe(s.frameOf(0).asset)
    expect(fixProgress(s.doc.get(), ctxOf, [note.id])).toEqual({ step: 'frame', jobId: editId, running: true })
    expect(s.all().filter((j) => j.op === 'clip' && j.state !== 'completed')).toHaveLength(0) // no clip before the frame

    await s.land() // the fixed frame lands and is selected; the clip starts from it
    const fixed = s.frameOf(1)
    expect(fixed.id).not.toBe(oldFrame.id)
    expect(fixed.parent).toBe(oldFrame.id)
    await vi.waitFor(() => expect(s.running().map((j) => j.op)).toEqual(['clip']), { timeout: 2000, interval: 5 })
    const clipJob = s.running()[0]
    expect(s.inputOf(clipJob.id).image?.sha256).toBe(fixed.asset)
    expect(clipJob.ctx).toMatchObject({ for: 'clip', shotId: s.shotId(1), parentTakeId: oldTake.id, reviewIds: [note.id] })
    expect(s.inputOf(clipJob.id).text).toBeUndefined() // the boxed note went into the frame
    expect(fixProgress(s.doc.get(), ctxOf, [note.id])).toEqual({ step: 'clip', jobId: clipJob.id, running: true })
    expect(s.doc.get().reviews!.find((r) => r.id === note.id)!.resolved).toBe(false)

    await s.land()
    const take = s.takeOf(1)
    expect(take.id).not.toBe(oldTake.id)
    expect(take.parent).toBe(oldTake.id)
    const r = s.doc.get().reviews!.find((x) => x.id === note.id)!
    expect(r.resolved).toBe(true)
    expect(r.resolved_by_job).toBe(clipJob.id)
    expect(takeStale(s.doc.get(), s.shotId(1))).toBeUndefined() // made from the fixed frame
    expect(frameStale(s.doc.get(), s.shotId(2))?.reason).toBe('Shot 2 changed') // the next frame follows it
  })

  it('makes the clip after a reload when the fixed frame landed while the page was closed', async () => {
    const s = await setup(2)
    await s.makeAll(false)
    const note = await addNote(s, 1, { region: { x: 0, y: 0.7, w: 1, h: 0.3 } })
    await fixInShot(s.deps, s.shotId(1), [note])
    // The page closed just after the fixed frame landed: it is in the document, the clip never started.
    s.runner.onComplete('frame', (job, ctx) => void updateDoc(s.doc, (d) => ctx.for === 'frame' && applyFrame(d, job, ctx), 'frame'))
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
    expect(input.clips!.map((c) => c.asset.sha256)).toEqual(s.doc.get().shots!.map((_, i) => s.takeOf(i).asset))
    const id = await renderAd(s.deps)
    expect(s.inputOf(id).clips!.map((c) => c.trimS)).toEqual([3, 2, 4, 4, 2])
  })

  it('ad length = the sum of the shots + the 2.5 s end card (the FACET ad: 15 s of shots is 17.5 s, not 21)', () => {
    expect(END_CARD_S).toBe(2.5)
    expect(adLengthS([{ duration_s: 3 }, { duration_s: 2 }, { duration_s: 2 }, { duration_s: 4 }, { duration_s: 4 }])).toBe(17.5)
    expect(adLengthS([{ duration_s: 2.5 }, { duration_s: 4 }])).toBe(9)
  })
})

describe('the out-of-date chain', () => {
  it('frame → its shot\'s clip, and going back to the frame the clip was made from lifts the mark', async () => {
    const s = await setup(2)
    await s.makeAll(false)
    const old = s.frameOf(0)
    await drawFrame(s.deps, 0, 'again', { parent: old })
    await s.land()
    expect(takeStale(s.doc.get(), s.shotId(0))).toMatchObject({ caused_by: { kind: 'frame', id: s.frameOf(0).id }, reason: "Shot 1's frame changed" })
    expect(frameStale(s.doc.get(), s.shotId(1))).toBeDefined() // and frame 2, as before
    await selectFrame(s.doc, s.shotId(0), old.id)
    expect(takeStale(s.doc.get(), s.shotId(0))).toBeUndefined()
    expect(frameStale(s.doc.get(), s.shotId(1))).toBeUndefined()
  })

  it('a new clip made from the current frame is not out of date', async () => {
    const s = await setup(2)
    await s.makeAll(false)
    await drawFrame(s.deps, 0, 'again', { parent: s.frameOf(0) })
    await s.land()
    expect(takeStale(s.doc.get(), s.shotId(0))).toBeDefined()
    await makeClip(s.deps, s.shotId(0), { parentTake: s.takeOf(0) })
    await s.land()
    expect(takeStale(s.doc.get(), s.shotId(0))).toBeUndefined()
  })

  it('clip → ad: a new clip, or picking another, puts the ad out of date; picking the old one back clears it', async () => {
    const s = await setup(2)
    await s.makeAll()
    expect(adStatus(s.doc.get())).toMatchObject({ stale: false })
    const old = s.takeOf(1)
    await makeClip(s.deps, s.shotId(1), { parentTake: old })
    await s.land()
    expect(adStatus(s.doc.get())).toMatchObject({ stale: true, reason: "Shot 2's clip changed", shotId: s.shotId(1) })
    await updateDoc(s.doc, (d) => { for (const t of d.takes ?? []) if (t.shot_id === old.shot_id) t.selected = t.id === old.id }, 'pick take')
    expect(adStatus(s.doc.get()).stale).toBe(false)
  })

  it('adding a shot puts the ad out of date; deleting one marks the next shot\'s frame and the ad, and Undo puts it back', async () => {
    const s = await setup(3)
    await s.makeAll()
    await updateDoc(s.doc, (d) => { d.shots!.push({ id: newId('shot'), order: 4, duration_s: 2, composition: 'medium', action: 'The logo.', camera_move: 'static', status: 'planned' }) }, 'add shot')
    expect(adStatus(s.doc.get())).toMatchObject({ stale: true, reason: 'Shot 4 has no clip in it' })
    const last = s.shotId(3)
    await updateDoc(s.doc, (d) => { d.shots = d.shots!.filter((x) => x.id !== last) })
    expect(adStatus(s.doc.get()).stale).toBe(false)

    const third = s.frameOf(2)
    const r = await deleteFrom(s.doc, (d) => removeShot(d, s.shotId(1)))
    expect(s.doc.get().stale).toEqual([expect.objectContaining({ target: { kind: 'frame', id: third.id }, caused_by: { kind: 'shot', id: expect.stringMatching(/^shot_/) }, reason: 'Shot 2 was deleted' })])
    expect(adStatus(s.doc.get())).toMatchObject({ stale: true, reason: 'A shot was deleted' })
    await restoreTo(s.doc, r)
    expect(s.doc.get().stale).toEqual([])
    expect(adStatus(s.doc.get()).stale).toBe(false)
  })
})

describe('Update what follows', () => {
  const runway = effectiveConfig('event', 'runway')

  it('plans and prices the work: the changed frame\'s followers, their clips, the ad', async () => {
    const s = await setup(4)
    await s.makeAll()
    expect(planFollow(s.doc.get())).toEqual({ frames: [], clips: [], ad: false })
    await drawFrame(s.deps, 1, 'again', { parent: s.frameOf(1) })
    await s.land()
    const plan = planFollow(s.doc.get())
    // Frames 3 and 4 follow frame 2; clips for shots 2-4 (2's frame changed); then the ad.
    expect(plan).toEqual({ frames: [s.shotId(2), s.shotId(3)], clips: [s.shotId(1), s.shotId(2), s.shotId(3)], ad: true })
    // Runway: frame $0.20 (Gemini 3 Pro), clip $1.20 (Veo 3.1) (contracts/capabilities/runway.json); the ad is ffmpeg.
    expect(planCost(plan, runway).usd).toBeCloseTo(2 * 0.2 + 3 * 1.2)
    expect(planSummary(plan, runway)).toBe('2 frames, 3 clips, 1 ad · about $4.00')
    expect(planSummary(plan, CONFIGS.testing)).toMatch(/^2 frames, 3 clips, 1 ad · /)
  })

  it('steered: each item waits in the box; Make it sends its words and model, and the new one replaces the old once it lands', async () => {
    const s = await setup(2)
    await s.makeAll(false)
    await drawFrame(s.deps, 0, 'again', { parent: s.frameOf(0) })
    await s.land() // shot 1's frame changed: shot 2's frame and both clips are behind
    const own = { ...CONFIGS.testing, routing: { ...CONFIGS.testing.routing, clip: ['heygen', 'fal'] as const } } as unknown as typeof CONFIGS.testing
    const before = s.all().length
    await startFollow(s.deps, own, { steer: true })
    expect(s.all()).toHaveLength(before) // nothing is sent until the user says so
    expect(s.ui.get().following?.awaiting).toEqual({ kind: 'frame', shotId: s.shotId(1) })
    const oldFrame = s.frameOf(1)

    const veo = { provider: 'fal' as const, model: 'veo3.1-fast-i2v' }
    const id = (await makeAwaited(s.deps, { text: 'no flames', modelChoice: null }))!
    expect(s.inputOf(id).text).toBe('no flames') // the words go to this request only
    expect((s.doc.get().shots ?? [])[1].action).not.toContain('no flames') // never into the script
    expect(s.frameOf(1).id).toBe(oldFrame.id) // the old frame stays until the new one lands
    await s.land()
    await vi.waitFor(() => expect(s.ui.get().following?.awaiting).toEqual({ kind: 'clip', shotId: s.shotId(0) }), { timeout: 2000, interval: 5 })
    expect(s.frameOf(1).id).not.toBe(oldFrame.id)
    expect(s.doc.get().frames!.some((f) => f.id === oldFrame.id)).toBe(false) // replaced, not stacked

    const clipId = (await makeAwaited(s.deps, { modelChoice: veo }))!
    expect(s.ui.get().jobCtx[clipId].request.modelChoice).toEqual(veo)
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
    await s.runner.cancel(first) // like HeyGen out of credit
    await continueFollow(s.deps)
    expect(s.ui.get().following?.awaiting).toEqual({ kind: 'clip', shotId: s.shotId(0) }) // back in the box
    expect(s.takeOf(0).id).toBe(oldTake.id) // the old clip is still there
    const veo = { provider: 'fal' as const, model: 'veo3.1-fast-i2v' }
    const second = (await makeAwaited(s.deps, { modelChoice: veo }))!
    expect(s.ui.get().jobCtx[first].dismissed).toBe(true)
    expect(s.ui.get().jobCtx[second].request.modelChoice).toEqual(veo)
  })

  it('"Do the rest as they are" makes this and every later item on the box\'s models, then renders the ad by itself', async () => {
    const s = await setup(2)
    await s.makeAll()
    await drawFrame(s.deps, 0, 'again', { parent: s.frameOf(0) })
    await s.land()
    await startFollow(s.deps, CONFIGS.testing, { steer: true })
    await restAsTheyAre(s.deps)
    await s.settle()
    expect(s.ui.get().following).toBeUndefined()
    expect(anythingStale(s.doc.get())).toBe(false)
    const ran = s.all().filter((j) => j.ctx && 'followRun' in j.ctx && j.ctx.followRun)
    expect(ran.map((j) => j.op)).toEqual(['frame', 'clip', 'clip', 'stitch'])
    expect(s.doc.get().frames!.filter((f) => f.shot_id === s.shotId(1))).toHaveLength(1) // each old one replaced
  })

  it('the box starts on the last model that worked for the step, not on one that just failed', async () => {
    const s = await setup(1)
    await s.makeAll(false)
    const own = { ...CONFIGS.testing, routing: { ...CONFIGS.testing.routing, clip: ['heygen', 'fal'] as const } } as unknown as typeof CONFIGS.testing
    await updateDoc(s.doc, (d) => {
      const clips = d.jobs.filter((j) => j.op === 'clip')
      Object.assign(clips.at(-1)!, { provider: 'fal', model: 'veo3.1-fast-i2v', state: 'completed' })
      d.jobs.push({ ...clips.at(-1)!, id: newId('job'), provider: 'heygen', model: 'heygen-video-1', state: 'failed' })
    })
    expect(lastWorkedModel(s.doc.get(), 'clip', own)).toEqual({ provider: 'fal', model: 'veo3.1-fast-i2v' })
  })

  it('leaves out a clip that is being made now: it is not behind', async () => {
    // 2026-10-09: four first clips in the making showed as "4 behind your changes".
    const s = await setup(3)
    await s.makeAll(false)
    await updateDoc(s.doc, (d) => { d.takes = d.takes!.filter((t) => t.shot_id === s.shotId(0)) })
    const owed = planFollow(s.doc.get())
    expect(owed.clips).toEqual([s.shotId(1), s.shotId(2)])
    const making = shotsInTheMaking(s.doc.get(), () => undefined)
    expect(making.clips.size).toBe(0)
    expect(planFollow(s.doc.get(), new Set([s.shotId(1), s.shotId(2)])).clips).toEqual([])
  })

  it('starts on a real provider, not on mock, when one is offered', async () => {
    // 2026-10-09: mock stills were the last clips that "worked", so an update run sent clips to mock again.
    const s = await setup(1)
    await s.makeAll(false)
    const own = { ...CONFIGS.testing, routing: { ...CONFIGS.testing.routing, clip: ['fal', 'mock'] as const } } as unknown as typeof CONFIGS.testing
    await updateDoc(s.doc, (d) => {
      for (const j of d.jobs) if (j.op === 'clip') Object.assign(j, { provider: 'mock', model: 'mock', state: 'completed' })
    })
    expect(lastWorkedModel(s.doc.get(), 'clip', own)?.provider).toBe('fal')
    const mockOnly = { ...CONFIGS.testing, routing: { ...CONFIGS.testing.routing, clip: ['mock'] as const } } as unknown as typeof CONFIGS.testing
    expect(lastWorkedModel(s.doc.get(), 'clip', mockOnly)?.provider).toBe('mock') // nothing real offered: mock still answers
  })

  it('leaves a shot that a fix is redoing alone: not out of date in the plan while the fix runs', async () => {
    const s = await setup(2)
    await s.makeAll(false)
    const note = await addNote(s, 1, { region: { x: 0.1, y: 0.1, w: 0.4, h: 0.4 } })
    await fixInShot(s.deps, s.shotId(1), [note])
    await s.land() // the fixed frame lands; the fix's clip is running and shot 2's old clip is marked
    await vi.waitFor(() => expect(s.all().some((j) => j.op === 'clip' && j.state !== 'completed')).toBe(true), { timeout: 2000, interval: 5 })
    const fixing = shotsBeingFixed(s.doc.get(), (id) => s.ui.get().jobCtx[id])
    expect([...fixing]).toEqual([s.shotId(1)])
    expect(takeStale(s.doc.get(), s.shotId(1))).toBeDefined()
    expect(planFollow(s.doc.get(), fixing).clips).not.toContain(s.shotId(1))
  })

  it('a failed job can be sent again on another model (the error card\'s "Try another model")', async () => {
    const s = await setup(1)
    await s.makeAll(false)
    const id = await makeClip(s.deps, s.shotId(0), { parentTake: s.takeOf(0) })
    await s.runner.cancel(id) // like HeyGen out of credit: the step ended without a clip
    const veo = { provider: 'fal' as const, model: 'veo3.1-fast-i2v' }
    const again = (await s.runner.retry(id, veo))!
    expect(s.ui.get().jobCtx[again].request.modelChoice).toEqual(veo)
    expect(s.ui.get().jobCtx[again]).toMatchObject({ for: 'clip', parentTakeId: s.takeOf(0).id })
    expect(s.ui.get().jobCtx[id]).toMatchObject({ dismissed: true, retriedAs: again })
    await s.runner.cancel(again)
    const routed = (await s.runner.retry(again, null))! // the routed default this time
    expect(s.ui.get().jobCtx[routed].request.modelChoice).toBeUndefined()
  })

  it('runs frames one at a time in order, then the clips, then the ad, and writes one chain entry', async () => {
    const s = await setup(4)
    await s.makeAll()
    await drawFrame(s.deps, 1, 'again', { parent: s.frameOf(1) })
    await s.land()
    const before = s.doc.get().jobs.length
    const framesBefore = (s.doc.get().frames ?? []).length

    await startFollow(s.deps)
    const order: string[] = []
    for (let i = 0; i < 10; i++) {
      // The next step is sent from a completion hook: wait for it, or for the run to end.
      await vi.waitFor(() => expect(s.running().length > 0 || !s.ui.get().following).toBe(true), { timeout: 2000, interval: 5 })
      if (!s.running().length) break
      expect(s.running()).toHaveLength(1) // one at a time
      const j = s.running()[0]
      order.push(`${j.op}:${'shotId' in j.ctx ? s.doc.get().shots!.findIndex((x) => x.id === (j.ctx as { shotId: string }).shotId) + 1 : ''}`)
      if (j.op === 'frame') {
        const k = s.doc.get().shots!.findIndex((x) => x.id === (j.ctx as { shotId: string }).shotId)
        expect(s.inputOf(j.id).previousFrame?.sha256).toBe(s.frameOf(k - 1).asset) // from the frame drawn just before
        expect(s.inputOf(j.id).anchorFrame?.sha256).toBe(s.frameOf(0).asset)
      }
      await s.land()
    }
    expect(order).toEqual(['frame:3', 'frame:4', 'clip:2', 'clip:3', 'clip:4', 'stitch:'])
    expect(s.doc.get().jobs.length).toBe(before + 6)
    expect((s.doc.get().frames ?? []).length).toBe(framesBefore) // each new frame replaced the one it updated (2026-10-09)
    expect(anythingStale(s.doc.get())).toBe(false)
    expect(adStatus(s.doc.get()).stale).toBe(false)
    expect(s.ui.get().following).toBeUndefined()
    expect(s.recorded.at(-1)!.action).toBe('updated what follows: 2 frames, 3 clips, ad')
  })

  it('the chain names each step', async () => {
    const s = await setup(3)
    await s.makeAll()
    await drawFrame(s.deps, 1, 'again', { parent: s.frameOf(1) })
    await s.land()
    let prev = s.doc.get()
    const said: string[] = []
    s.doc.subscribe(() => {
      const d = describeWrite(`submit ${s.doc.get().jobs.at(-1)!.op}`, prev, s.doc.get(), (id) => s.ui.get().jobCtx[id])
      if (d && s.doc.get().jobs.length > prev.jobs.length) said.push(d.action)
      prev = s.doc.get()
    })
    await startFollow(s.deps)
    await s.settle()
    expect(said).toEqual(["drew shot 3's frame again", "made shot 2's clip again", "made shot 3's clip again", 'rendered the ad'])
  })

  it('Stop finishes the job running now and starts nothing more', async () => {
    const s = await setup(4)
    await s.makeAll()
    await drawFrame(s.deps, 1, 'again', { parent: s.frameOf(1) })
    await s.land()
    await startFollow(s.deps)
    expect(s.running()).toHaveLength(1)
    await cancelFollow(s.deps)
    expect(s.ui.get().following?.cancel).toBe(true)
    expect(s.running()).toHaveLength(1) // not cancelled at the provider
    const jobs = s.doc.get().jobs.length
    await s.land()
    await vi.waitFor(() => expect(s.ui.get().following).toBeUndefined(), { timeout: 2000, interval: 5 })
    expect(s.doc.get().jobs.length).toBe(jobs) // nothing new started
    expect(s.recorded.at(-1)!.action).toBe('stopped updating what follows after 1 frame')
    expect(frameStale(s.doc.get(), s.shotId(3))).toBeDefined() // what is left stays out of date
  })

  it('resumes after a reload, and waits on a failed step until it is retried', async () => {
    const s = await setup(3)
    await s.makeAll()
    await drawFrame(s.deps, 0, 'again', { parent: s.frameOf(0) })
    await s.land()
    await startFollow(s.deps)
    // The page reloads while frame 2 is drawing: the run is in the UI snapshot; boot calls continueFollow.
    await continueFollow(s.deps)
    expect(s.running()).toHaveLength(1) // nothing doubled
    s.runner.onComplete('frame', (job, ctx) => void updateDoc(s.doc, (d) => ctx.for === 'frame' && applyFrame(d, job, ctx), 'frame')) // closed as it landed
    await s.land()
    expect(s.running()).toHaveLength(0)
    wireJobs(s.deps)
    await continueFollow(s.deps) // boot
    expect(s.running().map((j) => j.op)).toEqual(['frame']) // frame 3

    // Frame 3's request fails: the run waits (it does not skip it), and a retry moves it on.
    const failing = s.running()[0]
    s.ui.update((u) => { u.jobCtx[failing.id].request.input.text = '#fail' })
    await s.runner.cancel(failing.id)
    await continueFollow(s.deps)
    expect(s.running()).toHaveLength(0)
    expect(s.ui.get().following).toBeDefined()
    s.ui.update((u) => { delete u.jobCtx[failing.id].request.input.text })
    await s.runner.retry(failing.id)
    await s.settle()
    expect(s.ui.get().following).toBeUndefined()
    expect(anythingStale(s.doc.get())).toBe(false)
    expect(s.recorded.at(-1)!.action).toBe('updated what follows: 2 frames, 3 clips, ad')
  })
})
