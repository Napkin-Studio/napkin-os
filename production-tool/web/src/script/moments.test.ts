// @vitest-environment happy-dom
// Moments and audio rows (item 7): ⌥M from event.code, half-second times, past-the-end and
// unplanned words, a tied line and moment moving in one step.

import { Editor } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { updateDoc } from '../doc/store'
import { addShots, MAYA, modelStore } from '../test/model'
import { addBeat, setShotSeconds } from './edits'
import { editorExtensions } from './extensions'
import { nextMomentTime, parseTime, setBeatTime, snapTime, tieLine, timeLabel, timeProblem, UNPLANNED_MOMENT } from './moments'

describe('times', () => {
  it('snap to half a second; 0:03.2 keeps 3.0', () => {
    expect(snapTime(parseTime('0:03.2')!)).toBe(3)
    expect(snapTime(3.3)).toBe(3.5)
    expect(parseTime('at 0:05')).toBe(5)
    expect(parseTime('2.5 s')).toBe(2.5)
    expect(parseTime('soon')).toBeNull()
    expect(timeLabel(2)).toBe('0:02')
    expect(timeLabel(2.5)).toBe('0:02.5')
    expect(timeLabel(62)).toBe('1:02')
  })

  it('a time past the end says so', () => {
    expect(timeProblem(5, 2.6)).toBe('0:05 is past the end of this 2.6 s shot')
    expect(timeProblem(2.5, 2.6)).toBeNull()
    expect(UNPLANNED_MOMENT).toBe('Moments live in shots. Plan shots first, or insert a shot.')
  })
})

async function shot() {
  const store = modelStore()
  await store.create(MAYA, 'Moments')
  await store.change((d) => { addShots(d, 1, { status: 'planned', duration_s: 2.6 }) }, { action: 'create shot' })
  await store.flush()
  return { store, id: Object.keys(store.get().shots)[0] }
}

describe('moments in a shot', () => {
  it('a tied line and its moment move together, in one undo step; past the end writes nothing', async () => {
    const { store, id } = await shot()
    const m = await addBeat(store, id, 'moment', { at_s: nextMomentTime(store.get(), id), text: 'eyes open' })
    const l = await addBeat(store, id, 'line', { at_s: 0, speaker: 'MAYA', text: "It's perfect!" })
    await updateDoc(store, (d) => tieLine(d, l, m), 'tie the line')
    await store.flush()
    expect(store.get().beats[l].moment_id).toBe(m)
    await updateDoc(store, (d) => setBeatTime(d, m, 1.2), `move beats[${m}]`)
    await store.flush()
    expect(store.get().beats[m].at_s).toBe(1)
    expect(store.get().beats[l].at_s).toBe(1)
    expect(store.undoLabels().undo).toBe(`move beats[${m}]`)
    await store.undo()
    expect(store.get().beats[m].at_s).toBe(0)
    expect(store.get().beats[l].at_s).toBe(0)
    expect(() => updateDoc(store, (d) => setBeatTime(d, m, 5), 'move')).toThrow('0:05 is past the end of this 2.6 s shot')
    expect(store.get().beats[m].at_s).toBe(0)
  })

  it('a shorter shot brings its beats inside it', async () => {
    const { store, id } = await shot()
    const m = await addBeat(store, id, 'moment', { at_s: 2.5 })
    await setShotSeconds(store, id, 1.5)
    await store.flush()
    expect(store.get().shots[id].duration_s).toBe(1.5)
    expect(store.get().beats[m].at_s).toBe(1.5)
  })
})

describe('⌥M', () => {
  it('is read from event.code (a Mac types µ), and in unplanned text it says where moments live', () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const said: string[] = []
    let momentAt = 0
    const editor = new Editor({ element, extensions: editorExtensions({ kind: 'scene', keys: { moment: () => { momentAt++; said.push(UNPLANNED_MOMENT); return true } } }) })
    editor.commands.focus()
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'µ', code: 'KeyM', altKey: true, bubbles: true, cancelable: true }))
    expect(momentAt).toBe(1)
    expect(said).toEqual([UNPLANNED_MOMENT])
    expect(editor.getText()).toBe('')
    editor.destroy()
  })
})
