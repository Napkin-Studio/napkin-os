// Apply as new version (ui-behaviour 3.12): v(n+1) kind edited with its edits, v(n) unchanged, the
// shot's frame now, its clip out of date, one undo step.
import { describe, expect, it } from 'vitest'
import { systemUpdate } from '../../doc/store'
import { currentFrame, framesOf, staleList } from '../../model/selectors'
import { addFrame, addShots, addTake, job, MAYA, modelStore, SHA } from '../../test/model'
import { applyEditedStep } from './apply'

async function world() {
  const s = modelStore()
  await s.create(MAYA, 'Image editor')
  let ids = { shot: '', v1: '' }
  await systemUpdate(s, (d) => {
    const [shot] = addShots(d, 1)
    const first = job(d, 'frame', [], SHA('a'), { node: { kind: 'shot', id: shot.id } })
    d.jobs[first.id] = first
    const v1 = addFrame(d, shot, SHA('a'), { pick: true, job: first })
    const clip = job(d, 'clip', [SHA('a')], SHA('c'), { node: { kind: 'shot', id: shot.id } })
    d.jobs[clip.id] = clip
    addTake(d, shot, SHA('c'), clip, { pick: true })
    ids = { shot: shot.id, v1: v1.id }
  })
  await s.flush()
  return { s, ...ids }
}

describe('Apply as new version', () => {
  it('saves v2 as an edit of v1, makes it the frame and puts the clip out of date', async () => {
    const w = await world()
    const made = await applyEditedStep(w.s, w.shot, w.v1, { sha: SHA('e'), bytes: 10, w: 1344, h: 768, edits: [{ op: 'text', params: { text: 'Hi' } }] })
    await w.s.flush()
    const d = w.s.get()
    expect(made).toMatchObject({ version: 2, kind: 'edited', parent_id: w.v1, asset: SHA('e'), crew: 'rhea', edits: [{ op: 'text' }] })
    expect(d.frames[w.v1]).toMatchObject({ version: 1, asset: SHA('a') })
    expect(currentFrame(d, w.shot)?.id).toBe(made!.id)
    expect(d.assets[SHA('e')]).toMatchObject({ origin: 'edited', w: 1344, h: 768 })
    expect(staleList(d).some((m) => m.target.kind === 'take' && m.caused_by.kind === 'frame')).toBe(true)
  })
  it('is one undo step', async () => {
    const w = await world()
    await applyEditedStep(w.s, w.shot, w.v1, { sha: SHA('e'), bytes: 10, w: 1344, h: 768, edits: [] })
    await w.s.flush()
    expect(w.s.undoLabels().undo).toMatch(/^apply edits as v2/)
    await w.s.undo()
    await w.s.flush()
    const d = w.s.get()
    expect(framesOf(d, w.shot)).toHaveLength(1)
    expect(currentFrame(d, w.shot)?.id).toBe(w.v1)
    expect(staleList(d)).toHaveLength(0)
  })
})
