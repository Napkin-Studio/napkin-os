// "New script from this text" (UAT round 2 R2-7): the note's words land on the new script's page.
import { describe, expect, it } from 'vitest'
import type { ProductionDocument } from '../contracts/types'
import { mainScript, scenesOf } from '../model/selectors'
import { modelStore, MAYA } from '../test/model'
import { pageSceneId, wordsOnPage } from './edits'

describe('a script made from a note', () => {
  it('starts with the note’s words on its page, one block per line', async () => {
    const s = modelStore()
    await s.create(MAYA, 'Rain')
    const d = s.get() as unknown as ProductionDocument
    const script = mainScript(d)!
    expect(scenesOf(d, script.id)).toHaveLength(0)
    await wordsOnPage(s, script.id, 'Mia runs to the gate.\nThe puppy follows.')
    const after = s.get() as unknown as ProductionDocument
    const page = scenesOf(after, script.id)
    expect(page.map((x) => x.id)).toEqual([pageSceneId(script.id)])
    expect(JSON.stringify(s.text.prose('scene', page[0].id))).toContain('Mia runs to the gate.')
    expect(JSON.stringify(s.text.prose('scene', page[0].id))).toContain('The puppy follows.')
    // A script with words already keeps them.
    await wordsOnPage(s, script.id, 'something else')
    expect(JSON.stringify(s.text.prose('scene', page[0].id))).not.toContain('something else')
    await s.close()
  })
})
