// The Script sheet's next step once every clip is made (Playwright live test 2026-11-18: "Every clip is made.
// Next: render the ad" with clips behind a changed frame and the ad already rendered).
import { describe, expect, it } from 'vitest'
import { emptyDocument } from '../doc/store'
import { mainScript, mainVideo } from '../model/selectors'
import { addFrame, addShots, addTake, id, job, MAYA, SHA } from '../test/model'
import { nextStep } from './nextStep'

function made() {
  const d = emptyDocument(MAYA)
  const sid = id('scene')
  d.scenes[sid] = { id: sid, v: 1, field_v: {}, script_id: mainScript(d)!.id, rank: 'a0', heading: 'EXT. MARKET - DAY', text: '' }
  const shots = addShots(d, 2, { scene_id: sid, action: 'A seller shakes out a cloth.' })
  for (const [i, s] of shots.entries()) {
    const f = addFrame(d, s, SHA(String(i)), { pick: true })
    addTake(d, s, SHA(`t${i}`), job(d, 'clip', [f.asset], SHA(`t${i}`), { state: 'completed' }), { pick: true })
  }
  return { d, shots, scriptId: mainScript(d)!.id, videoId: mainVideo(d)!.id }
}

describe('the next step once every clip is made', () => {
  it('asks for the render, then says the ad is rendered', () => {
    const { d, scriptId, videoId } = made()
    expect(nextStep(d, scriptId)).toMatchObject({ step: 'render', line: 'Every clip is made. Next: render the ad in the film.' })
    const r = { id: id('render'), v: 1, field_v: {}, video_id: videoId, version: 1, asset: SHA('ad') }
    d.renders = { ...d.renders, [r.id]: r as never }
    expect(nextStep(d, scriptId)?.line).toMatch(/^Every clip is made and the ad is rendered \(v1\)/)
  })
})
