// @vitest-environment happy-dom
// The screenplay's elements (ui-behaviour 3.10): the Tab and Enter cycle, a heading line
// starting a scene as one undo step, the Shot element, and the caret chain across fragments.

import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { mainScript, mainStoryboard, scenesOf } from '../model/selectors'
import { MAYA, modelStore } from '../test/model'
import { CaretChain } from './caret'
import { addBeat, addScene, insertShot, splitScene } from './edits'
import { editorExtensions, headingOf, type KeyHooks } from './extensions'

const editors: Editor[] = []
afterEach(() => {
  for (const e of editors.splice(0)) if (!e.isDestroyed) e.destroy()
  document.body.innerHTML = ''
})

function editor(kind: 'scene' | 'shot', keys: KeyHooks = {}) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const e = new Editor({ element, extensions: editorExtensions({ kind, keys }) })
  editors.push(e)
  return e
}
const press = (e: Editor, key: string, extra: KeyboardEventInit = {}) => e.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }))
const types = (e: Editor) => (e.getJSON().content ?? []).map((b) => b.type)

describe('placeholders', () => {
  it('a transaction that adds empty blocks past the old end does not throw, and only the first block gets the first line', () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const seen: number[] = []
    const e = new Editor({ element, extensions: editorExtensions({ kind: 'shot', placeholder: (_t, i) => { seen.push(i); return i === 0 ? 'first' : 'later' } }) })
    editors.push(e)
    const action = e.schema.nodes.action ?? e.schema.nodes.paragraph
    expect(() => e.view.dispatch(e.state.tr.insert(e.state.doc.content.size, [action.create(), action.create(), action.create()]))).not.toThrow()
    expect(e.view.dom.querySelector('[data-placeholder="first"]')).not.toBeNull()
  })
})

describe('the element cycle', () => {
  it('Tab cycles Action → Character → Dialogue → Action; Enter after a Character makes Dialogue, after Dialogue Action', () => {
    const e = editor('scene')
    e.commands.focus()
    expect(types(e)).toEqual(['action'])
    press(e, 'Tab')
    expect(types(e)).toEqual(['character'])
    press(e, 'Tab')
    expect(types(e)).toEqual(['dialogue'])
    press(e, 'Tab')
    expect(types(e)).toEqual(['action'])
    press(e, 'Tab', { shiftKey: true })
    expect(types(e)).toEqual(['dialogue'])
    e.commands.setContent({ type: 'doc', content: [{ type: 'character', content: [{ type: 'text', text: 'MAYA' }] }] })
    e.commands.focus('end')
    press(e, 'Enter')
    expect(types(e)).toEqual(['character', 'dialogue'])
    e.commands.insertContent('Hello.')
    press(e, 'Enter')
    expect(types(e)).toEqual(['character', 'dialogue', 'action'])
  })

  it('Escape, then Tab, leaves the editor (Tab is not taken)', () => {
    const e = editor('scene')
    e.commands.focus()
    press(e, 'Escape')
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    e.view.dom.dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(false)
    expect(types(e)).toEqual(['action'])
  })

  it('in a shot, Tab goes from the action to a Direction block, and an empty Direction backspaces away', () => {
    const e = editor('shot')
    e.commands.setContent({ type: 'doc', content: [{ type: 'action', content: [{ type: 'text', text: 'Walks.' }] }] })
    e.commands.focus('end')
    press(e, 'Tab')
    expect(types(e)).toEqual(['action', 'direction'])
    press(e, 'Backspace')
    expect(types(e)).toEqual(['action'])
  })

  it('a heading line is recognised: INT., EXT., INT./EXT., I/E, EST. and a forced "."', () => {
    expect(headingOf('int. kitchen - day')).toBe('INT. KITCHEN - DAY')
    expect(headingOf('EXT. BEACH')).toBe('EXT. BEACH')
    expect(headingOf('INT./EXT. CAR - NIGHT')).toBe('INT./EXT. CAR - NIGHT')
    expect(headingOf('I/E VAN')).toBe('I/E VAN')
    expect(headingOf('EST. CITY')).toBe('EST. CITY')
    expect(headingOf('.INSIDE THE CAR')).toBe('INSIDE THE CAR')
    expect(headingOf('...and then')).toBeNull()
    expect(headingOf('Interior design')).toBeNull()
  })

  it('Enter on a heading line hands it to the page with its block', () => {
    const got: [string, number][] = []
    const e = editor('scene', { sceneHeading: (h, i) => { got.push([h, i]); return true } })
    e.commands.setContent({ type: 'doc', content: [{ type: 'action', content: [{ type: 'text', text: 'Rain.' }] }, { type: 'action', content: [{ type: 'text', text: 'ext. street - night' }] }] })
    e.commands.focus('end')
    press(e, 'Enter')
    expect(got).toEqual([['EXT. STREET - NIGHT', 1]])
  })
})

