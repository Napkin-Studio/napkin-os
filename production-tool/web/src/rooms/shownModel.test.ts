// The one rule behind F3 (UAT round 2), its leftover (round 3) and R4-F1 (round 4): the model a box shows is the model
// in the request its Make sends, on every path a box's Make takes — a joined box (a take), a lone shot, a spoken
// line (makeRuns' speaker once overrode the pick with Veo 3.1), and the frame-then-clip chain of a character shot
// with no frame. Round 4's live repro: Box 3 (shot 3, "Good boy.") picked on WAN 3, sent as Veo 3.1 with sound.
import { describe, expect, it, vi } from 'vitest'
import { CONFIGS } from '../contracts/load'
import type { Config, JobInput, ModelChoice, ProductionDocument, Shot } from '../contracts/types'
import { SnapshotDocumentStore } from '../doc/store'
import { clipAfterFrame } from '../jobs/wire'
import { mainVideo } from '../model/selectors'
import { MAYA, addRef, snapshotDoc } from '../test/jobFixtures'
import { SHA, addFrame, addShots, asset } from '../test/model'
import { roomBoxModel } from './joinCut'
import { makeBox } from './makeBox'
import { roomBoxes, type Box } from './model'

vi.mock('../jobs/assets', () => ({ assetRef: async (_relay: unknown, sha: string) => ({ sha256: sha, url: `https://cdn.test/${sha}`, mime: 'image/png' }) }))

const on: Config = { ...CONFIGS.live, flags: { ...CONFIGS.live.flags, connectedVideo: true } }
const wan3: ModelChoice = { provider: 'runway', model: 'wan3' }
const omni: ModelChoice = { provider: 'runway', model: 'gemini_omni_flash_1.1' }
const veo: ModelChoice = { provider: 'runway', model: 'veo3.1' }
const kling: ModelChoice = { provider: 'runway', model: 'kling3.0_pro' }

/** Round 4's film: shots 1-2 one video, shot 3 a spoken line, shot 4 alone, shot 5 a character close with no frame. */
function film() {
  const d = structuredClone(snapshotDoc(MAYA).get()) as ProductionDocument
  const shots = addShots(d, 5)
  const lengths = [3, 2, 1.5, 1.5, 2]
  shots.forEach((s, i) => Object.assign(s, { duration_s: lengths[i], action: `Action ${i + 1}.` }))
  shots[3].camera = { size: 'close' } as Shot['camera']
  shots[4].camera = { size: 'extreme_close' } as Shot['camera']
  shots[4].action = '@maya_front raises her mug.'
  shots[4].refs = [addRef(d, 'maya', 'front', SHA('m')).id]
  d.assets[SHA('m')] = asset(SHA('m'))
  // Shot 5 is in another scene: its own box, a character close with no frame yet.
  shots[4].scene_id = 'scene_two'
  shots.slice(0, 4).forEach((s, i) => addFrame(d, s, SHA('0123456789'[i]), { pick: true }))
  d.beats = { ...(d.beats ?? {}), b_line: { id: 'b_line', v: 1, field_v: {}, shot_id: shots[2].id, kind: 'line', at_s: 0.5, text: 'Good boy.', speaker: 'MAYA', rank: 'a0' } as never }
  const store = new SnapshotDocumentStore(d, null, 0)
  const sent: { op: string; input: JobInput; modelChoice?: ModelChoice; jobId: string }[] = []
  const jobs: Record<string, unknown> = {}
  let k = 0
  const runner = { submit: vi.fn(async (op: string, input: JobInput, _p: string[], _purpose: unknown, _id?: string, modelChoice?: ModelChoice, extras?: { local?: unknown }) => {
    const jobId = `job_${++k}`
    sent.push({ op, input, ...(modelChoice ? { modelChoice } : {}), jobId })
    if (extras?.local) jobs[jobId] = extras.local
    return jobId
  }) }
  const ui = { get: () => ({ jobs }), update: (fn: (u: { jobs: typeof jobs }) => void) => fn({ jobs }) }
  const deps = { relay: {} as never, doc: store as never, ui: ui as never, runner: runner as never }
  const videoId = mainVideo(store.get())!.id
  return { store, shots, deps, sent, videoId, boxes: () => roomBoxes(store.get(), { jobs: {} }, videoId, on) }
}

const boxOf = (boxes: Box[], shotId: string) => boxes.find((b) => b.shotIds.includes(shotId))!

describe('the model a box shows is the model its Make sends (F3, R3 leftover, R4-F1)', () => {
  it('round 4 repro: a spoken-line box picked on WAN 3 goes as WAN 3, never Veo 3.1', async () => {
    const f = film()
    const box = boxOf(f.boxes(), f.shots[2].id)
    expect(box.shotIds).toEqual([f.shots[2].id])
    const models = { [box.key]: wan3 }
    expect(roomBoxModel(f.store.get(), box, on, models)).toEqual(wan3)
    const made = await makeBox(f.deps, { videoId: f.videoId, box, config: on, models, busy: () => false })
    expect(made.failed).toEqual([])
    expect(f.sent.map((s) => s.modelChoice)).toEqual([wan3])
  })

  // Every box, on every model the room offers it: shown === sent.
  for (const pick of [wan3, omni, veo, kling]) {
    it(`every box picked on ${pick.model} sends what it shows`, async () => {
      const f = film()
      const boxes = f.boxes()
      expect(boxes.map((b) => b.shotIds.length)).toEqual([2, 1, 1, 1])
      for (const box of boxes) {
        const models = { [box.key]: pick }
        const shown = roomBoxModel(f.store.get(), box, on, models)
        const before = f.sent.length
        const made = await makeBox(f.deps, { videoId: f.videoId, box, config: on, models, busy: () => false })
        expect(made.failed).toEqual([])
        const mine = f.sent.slice(before)
        // The frame-then-clip chain: the frame lands, then its clip goes on the box's model.
        for (const s of mine.filter((x) => x.op === 'frame')) {
          addFrame(f.store.get(), f.store.get().shots[box.shotIds[0]], SHA('f'), { pick: true })
          await clipAfterFrame(f.deps, s.jobId, box.shotIds[0])
        }
        const clips = f.sent.slice(before).filter((s) => s.op === 'clip')
        expect(clips.length, `box ${box.n}`).toBe(1)
        expect(clips[0].modelChoice, `box ${box.n} on ${pick.model}`).toEqual({ provider: shown!.provider, model: shown!.model })
      }
    })
  }
})
