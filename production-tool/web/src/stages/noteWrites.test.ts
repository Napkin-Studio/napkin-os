// A note on a clip saves through the real CLAN store (2026-10-19: every boxed note on a 1.5 s shot was refused
// and undone, "That change could not be saved to the .clan", because a moment needs a window and a shot under
// 2 s has none).
import { describe, expect, it } from 'vitest'
import { systemUpdate, updateDoc } from '../doc/store'
import { MAYA } from '../test/jobFixtures'
import { SHA, addFrame, addShots, addTake, job, modelStore } from '../test/model'
import { addTakeNote } from './videoEdits'

async function shotWithTake(durationS: number) {
  const s = modelStore()
  await s.create(MAYA, 'Notes')
  let shotId = ''
  let takeId = ''
  await systemUpdate(s, (d) => {
    const [shot] = addShots(d, 1)
    shot.duration_s = durationS
    addFrame(d, shot, SHA('0'), { pick: true })
    addTake(d, shot, SHA('a'), job(d, 'clip', [], SHA('a')), { pick: true })
    shotId = shot.id
    takeId = Object.keys(d.takes)[0]
  }, 'sync')
  await s.flush()
  return { s, shotId, takeId }
}

const region = { x: 0.2, y: 0.2, w: 0.3, h: 0.3 }

describe('a note on a clip, through the real store', () => {
  it('on a shot too short for a window: saved for the whole shot, with its box', async () => {
    const { s, shotId, takeId } = await shotWithTake(1.5)
    let id = ''
    await updateDoc(s, (d) => { id = addTakeNote(d, { takeId, shotId, shotS: 1.5, atS: 0.6, text: 'make the shirt red', region, by: `human:${MAYA.id}` }) }, 'comment')
    await s.flush()
    expect(s.trouble).toBeFalsy()
    const r = s.get().reviews[id]
    expect(r.at_s).toBeUndefined()
    expect(r.window).toBeUndefined()
    expect(r.region).toEqual(region)
  })

  it('on a longer shot: saved at its moment with a window', async () => {
    const { s, shotId, takeId } = await shotWithTake(4)
    let id = ''
    await updateDoc(s, (d) => { id = addTakeNote(d, { takeId, shotId, shotS: 4, atS: 1.2, text: 'make the shirt red', region, by: `human:${MAYA.id}` }) }, 'comment')
    await s.flush()
    expect(s.trouble).toBeFalsy()
    expect(s.get().reviews[id]).toMatchObject({ at_s: 1.2, window: { from_s: 0, to_s: 3 } })
  })
})
