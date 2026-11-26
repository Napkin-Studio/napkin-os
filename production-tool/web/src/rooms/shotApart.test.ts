// One shot out of a box made together (live test 2026-11-16, finding 10): the Make room could only switch a whole
// box between Made together and Made apart, and the Change tab's "Make shot N apart instead" only opened the Box
// tab. takeShotOut and splitBoxAt (jobs/runView) change one join each, through the real store.

import { describe, expect, it } from 'vitest'
import { effectiveConfig } from '../capabilities'
import { systemUpdate } from '../doc/store'
import { joinHere, splitBoxAt, takeShotOut } from '../jobs/runView'
import { mainVideo } from '../model/selectors'
import type { ModelStore } from '../model/store'
import { addShots, MAYA, modelStore } from '../test/model'
import { roomBoxes } from './model'

const config = (() => {
  const c = effectiveConfig('live', 'mock')
  return { ...c, flags: { ...c.flags, connectedVideo: true } }
})()
const UI = { jobs: {} }

/** Four 2 s shots in one scene, joined by a person into one box made together. */
async function fourTogether() {
  const store = modelStore()
  await store.create(MAYA, 'Rain')
  let ids: string[] = []
  let videoId = ''
  await systemUpdate(store, (d) => {
    ids = addShots(d, 4, { duration_s: 2 }).map((s) => s.id)
    videoId = mainVideo(d)!.id
  }, 'sync')
  for (const id of ids.slice(1)) await joinHere(store, videoId, id)
  await store.flush()
  if (store.trouble) throw new Error(`the fixture was refused: ${store.trouble}`)
  return { store, ids, videoId }
}

const boxesOf = (s: ModelStore, videoId: string) => roomBoxes(s.get(), UI, videoId, config).map((b) => [b.shotIds.length, b.together])

describe('one shot out of a box made together', () => {
  it('starts as one box of four', async () => {
    const { store, videoId } = await fourTogether()
    expect(boxesOf(store, videoId)).toEqual([[4, true]])
  })

  it('takeShotOut makes that shot its own box and keeps the rest together on each side', async () => {
    const { store, ids, videoId } = await fourTogether()
    await takeShotOut(store, videoId, ids[1])
    await store.flush()
    expect(store.trouble).toBeNull()
    const boxes = roomBoxes(store.get(), UI, videoId, config)
    expect(boxes.map((b) => b.shotIds)).toEqual([[ids[0]], [ids[1]], [ids[2], ids[3]]])
    expect(boxes.map((b) => b.together)).toEqual([false, false, true])
  })

  it('splitBoxAt ends the box before that shot: two boxes made together', async () => {
    const { store, ids, videoId } = await fourTogether()
    await splitBoxAt(store, videoId, ids[2])
    await store.flush()
    expect(roomBoxes(store.get(), UI, videoId, config).map((b) => b.shotIds)).toEqual([[ids[0], ids[1]], [ids[2], ids[3]]])
  })

  it('each is one undo step', async () => {
    const { store, ids, videoId } = await fourTogether()
    await takeShotOut(store, videoId, ids[3])
    await store.flush()
    expect(boxesOf(store, videoId)).toEqual([[3, true], [1, false]])
    await store.undo()
    await store.flush()
    expect(boxesOf(store, videoId)).toEqual([[4, true]])
  })
})
