// A video straight from a script (ui-behaviour 3.5, 3.10, 3.17; features/production-ui.clan): Plan
// shots from a script with no storyboard, Dex's "Plan a storyboard first?" and its stored answer, the
// clips made from a shot's words, and the Script editor's next step. The runner is a recorder: what
// matters is what would be sent.

import { describe, expect, it, vi } from 'vitest'
import type { JobInput, Op, ProductionDocument } from '../contracts/types'
import type { JobPurpose } from '../model/purpose'
import { systemUpdate, updateDoc } from '../doc/store'
import { putBlob } from '../lib/blobs'
import { mainScript, mainStoryboard, mainVideo, scenesOf, shotsOf } from '../model/selectors'
import type { ModelStore } from '../model/store'
import { MockRelay } from '../relay/mock'
import { addScene } from '../script/edits'
import { nextStep } from '../script/nextStep'
import { addFrame, addShots, asset, id, job, MAYA, modelStore } from '../test/model'
import { clipSource, makeClip, traySummary } from './clips'
import { fixesInFrame } from './fix'
import { planFor } from './follow'
import type { FrameDeps } from './frames'
import {
  answerScriptVideo, clipMode, PLAN_FIRST, planFromScript, planShotsBlocked, recordScriptVideoAnswer, scriptVideoAsk, scriptVideoQuestion, shotCount, STRAIGHT,
  waitsOnScriptAsk,
} from './scriptVideo'

interface Sent { op: Op; input: JobInput; purpose: JobPurpose }

async function project(): Promise<{ store: ModelStore; deps: FrameDeps; sent: Sent[] }> {
  const store = modelStore()
  await store.create(MAYA, 'First Light')
  await store.flush()
  const relay = new MockRelay({ renderer: { async render() { return [] } }, persistKey: null })
  const sent: Sent[] = []
  const runner = {
    submit: vi.fn(async (op: Op, input: JobInput, _p: string[], purpose: JobPurpose) => {
      sent.push({ op, input, purpose })
      const node = op === 'shot_list' ? { kind: 'storyboard' as const, id: (purpose as { storyboardId?: string }).storyboardId ?? mainStoryboard(store.get())!.id } : undefined
      const j = job(store.get(), op, [], null, { state: 'submitted', ...(node ? { node } : {}) })
      await systemUpdate(store, (d) => { d.jobs[j.id] = j }, 'sync')
      return j.id
    }),
  }
  const deps = { relay, doc: store, ui: { get: () => ({ jobs: {} }) }, runner } as unknown as FrameDeps
  return { store, deps, sent }
}

const doc = (s: ModelStore): ProductionDocument => s.get()

/** A second script (as + Node makes it), with words, and no storyboard. */
async function newScript(store: ModelStore, words = 'EXT. CLIFFS - DAWN. A runner crests the cliff and drinks Lumen water.'): Promise<string> {
  const sc = id('script')
  await systemUpdate(store, (d) => { d.scripts[sc] = { id: sc, v: 1, field_v: {}, title: 'Script 2', target_s: 15 } }, 'add a script')
  await store.flush()
  if (words) {
    const scene = await addScene(store, sc)
    await updateDoc(store, (d) => { d.scenes[scene].text = words }, 'edit')
    await store.flush()
  }
  return sc
}

/** A video the script drives (Make video from a script alone). */
async function videoFrom(store: ModelStore, scriptId: string): Promise<string> {
  const v = id('video')
  const l = id('link')
  await systemUpdate(store, (d) => {
    d.videos[v] = { id: v, v: 1, field_v: {}, title: 'Video 2', ratio: '16:9', target_s: 15, edl: {} }
    d.links[l] = { id: l, v: 1, field_v: {}, from: { kind: 'script', id: scriptId }, to: { kind: 'video', id: v }, role: 'drives' }
  }, 'make video')
  await store.flush()
  return v
}

describe('Plan shots from a script (3.10)', () => {
  it('says "Write the script first" while the script has no words', async () => {
    const { store } = await project()
    const sc = await newScript(store, '')
    expect(planShotsBlocked(doc(store), sc)).toBe('Write the script first')
  })

  it('a script with words and no storyboard gets one, linked, and Dex plans on it', async () => {
    const { store, deps, sent } = await project()
    const sc = await newScript(store)
    expect(planShotsBlocked(doc(store), sc)).toBeNull()
    const r = await planFromScript(deps, sc)
    expect(r.made).toBe(true)
    const drives = Object.values(doc(store).links).filter((l) => l.role === 'drives' && l.from.id === sc && l.to.id === r.storyboardId)
    expect(drives).toHaveLength(1)
    expect(sent).toHaveLength(1)
    expect(sent[0].op).toBe('shot_list')
    expect(sent[0].purpose).toEqual({ for: 'shot_list', storyboardId: r.storyboardId })
    expect(sent[0].input.script).toContain('A runner crests the cliff')
    // Again: the same storyboard, and the plan running there is joined.
    const again = await planFromScript(deps, sc)
    expect(again).toMatchObject({ storyboardId: r.storyboardId, made: false, joined: true })
    expect(sent).toHaveLength(1)
  })
})

