// + New box (rooms/newBox.ts) and the Make room's empty states (rooms/emptyState.ts), and the loop the owner
// hit on 2026-10-21: answering "Make clips straight from the script" with a bare @kapi that has no front.
// Every write through the real CLAN store (modelStore); the runner records what would be sent.

import { describe, expect, it, vi } from 'vitest'

vi.mock('../jobs/assets', () => ({
  assetRef: async (_relay: unknown, sha: string) => ({ sha256: sha, url: `https://cdn.test/${sha}`, mime: 'image/png' }),
}))

import { effectiveConfig } from '../capabilities'
import type { Job, JobInput, NamedRef, Op, ProductionDocument } from '../contracts/types'
import { systemUpdate, updateDoc } from '../doc/store'
import { makeClip } from '../jobs/clips'
import type { FrameDeps } from '../jobs/frames'
import { setFront } from '../jobs/fronts'
import { landShotList, planOrJoin } from '../jobs/plan'
import { answerScriptVideo, scriptVideoAsk, STRAIGHT, waitsOnScriptAsk } from '../jobs/scriptVideo'
import { jobShot } from '../jobs/select'
import { FrontsMissingError } from '../lib/names'
import { lifeOf } from '../model/live'
import type { JobPurpose } from '../model/purpose'
import { mainVideo, scriptText, shotsOf, storyboardOfVideo } from '../model/selectors'
import type { ModelStore } from '../model/store'
import { MockRelay, mockShotList } from '../relay/mock'
import { asset, id, job, MAYA, modelStore, SHA, scriptWords } from '../test/model'
import { roomEmpty } from './emptyState'
import { roomBoxes } from './model'
import { addBox, addShotRef, addShotToBox, setStartFrame, shotRefLinks } from './newBox'

interface Sent { op: Op; input: JobInput; purpose: JobPurpose }

const config = (() => {
  const c = effectiveConfig('live', 'mock')
  return { ...c, flags: { ...c.flags, connectedVideo: true, makeAndEdit: true } }
})()
const UI = { jobs: {} }

const ref = (key: string, variant: string, node: string, c: string): NamedRef =>
  ({ id: id('ref'), v: 1, field_v: {}, key, variant, role: 'character', asset: SHA(c), node })

async function project(opts: { words?: string; ownVideo?: boolean } = {}) {
  const store = modelStore()
  await store.create(MAYA, 'Kapi')
  const ids = { kref: '', kside: '', videoId: '' }
  await systemUpdate(store, (d) => {
    const k = id('key')
    d.keys[k] = { id: k, v: 1, field_v: {}, key: 'kapi', role: 'character' }
    const a = ref('kapi', 'ref', 'node_kref', '1')
    const b = ref('kapi', 'side', 'node_kside', '2')
    for (const r of [a, b]) { d.refs[r.id] = r; d.assets[r.asset!] = asset(r.asset!, 'image', { origin: 'uploaded' }) }
    ids.kref = a.id
    ids.kside = b.id
    // A video no storyboard renders (+ Node on the canvas): New box gives it its own shot list.
    if (opts.ownVideo) {
      const v = id('video')
      d.videos[v] = { id: v, v: 1, field_v: {}, title: 'Video 2', ratio: '16:9', target_s: 15, timeline: {} }
      ids.videoId = v
    } else ids.videoId = mainVideo(d)!.id
  }, 'sync')
  if (opts.words) await updateDoc(store, (d) => scriptWords(d, opts.words!), 'edit')
  await store.flush()
  if (store.trouble) throw new Error(`the fixture was refused: ${store.trouble}`)
  lifeOf(store).set(new Set(['node_kref', 'node_kside']))
  const sent: Sent[] = []
  const runner = {
    submit: vi.fn(async (op: Op, input: JobInput, _p: string[], purpose: JobPurpose) => {
      sent.push({ op, input, purpose })
      const sb = storyboardOfVideo(store.get(), ids.videoId)
      const j = job(store.get(), op, [], null, { state: 'submitted', ...(op === 'shot_list' && sb ? { node: { kind: 'storyboard' as const, id: sb.id } } : {}) })
      await systemUpdate(store, (d) => { d.jobs[j.id] = j }, 'sync')
      return j.id
    }),
  }
  const relay = new MockRelay({ renderer: { async render() { return [] } }, persistKey: null })
  const deps = { relay, doc: store, ui: { get: () => UI }, runner } as unknown as FrameDeps
  return { store, deps, sent, ...ids }
}

/** Dex's plan landing, as the mock relay would make it from the words there now. */
async function land(s: ModelStore, jobId: string) {
  const d = s.get()
  const shots = mockShotList(scriptText(d), 15, [], shotsOf(d).map((x) => jobShot(d, x, false)))
  await landShotList(s, { jobId, shots } as unknown as Job)
  await s.flush()
}

const boxes = (s: ModelStore, videoId: string) => roomBoxes(s.get(), UI, videoId, config)

