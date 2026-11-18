// Split and join on the track (features/connected-video.clan) go through the real CLAN store, which refused
// every seam until clan-store's leaf rules listed it (2026-10-19). The legacy Film editor's track view went
// with it (owner 2026-11-18); the Rooms test their own boxes.

import { describe, expect, it } from 'vitest'
import type { ProductionDocument } from '../contracts/types'
import { systemUpdate } from '../doc/store'
import { modelEntry } from './runs'
import { joinBefore, joinHere, rowTitle, splitHere, videoPlan, videoRows } from './runView'
import { mainVideo } from '../model/selectors'
import { MAYA } from '../test/jobFixtures'
import { SHA, addFrame, addShots, modelStore } from '../test/model'

const OMNI = modelEntry('runway', 'gemini_omni_flash_1.1')!
const rowsOf = (d: ProductionDocument, videoId: string) => videoRows(d, { jobs: {} }, videoId, videoPlan(d, videoId, OMNI))
const titles = (d: ProductionDocument, videoId: string) => rowsOf(d, videoId).map((r) => rowTitle(d, r))

describe('the real CLAN store', () => {
  it('saves Cut here and Join (an edl item\'s seam), without refusing them', async () => {
    const s = modelStore()
    await s.create(MAYA, 'Rows')
    let ids: string[] = []
    await systemUpdate(s, (d) => {
      const shots = addShots(d, 3)
      shots.forEach((x, i) => { x.duration_s = 2; addFrame(d, x, SHA(`${i}`), { pick: true }) })
      ids = shots.map((x) => x.id)
    }, 'sync')
    await s.flush()
    expect(s.trouble).toBeFalsy()
    const videoId = mainVideo(s.get())!.id
    await splitHere(s, videoId, ids[1])
    await s.flush()
    expect(s.trouble).toBeFalsy()
    expect(joinBefore(s.get(), videoId, ids[1])).toEqual({ kind: 'cut', by: 'human' })
    expect(titles(s.get(), videoId)).toEqual(['Shot 1 · 2 s', 'One video · shots 2–3 · 4 s'])
    await joinHere(s, videoId, ids[1])
    await s.flush()
    expect(s.trouble).toBeFalsy()
    expect(joinBefore(s.get(), videoId, ids[1])).toEqual({ kind: 'continue', by: 'human' })
    expect(titles(s.get(), videoId)).toEqual(['One video · shots 1–3 · 6 s'])
  })
})
