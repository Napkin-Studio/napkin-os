// The Script editor's target length (features/script-editor.clan; owner, 2026-10-15: "Why can't I change
// the time?"): a picker with the common ad lengths and Other…, written to the script, its storyboard and
// that storyboard's video in one undo step, and read by Dex's plan and the length meter.

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { updateDoc } from '../doc/store'
import { planInput } from '../jobs/plan'
import { mainScript, mainStoryboard, videoOfStoryboard } from '../model/selectors'
import { MockRelay } from '../relay/mock'
import { MAYA, modelStore } from '../test/model'
import { composeScript } from './compose'
import { cleanTarget, lengthChoices, setScriptTarget } from './length'
import { LengthPicker } from './LengthPicker'

describe('the target length', () => {
  it('offers 6, 10, 15, 20, 30, 45 and 60 s, the current length when it is not one of them, and Other…', () => {
    expect(lengthChoices(15)).toEqual([6, 10, 15, 20, 30, 45, 60])
    expect(lengthChoices(25)).toEqual([6, 10, 15, 20, 25, 30, 45, 60])
    const html = renderToStaticMarkup(<LengthPicker value={15} onPick={() => {}} />)
    for (const n of [6, 10, 15, 20, 30, 45, 60]) expect(html).toContain(`>${n} s</option>`)
    expect(html).toContain('Other…')
    expect(html).toContain('aria-label="Target length"')
  })

  it('keeps a typed length to whole seconds from 1 to 600, as the contract stores it', () => {
    expect(cleanTarget('25')).toBe(25)
    expect(cleanTarget('12.6 s')).toBe(13)
    expect(cleanTarget(0)).toBe(1)
    expect(cleanTarget(9000)).toBe(600)
    expect(cleanTarget('soon')).toBeNull()
  })

  it('sets the script, its storyboard and its video in one undo step; Dex plans to it and the meter reads it', async () => {
    const store = modelStore()
    await store.create(MAYA, 'Length')
    const d0 = store.get()
    const script = mainScript(d0)!
    const sb = mainStoryboard(d0)!
    const video = videoOfStoryboard(d0, sb.id)
    expect(composeScript(d0)!.storyboard?.target_s ?? script.target_s).toBe(15)

    await updateDoc(store, (d) => setScriptTarget(d, script.id, sb.id, 30), 'set the script length to 30 s')
    await store.flush()
    const d1 = store.get()
    expect(d1.scripts[script.id].target_s).toBe(30)
    expect(d1.storyboards[sb.id].target_s).toBe(30)
    expect(d1.videos[video!.id].target_s).toBe(30)
    const c = composeScript(d1)!
    expect(c.storyboard?.target_s ?? c.script.target_s).toBe(30)
    const relay = new MockRelay({ renderer: { render: async () => [] }, persistKey: null })
    expect((await planInput(relay, d1)).targetS).toBe(30)

    expect(store.undoLabels().undo).toBe('set the script length to 30 s')
    await store.undo()
    await store.flush()
    const d2 = store.get()
    expect(d2.scripts[script.id].target_s).toBe(15)
    expect(d2.storyboards[sb.id].target_s).toBe(15)
  })
})