describe('"Plan a storyboard first?" (3.5, 3.17)', () => {
  it('has the spec\'s words: Recommended plan first with its detail, clips straight from the script', () => {
    const q = scriptVideoQuestion({ n: 6, exact: true })
    expect(q.kind).toBe('nudge')
    expect(q.text).toBe('Plan a storyboard first?')
    expect(q.why).toBe('Clips come out better from frames you\'ve checked.')
    expect(q.recommended_option_id).toBe(PLAN_FIRST)
    expect(q.options.map((o) => [o.label, o.detail])).toEqual([
      ['Plan the storyboard first', '6 shots, with frames you check first'],
      ['Make clips straight from the script', '6 clips'],
    ])
    expect(q.options.every((o) => !o.cost)).toBe(true)
    expect(scriptVideoQuestion({ n: 6, exact: false }).options[1].detail).toBe('About 6 clips')
  })

  it('a video a script drives waits on it until a storyboard renders it; the count is estimated from the length', async () => {
    const { store } = await project()
    const sc = await newScript(store)
    const v = await videoFrom(store, sc)
    expect(waitsOnScriptAsk(doc(store), v)).toBe(sc)
    expect(shotCount(doc(store), sc)).toEqual({ n: 6, exact: false })
    expect(clipMode(doc(store), v)).toBe('frames')
  })

  it('Make clips straight from the script: stored on the video, a storyboard linked to it, Dex plans; switching later is a new answer', async () => {
    const { store, deps, sent } = await project()
    const sc = await newScript(store)
    const v = await videoFrom(store, sc)
    const { storyboardId } = await answerScriptVideo(deps, v, STRAIGHT, 'human:p_maya01')
    const d = doc(store)
    expect(Object.values(d.links).some((l) => l.role === 'renders' && l.from.id === storyboardId && l.to.id === v)).toBe(true)
    expect(Object.values(d.links).some((l) => l.role === 'drives' && l.from.id === sc && l.to.id === storyboardId)).toBe(true)
    expect(waitsOnScriptAsk(d, v)).toBeNull()
    expect(clipMode(d, v)).toBe('straight')
    const ask = scriptVideoAsk(d, v)!
    expect(ask).toMatchObject({ node: { kind: 'video', id: v }, crew: 'dex', state: 'answered' })
    expect(ask.answers.map((a) => a.option_id)).toEqual([STRAIGHT])
    expect(sent.map((s) => s.op)).toEqual(['shot_list'])
    // Nothing paid: no clip was sent.
    expect(sent.some((s) => s.op === 'clip')).toBe(false)
    await answerScriptVideo(deps, v, PLAN_FIRST, 'human:p_maya01')
    expect(clipMode(doc(store), v)).toBe('frames')
    expect(scriptVideoAsk(doc(store), v)!.answers.map((a) => a.option_id)).toEqual([STRAIGHT, PLAN_FIRST])
    // The plan already running is not sent twice.
    expect(sent.filter((s) => s.op === 'shot_list')).toHaveLength(1)
  })

  it('refuses before anything when the script has no words', async () => {
    const { store, deps, sent } = await project()
    const sc = await newScript(store, '')
    const v = await videoFrom(store, sc)
    await expect(answerScriptVideo(deps, v, STRAIGHT, 'human:p_maya01')).rejects.toThrow(/Write the script first/)
    expect(sent).toHaveLength(0)
  })
})

