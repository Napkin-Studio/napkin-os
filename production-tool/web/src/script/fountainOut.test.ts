// Fountain export and the print HTML (features/script-editor.clan, P3): the inverse of fountain.ts.

import { describe, expect, it } from 'vitest'
import { mainScript } from '../model/selectors'
import { MAYA, modelStore, seedStages } from '../test/model'
import { addScene } from './edits'
import { parseFountain } from './fountain'
import { fountainOut, screenplayHtml, scriptElements } from './fountainOut'

/** A script with one scene whose prose holds the new screenplay elements. */
async function scripted() {
  const store = modelStore()
  await store.create(MAYA, 'First Light')
  await seedStages(store)
  const scriptId = mainScript(store.get())!.id
  const sceneId = await addScene(store, scriptId)
  await store.change((d) => { d.scripts[scriptId].title = 'First Light'; d.scenes[sceneId].heading = 'EXT. BEACH - DAWN' }, { action: 'heading' })
  await store.text.replace('scene', sceneId, { type: 'doc', content: [
    { type: 'action', content: [{ type: 'text', text: 'Maya walks the waterline.' }] },
    { type: 'character', content: [{ type: 'text', text: 'MAYA' }] },
    { type: 'parenthetical', content: [{ type: 'text', text: 'quietly' }] },
    { type: 'dialogue', content: [{ type: 'text', text: 'Together now.', marks: [{ type: 'dual' }] }] },
    { type: 'transition', content: [{ type: 'text', text: 'CUT TO:' }] },
    { type: 'centered', content: [{ type: 'text', text: 'THE END' }] },
  ] }, `human:${MAYA.id}`, { undo: false })
  await store.flush()
  return { store, scriptId }
}

describe('fountainOut', () => {
  it('writes the title, heading, a dual cue, a transition and centred text, and re-imports to the same shapes', async () => {
    const { store, scriptId } = await scripted()
    const text = fountainOut(store.get(), scriptId)
    expect(text).toContain('Title: First Light')
    expect(text).toContain('EXT. BEACH - DAWN')
    expect(text).toContain('MAYA ^')       // the dual cue
    expect(text).toContain('CUT TO:')       // the transition
    expect(text).toContain('> THE END <')   // centred text
    // The inverse: re-importing the export keeps the transition, centred text and the dual mark.
    const back = parseFountain(text)
    const blocks = back.scenes[0].blocks
    expect(blocks).toContainEqual({ type: 'transition', text: 'CUT TO:' })
    expect(blocks).toContainEqual({ type: 'centered', text: 'THE END' })
    expect(blocks).toContainEqual({ type: 'dialogue', text: 'Together now.', dual: true })
  })

  it('scriptElements lists the ordered screenplay elements', async () => {
    const { store, scriptId } = await scripted()
    const { title, elements } = scriptElements(store.get(), scriptId)
    expect(title).toBe('First Light')
    expect(elements.map((e) => e.el)).toEqual(['heading', 'action', 'character', 'parenthetical', 'dialogue', 'transition', 'centered'])
    expect(elements.find((e) => e.el === 'character')?.dual).toBe(true)
  })

  it('screenplayHtml is a print-ready page with the heading and dialogue', async () => {
    const { store, scriptId } = await scripted()
    const html = screenplayHtml(store.get(), scriptId)
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('@page')
    expect(html).toContain('EXT. BEACH - DAWN')
    expect(html).toContain('class="character dual"')
    expect(html).toContain('Together now.')
  })

  it('an empty script exports nothing', async () => {
    const store = modelStore()
    await store.create(MAYA, 'Empty')
    await seedStages(store)
    await store.flush()
    expect(fountainOut(store.get(), mainScript(store.get())!.id)).toBe('')
  })
})
