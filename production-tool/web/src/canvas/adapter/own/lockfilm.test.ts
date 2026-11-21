import { describe, expect, it } from 'vitest'
import type { ProductionDocument } from '../../../contracts/types'
import { addShots, modelStore, MAYA } from '../../../test/model'
import { mainScript, mainStoryboard, openVideo, storyboardOfVideo, shotsOf } from '../../../model/selectors'
import { cardOf, seedNodes } from '../../nodes/nodes'
import { makeVideo } from '../../nodes/make'
import { updateDoc } from '../../../doc/store'
import { CanvasDocSync } from '../../sync'
import { OwnAdapter } from './adapter'

describe('Make clips from the storyboard, then reopen the Film node', () => {
  it('the film is found again', async () => {
    const s = modelStore()
    await s.create(MAYA, 'Rain')
    const a = new OwnAdapter()
    a.resize(1600, 1000, 0, 0)
    await updateDoc(s, (d) => { addShots(d, 3, { action: 'x' }) }, 'plan')
    a.transact((els) => [...els, ...seedNodes(a, s.get() as unknown as ProductionDocument)], { undoable: false })
    const sync = new CanvasDocSync({ doc: s, cancel: () => {} })
    await sync.nodes(a.elements())
    const doc = () => s.get() as unknown as ProductionDocument
    const sb = mainStoryboard(doc())!
    const r = await makeVideo({ canvas: a, doc: s }, { storyboardId: sb.id, scriptId: mainScript(doc())!.id })
    await sync.nodes(a.elements())
    const card = a.elements().find((e) => cardOf(e)?.kind === 'video' && cardOf(e)?.id === r.videoId)!
    expect(card).toBeTruthy()
    expect(openVideo(doc(), { video: cardOf(card)!.id })?.id).toBe(r.videoId)
    expect(storyboardOfVideo(doc(), r.videoId)?.id).toBe(sb.id)
    expect(shotsOf(doc(), sb.id).length).toBe(3)
    await s.close()
  })
})
