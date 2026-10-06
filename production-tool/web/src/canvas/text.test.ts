import { describe, expect, it } from 'vitest'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import { frameText, MAX_TEXT, withNotes } from './text'
import { placeFloating } from '../lib/place'

type El = ExcalidrawElement
const el = (o: Partial<El> & Record<string, unknown>): El =>
  ({ id: 'x', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, isDeleted: false, frameId: null, ...o }) as unknown as El

const frame = el({ id: 'f', type: 'frame', x: 0, y: 0, width: 600, height: 800 })

describe('frameText: the words written in the sketch frame', () => {
  it('collects the frame’s text top to bottom, folding wrapped lines', () => {
    const els = [
      frame,
      el({ id: 's', type: 'freedraw', frameId: 'f' }),
      el({ id: 't2', type: 'text', frameId: 'f', y: 700, text: 'A character made from basic shapes,\nmake to look like an AI agent.', originalText: 'A character made from basic shapes, make to look like\nan AI agent.' }),
      el({ id: 't1', type: 'text', frameId: 'f', y: 120, x: 200, text: 'When happy' }),
    ]
    expect(frameText(els, frame)).toBe('When happy\nA character made from basic shapes, make to look like an AI agent.')
  })

  it('takes text bound to the frame or to a shape in it, and loose text inside it', () => {
    const els = [
      frame,
      el({ id: 'box', type: 'rectangle', frameId: 'f' }),
      el({ id: 'b', type: 'text', containerId: 'box', y: 50, text: 'bound to a shape' }),
      el({ id: 'loose', type: 'text', x: 10, y: 400, width: 100, height: 20, text: 'When dancing' }),
    ]
    expect(frameText(els, frame)).toBe('bound to a shape\nWhen dancing')
  })

  it('leaves out text outside the frame, in another frame, deleted or empty', () => {
    const els = [
      frame,
      el({ id: 'out', type: 'text', x: 700, y: 10, text: 'outside' }),
      el({ id: 'other', type: 'text', frameId: 'g', x: 10, y: 10, text: 'another frame' }),
      el({ id: 'del', type: 'text', frameId: 'f', isDeleted: true, text: 'gone' }),
      el({ id: 'empty', type: 'text', frameId: 'f', text: '   ' }),
    ]
    expect(frameText(els, frame)).toBe('')
  })

  it('stays within the contract’s 1000 characters', () => {
    const long = 'word '.repeat(400)
    expect(frameText([frame, el({ type: 'text', frameId: 'f', text: long })], frame).length).toBe(MAX_TEXT)
  })
})

describe('withNotes: a Combine instruction plus a drawing’s words', () => {
  it('keeps the instruction first and adds the notes by tag', () => {
    expect(withNotes('the hat from @ref_b', [{ tag: 'ref_a', text: 'When happy\nWhen dancing' }]))
      .toBe('the hat from @ref_b\nWritten in @ref_a: When happy / When dancing')
  })
  it('skips empty notes and never cuts the instruction', () => {
    const instr = 'x'.repeat(990)
    const out = withNotes(instr, [{ tag: 'a', text: '' }, { tag: 'b', text: 'a long note here' }])
    expect(out.startsWith(instr)).toBe(true)
    expect(out.length).toBe(MAX_TEXT)
    expect(withNotes('just this', [])).toBe('just this')
  })
})

describe('placeFloating: the toolbar stays inside the canvas', () => {
  const box = { w: 1000, h: 700 }
  const size = { w: 420, h: 44 }
  it('centres above the anchor when there is room', () => {
    expect(placeFloating({ x: 500, top: 300, bottom: 500 }, size, box)).toEqual({ left: 290, top: 242, below: false })
  })
  it('clamps at the right and left edges', () => {
    expect(placeFloating({ x: 980, top: 300, bottom: 500 }, size, box).left).toBe(1000 - 420 - 8)
    expect(placeFloating({ x: 10, top: 300, bottom: 500 }, size, box).left).toBe(8)
  })
  it('flips below the selection when the top has no room, and stays in the box', () => {
    expect(placeFloating({ x: 500, top: 20, bottom: 200 }, size, box)).toEqual({ left: 290, top: 214, below: true })
    expect(placeFloating({ x: 500, top: 20, bottom: 690 }, size, box).top).toBe(700 - 44 - 8)
  })
})
