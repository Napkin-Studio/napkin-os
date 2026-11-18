// A storyboard frame's pin or "guide" follows the plan now: a box made together and then made apart
// no longer marks its later frames "guide" from the take it was (live test 2026-11-16).
import { describe, expect, it, vi } from 'vitest'
import { CONFIGS } from '../contracts/load'
import type { Config, Job, ProductionDocument } from '../contracts/types'
import { SnapshotDocumentStore } from '../doc/store'
import { applyRunTake } from '../jobs/handlers'
import { makeClips, modelEntry } from '../jobs/runs'
import { frameMarks, joinSelection, separateSelection, videoPlan } from '../jobs/runView'
import { mainVideo } from '../model/selectors'
import { MAYA, snapshotDoc } from '../test/jobFixtures'
import { SHA, addFrame, addShots } from '../test/model'
import { marksNow } from './marksNow'

vi.mock('../jobs/assets', () => ({ assetRef: async (_relay: unknown, sha: string) => ({ sha256: sha, url: `https://cdn.test/${sha}`, mime: 'image/png' }) }))

const on: Config = { ...CONFIGS.live, flags: { ...CONFIGS.live.flags, connectedVideo: true } }
const WAN3 = modelEntry('runway', 'wan3')!

describe('frame marks follow the plan', () => {
  it('after a box made together is made apart, no frame says guide', async () => {
    const d = structuredClone(snapshotDoc(MAYA).get()) as ProductionDocument
    const shots = addShots(d, 3)
    shots.forEach((s, i) => { s.duration_s = 3; s.action = `Action ${i + 1}.`; addFrame(d, s, SHA(String(i + 1)), { pick: true }) })
    const store = new SnapshotDocumentStore(d, null, 0)
    const videoId = mainVideo(d)!.id
    const runner = { submit: vi.fn(async () => 'job_1') }
    const deps = { relay: {} as never, doc: store as never, ui: { get: () => ({ jobs: {} }) } as never, runner: runner as never }
    await joinSelection(store, videoId, shots.map((s) => s.id))
    await makeClips(deps, { videoId, shots, ids: shots.map((s) => s.id), config: on, join: 'film', modelChoice: { provider: 'runway', model: 'wan3' }, busy: () => false })
    const made = structuredClone(store.get())
    const runId = Object.entries(made.videos[videoId].runs!).find(([, r]) => !!r.job_id)![0]
    applyRunTake(made, { jobId: 'job_1', op: 'clip', provider: 'runway', model: 'wan3', kind: 'generated', outputs: [{ sha256: SHA('v'), durationS: 9 }] } as unknown as Job, { videoId, runId })
    const landed = new SnapshotDocumentStore(made, null, 0)
    const together = videoPlan(landed.get(), videoId, WAN3)
    expect(Object.values(marksNow(landed.get(), videoId, together))).toEqual(['pin', 'guide', 'guide'])
    await separateSelection(landed, videoId, shots.map((s) => s.id))
    const apart = videoPlan(landed.get(), videoId, WAN3)
    expect(Object.values(frameMarks(landed.get(), videoId, apart))).toContain('guide') // the take still holds them
    expect(Object.values(marksNow(landed.get(), videoId, apart))).toEqual(['pin', 'pin', 'pin'])
  })
})
