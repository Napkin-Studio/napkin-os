// The Video editor's writes land in the video that is open: a second video's take pick and notes went
// into the main video's cut (2026-10-15), so its player and timeline showed another cut.

import { describe, expect, it } from 'vitest'
import { systemUpdate, updateDoc } from '../doc/store'
import { currentTake, cutOf, mainVideo, shotsOf, storyboardOfVideo, videoOfShot } from '../model/selectors'
import { ownShotList } from '../jobs/prompt'
import { addShot, moveShot } from './storyboardEdits'
import { addShots, addTake, id, job, MAYA, modelStore, SHA } from '../test/model'
import { addTakeNote, pickTake } from './videoEdits'

async function twoVideos() {
  const store = modelStore()
  await store.create(MAYA, 'First Light')
  await store.flush()
  const sb = id('storyboard')
  const v2 = id('video')
  const l = id('link')
  await systemUpdate(store, (d) => {
    d.storyboards[sb] = { id: sb, v: 1, field_v: {}, title: 'Storyboard 2', ratio: '9:16', target_s: 15 }
    d.videos[v2] = { id: v2, v: 1, field_v: {}, title: 'Video 2', ratio: '9:16', target_s: 15, timeline: {} }
    d.links[l] = { id: l, v: 1, field_v: {}, from: { kind: 'storyboard', id: sb }, to: { kind: 'video', id: v2 }, role: 'renders' }
  }, 'second video')
  let shotId = ''
  let takeId = ''
  await updateDoc(store, (d) => {
    const [s] = addShots(d, 1)
    s.storyboard_id = sb
    shotId = s.id
    const j = job(d, 'clip', [], SHA('a'))
    d.jobs[j.id] = j
    takeId = addTake(d, s, SHA('a'), j).id
  }, 'plan')
  await store.flush()
  return { store, v2, shotId, takeId }
}

describe('a second video\'s cut and notes', () => {
  it('a take picked on its shot goes into that video\'s cut, not the main one\'s', async () => {
    const { store, v2, shotId, takeId } = await twoVideos()
    await updateDoc(store, (d) => pickTake(d, shotId, takeId), 'pick take')
    expect(currentTake(store.get(), shotId, v2)?.id).toBe(takeId)
    expect(cutOf(store.get(), mainVideo(store.get())!.id)).toEqual([])
  })

  it('a note on its clip is on that video', async () => {
    const { store, v2, shotId, takeId } = await twoVideos()
    let rev = ''
    await updateDoc(store, (d) => { rev = addTakeNote(d, { takeId, shotId, shotS: 5, atS: 1, text: 'brighter', by: `human:${MAYA.id}` }) }, 'comment')
    expect(store.get().reviews[rev].video_id).toBe(v2)
  })
})

describe('a video\'s own shots, edited in the Video editor (decided 2026-10-15)', () => {
  it('+ Shot adds to the video\'s own shot list, and moves stay inside it', async () => {
    const store = modelStore()
    await store.create(MAYA, 'First Light')
    await store.flush()
    const v = mainVideo(store.get())!.id
    // A video no storyboard renders (made from a script alone) gets its own list.
    await updateDoc(store, (d) => { for (const l of Object.values(d.links)) if (l.to.id === v) delete d.links[l.id] }, 'unlink')
    const own = await ownShotList(store, v)
    expect(store.get().storyboards[own]).toMatchObject({ implicit: true, video_id: v })
    expect(storyboardOfVideo(store.get(), v)?.id).toBe(own)
    let a = ''
    let b = ''
    await updateDoc(store, (d) => { a = addShot(d, own); b = addShot(d, own) }, 'add shot')
    expect(shotsOf(store.get(), own).map((s) => s.id)).toEqual([a, b])
    await updateDoc(store, (d) => moveShot(d, b, -1), 'move shot')
    expect(shotsOf(store.get(), own).map((s) => s.id)).toEqual([b, a])
    expect(videoOfShot(store.get(), a)?.id).toBe(v)
  })
})
