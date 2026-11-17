// A changed frame marks its joined take out of date (QA 2026-11-17, ~/Documents/napkin-design-mocks/
// tool-test-2026-11-17/report.html: shot 2 went v1 to v5 and the storyboard still said "Clip ready" for a
// take made from v1). A joined take sends every frame as a guide (director.v11 take_refs), so every shot
// of it is checked against the take job's inputs.

import { describe, expect, it } from 'vitest'
import { pickInCut } from '../doc/cutWrites'
import { systemUpdate } from '../doc/store'
import { mainVideo } from '../model/selectors'
import { addFrame, addShots, addTake, job, MAYA, modelStore, seedStages, SHA } from '../test/model'
import { clipBehind } from './stale'

async function joined(inputs: (frames: { a: string; b: string }) => string[]) {
  const s = modelStore()
  await s.create(MAYA, 'Market')
  await seedStages(s)
  let ids = { one: '', two: '' }
  await systemUpdate(s, (d) => {
    const [one, two] = addShots(d, 2)
    addFrame(d, one, SHA('a'), { pick: true })
    addFrame(d, two, SHA('b'), { pick: true })
    const j = job(d, 'clip', inputs({ a: SHA('a'), b: SHA('b') }), SHA('v'))
    d.jobs[j.id] = j
    const g = addTake(d, one, SHA('v'), j, { pick: true })
    g.shot_ids = [one.id, two.id]
    g.segments = [{ shot_id: one.id, in_s: 0, out_s: 5 }, { shot_id: two.id, in_s: 5, out_s: 10 }]
    pickInCut(d, mainVideo(d)!.id, two.id, g.id)
    // Shot 2's frame changes: v2 is picked.
    addFrame(d, two, SHA('c'), { pick: true })
    ids = { one: one.id, two: two.id }
  }, 'seed')
  return { d: s.get(), ids }
}

describe('a joined take and its frames', () => {
  it('a changed frame in any shot of the take puts its clip out of date', async () => {
    const { d, ids } = await joined((f) => [f.a, f.b])
    expect(clipBehind(d, ids.two)?.reason).toBe("Shot 2's frame changed")
    expect(clipBehind(d, ids.one)).toBeUndefined()
  })
  it('an older take that sent only the first frame says nothing about the second shot', async () => {
    const { d, ids } = await joined((f) => [f.a])
    expect(clipBehind(d, ids.two)).toBeUndefined()
  })
})
