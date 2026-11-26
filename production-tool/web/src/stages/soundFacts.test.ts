// The Sound view reads the cut (UAT 2026-11-21, F8): which clips carry sound, which lines are spoken, and that a
// voice-over is not voiced.
import { describe, expect, it } from 'vitest'
import type { ProductionDocument } from '../contracts/types'
import { mainVideo } from '../model/selectors'
import { MAYA, snapshotDoc } from '../test/jobFixtures'
import { SHA, addShots, addTake, job } from '../test/model'
import { lineFacts, shotSounds } from './soundFacts'

describe('the film’s sound as the cut has it', () => {
  it('names each shot’s sound and says which lines are heard', () => {
    const d = structuredClone(snapshotDoc(MAYA).get()) as ProductionDocument
    const shots = addShots(d, 3)
    const takes = shots.map((s, i) => addTake(d, s, SHA(String(i + 1)), job(d, 'clip', [], SHA(String(i + 1))), { pick: true }))
    takes[0].provider = 'runway'; takes[0].inputs = { model: 'gemini_omni_flash_1.1', length_s: 3 }
    takes[1].provider = 'runway'; takes[1].inputs = { model: 'veo3.1', length_s: 4 }
    const beat = (id: string, shot: string, kind: 'line' | 'vo', text: string, speaker: string) => {
      d.beats[id] = { id, v: 1, field_v: {}, shot_id: shot, kind, at_s: 1, text, speaker, rank: 'a0' } as never
    }
    beat('b1', shots[1].id, 'line', 'Good boy.', 'MAYA')
    beat('b2', shots[2].id, 'vo', 'Quietboil. Let them sleep.', 'NARRATOR')
    shots[2].kind = 'end_card'
    delete d.videos[mainVideo(d)!.id].timeline![Object.keys(d.videos[mainVideo(d)!.id].timeline!).find((k) => d.videos[mainVideo(d)!.id].timeline![k].source?.generation_id === takes[2].id)!]
    const videoId = mainVideo(d)!.id
    const ids = shots.map((s) => s.id)
    expect(shotSounds(d, videoId, ids).map((x) => [x.sound, x.words])).toEqual([
      ['background', 'Background sound · Gemini Omni Flash 1.1'], ['made', 'Clip sound · Veo 3.1'], ['silent', 'End card: silent'],
    ])
    const lines = lineFacts(d, videoId, ids)
    expect(lines.map((x) => [x.n, x.text, x.voiced])).toEqual([[2, 'Good boy.', true], [3, 'Quietboil. Let them sleep.', false]])
    expect(lines[1].why).toMatch(/^The end card has no clip, so its voice-over is not voiced/)
  })
})