describe('clips straight from the script (3.5)', () => {
  it('a shot with no frame is made from its words, with no picture; without the choice it waits for its frame', async () => {
    const { store, deps, sent } = await project()
    let shotId = ''
    await updateDoc(store, (d) => { shotId = addShots(d, 1, { action: 'A runner crests the cliff at dawn.' })[0].id }, 'plan')
    await store.flush()
    expect(clipSource(doc(store), shotId, false)).toBeNull()
    expect(clipSource(doc(store), shotId, true)).toBe('words')
    await expect(makeClip(deps, shotId)).rejects.toThrow('This shot has no frame yet.')
    await makeClip(deps, shotId, { fromWords: true })
    expect(sent).toHaveLength(1)
    expect(sent[0].op).toBe('clip')
    expect(sent[0].input.image).toBeUndefined()
    expect(sent[0].input.shot?.action).toContain('A runner crests the cliff')
  })

  it('a shot with a frame keeps making its clip from the frame', async () => {
    const { store, deps, sent } = await project()
    const sha = await putBlob(new Blob(['frame'], { type: 'image/png' }))
    let shotId = ''
    await updateDoc(store, (d) => {
      d.assets[sha] = asset(sha)
      const s = addShots(d, 1, { action: 'She smiles.' })[0]
      shotId = s.id
      addFrame(d, s, sha, { pick: true })
    }, 'plan')
    await store.flush()
    expect(clipSource(doc(store), shotId, true)).toBe('frame')
    await makeClip(deps, shotId, { fromWords: true })
    expect(sent[0].input.image?.sha256).toBe(sha)
  })

  it('in a video made straight from the script, every clip request on a frameless shot uses its words (2026-10-15)', async () => {
    // New take, a note's new version and Remake call makeClip without fromWords: they failed with
    // "This shot has no frame yet." on every shot the Video editor had made from its words.
    const { store, deps, sent } = await project()
    const v = mainVideo(doc(store))!.id
    let shotId = ''
    await updateDoc(store, (d) => { shotId = addShots(d, 2, { action: 'A runner crests the cliff at dawn.' })[0].id }, 'plan')
    await recordScriptVideoAnswer(store, v, STRAIGHT, 'human:p_maya01')
    await store.flush()
    await makeClip(deps, shotId)
    expect(sent.map((x) => [x.op, !!x.input.image])).toEqual([['clip', false]])
    // Remake this and the clips after: a shot with words but no frame is in the plan.
    expect(planFor(doc(store), { kind: 'after', item: { kind: 'clip', shotId } }).clips).toHaveLength(2)
    // A boxed note on it makes a new version; there is no frame to fix the box in.
    expect(fixesInFrame(doc(store), shotId, [{ region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }], true)).toBe(false)
  })

  it('a boxed note is fixed in the frame only when the shot has one', async () => {
    const { store } = await project()
    const sha = await putBlob(new Blob(['frame'], { type: 'image/png' }))
    let shotId = ''
    await updateDoc(store, (d) => {
      d.assets[sha] = asset(sha)
      const s = addShots(d, 1, { action: 'She smiles.' })[0]
      shotId = s.id
      addFrame(d, s, sha, { pick: true })
    }, 'plan')
    const box = [{ region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }]
    expect(fixesInFrame(doc(store), shotId, box, true)).toBe(true)
    expect(fixesInFrame(doc(store), shotId, box, false)).toBe(false)
    expect(fixesInFrame(doc(store), shotId, [{}], true)).toBe(false)
  })

  it('the tray says what each clip is made from', () => {
    expect(traySummary(['frame', 'frame'])).toBe('2 clips from frames')
    expect(traySummary(['words', 'words', 'words'])).toBe('3 clips from the script\'s words, no frames')
    expect(traySummary(['frame', 'words', null])).toBe('2 clips · 1 from frames, 1 from the script\'s words')
    expect(traySummary([null])).toBe('No clip can be made yet')
  })
})

describe('the Script editor\'s next step', () => {
  it('nothing until the script has words; then Plan shots, then the storyboard\'s frames, then the clips', async () => {
    const { store, deps } = await project()
    const sc = mainScript(doc(store))!.id
    expect(nextStep(doc(store), sc)).toBeNull()
    const scene = await addScene(store, sc)
    await updateDoc(store, (d) => { d.scenes[scene].text = 'A runner crests the cliff at dawn.' }, 'edit')
    await store.flush()
    const plan = nextStep(doc(store), sc)!
    expect(plan.step).toBe('plan')
    expect(plan.line).toMatch(/^Ready when you are: Plan shots turns this into about \d+ shots\.$/)
    expect(plan.actions).toEqual(['plan', 'open-video'])
    // While Dex plans there is nothing to do.
    await planFromScript(deps, sc)
    expect(nextStep(doc(store), sc)).toBeNull()
    await systemUpdate(store, (d) => { for (const j of Object.values(d.jobs)) j.state = 'completed'; addShots(d, 3) }, 'land')
    await store.flush()
    const frames = nextStep(doc(store), sc)!
    expect(frames.step).toBe('frames')
    expect(frames.line).toBe('3 shots planned. Next: draw and check each shot\'s frame in the storyboard.')
    expect(frames.actions[0]).toBe('open-storyboard')
    expect(scenesOf(doc(store), sc)).toHaveLength(1)
    expect(shotsOf(doc(store), mainStoryboard(doc(store))!.id)).toHaveLength(3)
  })
})