describe('the scene writes', () => {
  async function project() {
    const store = modelStore()
    await store.create(MAYA, 'Elements')
    const scriptId = mainScript(store.get())!.id
    const sceneId = await addScene(store, scriptId, undefined, 'EXT. BEACH - DAWN')
    await store.text.replace('scene', sceneId, { type: 'doc', content: [
      { type: 'action', content: [{ type: 'text', text: 'Waves.' }] },
      { type: 'action', content: [{ type: 'text', text: 'INT. CAR - DAY' }] },
      { type: 'action', content: [{ type: 'text', text: 'She drives.' }] },
    ] }, `human:${MAYA.id}`, { undo: false })
    await store.flush()
    return { store, scriptId, sceneId }
  }

  it('INT. starts a new scene and the lines after it move into it, as one undo step', async () => {
    const { store, scriptId, sceneId } = await project()
    const id = await splitScene(store, sceneId, 1, 'INT. CAR - DAY')
    let scenes = scenesOf(store.get(), scriptId)
    expect(scenes.map((s) => s.heading)).toEqual(['EXT. BEACH - DAWN', 'INT. CAR - DAY'])
    expect(scenes[1].id).toBe(id)
    expect(store.get().scenes[sceneId].text).toBe('Waves.')
    expect(store.get().scenes[id].text).toBe('She drives.')
    await store.undo()
    scenes = scenesOf(store.get(), scriptId)
    expect(scenes.map((s) => s.heading)).toEqual(['EXT. BEACH - DAWN'])
    expect(store.get().scenes[sceneId].text).toBe('Waves.\nINT. CAR - DAY\nShe drives.')
  })

  it('the Shot element moves the caret\'s line out of the scene into a new shot of that scene, one undo step', async () => {
    const { store, sceneId } = await project()
    const sb = mainStoryboard(store.get())!
    const shot = await insertShot(store, { sceneId, blockIndex: 2, storyboardId: sb.id })
    expect(store.get().shots[shot]).toMatchObject({ scene_id: sceneId, action: 'She drives.', last_writer: `human:${MAYA.id}` })
    expect(store.get().scenes[sceneId].text).toBe('Waves.\nINT. CAR - DAY')
    await store.undo()
    expect(store.get().shots[shot]).toBeUndefined()
    expect(store.get().scenes[sceneId].text).toBe('Waves.\nINT. CAR - DAY\nShe drives.')
  })

  it('Character in a planned shot makes a line beat', async () => {
    const { store, sceneId } = await project()
    const sb = mainStoryboard(store.get())!
    const shot = await insertShot(store, { sceneId, blockIndex: 0, storyboardId: sb.id })
    const beat = await addBeat(store, shot, 'line', { speaker: 'MAYA', text: 'Hi.' })
    expect(store.get().beats[beat]).toMatchObject({ kind: 'line', shot_id: shot, speaker: 'MAYA', text: 'Hi.', at_s: 0 })
  })
})

describe('the caret chain', () => {
  it('moves across items in order, and asks the page to mount one that is not', () => {
    const chain = new CaretChain()
    const wanted: string[] = []
    chain.setWant((k) => wanted.push(k))
    chain.setOrder(['heading:a', 'scene:a', 'shot:1', 'shot:2'])
    const focused: string[] = []
    chain.register('heading:a', { focus: (w) => focused.push(`heading:a ${w}`) })
    chain.register('scene:a', { focus: (w) => focused.push(`scene:a ${w}`) })
    chain.register('shot:2', {})
    expect(chain.move('heading:a', 'down')).toBe(true)
    expect(chain.move('scene:a', 'down')).toBe(true)
    expect(wanted).toEqual(['shot:1'])
    chain.register('shot:1', { focus: (w) => focused.push(`shot:1 ${w}`) })
    expect(focused).toEqual(['scene:a start', 'shot:1 start'])
    expect(chain.move('shot:1', 'up')).toBe(true)
    expect(focused.at(-1)).toBe('scene:a end')
    expect(chain.move('shot:2', 'down')).toBe(false)
  })
})

describe('delete from the keyboard (ui-behaviour 3.10, item 4)', () => {
  it('Backspace in an empty fragment asks the page to delete its item; with words it does not', () => {
    const asked: string[] = []
    const e = editor('shot', { remove: (how) => { asked.push(how); return true } })
    e.commands.focus()
    press(e, 'Backspace')
    expect(asked).toEqual(['empty'])
    e.commands.insertContent('She walks.')
    e.commands.focus('start')
    press(e, 'Backspace')
    expect(asked).toEqual(['empty'])
  })

  it('a mention alone is not empty', () => {
    const asked: string[] = []
    const e = editor('scene', { remove: (how) => { asked.push(how); return true } })
    e.commands.setContent({ type: 'doc', content: [{ type: 'action', content: [{ type: 'mention', attrs: { id: 'ref_x', label: 'maya_front' } }] }] })
    e.commands.focus('start')
    press(e, 'Backspace')
    expect(asked).toEqual([])
  })

  it('⌘⇧⌫ / Ctrl+Shift+Backspace deletes the item anywhere in it', () => {
    const asked: string[] = []
    const e = editor('shot', { remove: (how) => { asked.push(how); return true } })
    e.commands.insertContent('She walks.')
    e.commands.focus('end')
    press(e, 'Backspace', { ctrlKey: true, shiftKey: true })
    expect(asked).toEqual(['command'])
    expect(e.getText()).toBe('She walks.')
  })
})