describe('+ New box', () => {
  it('on a video with no storyboard: its own shot list and one box, one undo step; undo takes both away', async () => {
    const { store, videoId } = await project({ ownVideo: true })
    expect(storyboardOfVideo(store.get(), videoId)).toBeUndefined()
    const shotId = await addBox(store, videoId)
    const sb = storyboardOfVideo(store.get(), videoId)!
    expect(sb).toMatchObject({ implicit: true, video_id: videoId })
    expect(boxes(store, videoId).map((b) => b.shotIds)).toEqual([[shotId]])
    await store.undo()
    expect(store.get().shots[shotId]).toBeUndefined()
    expect(store.get().storyboards[sb.id]).toBeUndefined()
    await store.close()
  })

  it('several shots in one video: a shot added to the box is made together with it', async () => {
    const { store, videoId } = await project({ ownVideo: true })
    const a = await addBox(store, videoId)
    const b = await addShotToBox(store, videoId, [a])
    expect(boxes(store, videoId).map((x) => [x.shotIds, x.together])).toEqual([[[a, b], true]])
    await store.undo()
    expect(boxes(store, videoId).map((x) => x.shotIds)).toEqual([[a]])
    await store.close()
  })

  it('its Make sends a clip from words and the chosen references, no frame; a start frame from the Bin goes as the image', async () => {
    const { store, deps, sent, videoId, kside, kref } = await project({ ownVideo: true })
    const shotId = await addBox(store, videoId)
    await updateDoc(store, (d) => { d.shots[shotId].action = 'Kapi sniffs a carrot.' }, 'edit')
    await addShotRef(store, shotId, kside, 4)
    expect(shotRefLinks(store.get(), shotId).map((l) => [l.from.id, l.role])).toEqual([[kside, 'character']])
    await makeClip(deps, shotId, { videoId, fromWords: true })
    expect(sent[0].op).toBe('clip')
    expect(sent[0].input.image).toBeUndefined()
    expect(sent[0].input.refs?.map((r) => r.name)).toEqual(['kapi_side'])
    await setStartFrame(store, shotId, kref) // @kapi_ref's picture, dragged from the Bin
    await makeClip(deps, shotId, { videoId })
    expect(sent[1].input.image?.sha256).toBe(SHA('1'))
    expect(sent[1].input.refs?.map((r) => r.name)).toEqual(['kapi_side']) // the start is not also a reference
    await store.undo()
    expect(Object.values(store.get().links).filter((l) => l.to.id === shotId && l.role === 'frame')).toEqual([])
    await store.close()
  })

  it('a bare @kapi in its words still needs a front: nothing is sent', async () => {
    const { store, deps, sent, videoId } = await project({ ownVideo: true })
    const shotId = await addBox(store, videoId)
    await updateDoc(store, (d) => { d.shots[shotId].action = '@kapi sniffs a carrot.' }, 'edit')
    await expect(makeClip(deps, shotId, { videoId, fromWords: true })).rejects.toThrow('Set a front for @kapi first')
    expect(sent).toEqual([])
    await store.close()
  })
})

describe('Make clips straight from the script, with a bare @kapi and no front (owner, 2026-10-21)', () => {
  const WORDS = 'EXT. PARK - DAY\n@kapi chases a carrot across the lawn.'

  it('records the answer, sends nothing, says why, and never asks again; the Make room shows it', async () => {
    const { store, deps, sent, videoId } = await project({ words: WORDS })
    expect(waitsOnScriptAsk(store.get(), videoId)).toBeTruthy()
    const err = await answerScriptVideo(deps, videoId, STRAIGHT, `human:${MAYA.id}`).catch((e) => e)
    expect(err).toBeInstanceOf(FrontsMissingError)
    expect(sent).toEqual([])
    expect(scriptVideoAsk(store.get(), videoId)?.answers.at(-1)?.option_id).toBe(STRAIGHT)
    expect(waitsOnScriptAsk(store.get(), videoId)).toBeNull()
    const empty = roomEmpty(store.get(), store.get(), videoId, 0, 0)
    expect(empty).toMatchObject({ kind: 'no-shots', canPlan: true, why: 'Set a front for @kapi first: @kapi stands for the whole character, led by its front.' })
    await store.close()
  })

  it('after the front is set, Try again plans, and the shots appear as boxes made from words', async () => {
    const { store, deps, sent, videoId, kref } = await project({ words: WORDS })
    await answerScriptVideo(deps, videoId, STRAIGHT, `human:${MAYA.id}`).catch(() => {})
    await setFront(store, kref)
    const sb = storyboardOfVideo(store.get(), videoId)!
    const { jobId } = await planOrJoin(deps, { storyboardId: sb.id })
    expect(sent.map((x) => x.op)).toEqual(['shot_list'])
    expect(sent[0].input.refs?.map((r) => r.name)).toContain('kapi_front')
    expect(roomEmpty(store.get(), store.get(), videoId, 0, 0)).toMatchObject({ planning: true })
    await land(store, jobId)
    const made = boxes(store, videoId)
    expect(made.length).toBeGreaterThan(0)
    expect(roomEmpty(store.get(), store.get(), videoId, made.length, 0).kind).toBe('no-takes')
    // Straight from the script: a box's Make sends its words, no frame.
    await makeClip(deps, made[0].shotIds[0], { videoId })
    expect(sent.at(-1)!.op).toBe('clip')
    expect(sent.at(-1)!.input.image).toBeUndefined()
    await store.close()
  })

  it('a plan that failed is said in plain words, with Try again', async () => {
    const { store, videoId } = await project({ words: 'EXT. PARK - DAY\nA carrot rolls.' })
    const sb = storyboardOfVideo(store.get(), videoId)!
    const j = job(store.get(), 'shot_list', [], null, { state: 'failed', node: { kind: 'storyboard', id: sb.id }, error: { code: 'internal', message: 'The director failed (DirectorError).', retryable: true } })
    await systemUpdate(store, (d: ProductionDocument) => { d.jobs[j.id] = j }, 'sync')
    expect(roomEmpty(store.get(), store.get(), videoId, 0, 0)).toMatchObject({ kind: 'no-shots', canPlan: true, why: expect.stringMatching(/^The last Plan shots did not work: Dex could not plan these shots/) })
    await store.close()
  })
})
