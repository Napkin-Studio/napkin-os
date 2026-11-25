// UAT round 4 gate: one source of truth for the film's length. The script said 6 s and Plan shots made 15 s, because the
// length was set on the script before it drove a storyboard, and the storyboard kept its own default.
import { describe, expect, it } from 'vitest'
import type { ProductionDocument } from '../contracts/types'
import { mainScript, mainStoryboard, mainVideo, scriptOfStoryboard } from '../model/selectors'
import { setTarget } from '../stages/storyboardEdits'
import { MAYA, modelStore, seedStages } from '../test/model'
import { applyShotList, filmTarget } from './plan'

async function project(): Promise<ProductionDocument> {
  const s = modelStore()
  await s.create(MAYA, 'Copperell')
  await seedStages(s)
  return structuredClone(s.get()) as ProductionDocument
}

describe('the film\'s length is one value', () => {
  it('Plan shots plans to the length set on the script, and the storyboard and film take it when the plan lands', async () => {
    const d = await project()
    const sb = mainStoryboard(d)!
    expect(scriptOfStoryboard(d, sb.id)).toBeDefined()
    d.scripts[mainScript(d)!.id].target_s = 6 // set before the chain was joined: the storyboard still says 15
    d.storyboards[sb.id].target_s = 15
    expect(filmTarget(d, sb.id)).toBe(6)
    applyShotList(d, { shots: [{ id: 'p1', duration_s: 6, camera: { size: 'wide' }, action: 'A hand holds the bottle.', refs: [], beats: [] }] } as never, { storyboardId: sb.id })
    expect(d.storyboards[sb.id].target_s).toBe(6)
    expect(mainVideo(d)!.target_s).toBe(6)
  })

  it('setting the length on the storyboard sets the script and the film too', async () => {
    const d = await project()
    setTarget(d, 10)
    expect(mainStoryboard(d)!.target_s).toBe(10)
    expect(mainScript(d)!.target_s).toBe(10)
    expect(mainVideo(d)!.target_s).toBe(10)
  })
})
