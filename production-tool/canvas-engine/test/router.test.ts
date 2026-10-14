// The input state machine (features/engine-ink.clan; ui-behaviour 8), driven by
// synthetic pointer samples: sticky pen mode, palm first, taps that never draw,
// two- and three-finger taps, hover, long press, and a finger drawing before any pen.

import { describe, expect, it } from 'vitest'
import { InputRouter, LONG_PRESS_MS, PALM_MS, type Intent, type RawPointer } from '../src/input/router'

const P = (o: Partial<RawPointer> & Pick<RawPointer, 'phase' | 'id' | 'type' | 't'>): RawPointer => ({ x: 0, y: 0, pressure: 0.5, buttons: 1, ...o })
const kinds = (xs: Intent[]) => xs.map((i) => i.kind)

describe('InputRouter', () => {
  it('a pen draws, and from then on a touch never does', () => {
    const r = new InputRouter()
    expect(kinds(r.handle(P({ phase: 'down', id: 1, type: 'pen', t: 0, pressure: 0.7 })))).toEqual(['ink-start'])
    expect(kinds(r.handle(P({ phase: 'move', id: 1, type: 'pen', t: 10, x: 5, coalesced: [{ x: 3, y: 0, pressure: 0.6 }, { x: 5, y: 0, pressure: 0.7 }] })))).toEqual(['ink-move'])
    expect(kinds(r.handle(P({ phase: 'up', id: 1, type: 'pen', t: 20 })))).toEqual(['ink-end'])
    expect(r.penMode).toBe(true)
    // A finger now: a tap, and a drag pans.
    expect(kinds(r.handle(P({ phase: 'down', id: 9, type: 'touch', t: 1000 })))).toEqual([])
    expect(kinds(r.handle(P({ phase: 'up', id: 9, type: 'touch', t: 1100 })))).toEqual(['tap'])
    r.handle(P({ phase: 'down', id: 9, type: 'touch', t: 2000, x: 0 }))
    const panned = [...r.handle(P({ phase: 'move', id: 9, type: 'touch', t: 2010, x: 20 })), ...r.handle(P({ phase: 'move', id: 9, type: 'touch', t: 2020, x: 50 }))]
    expect(kinds(panned)).toEqual(['pan', 'pan'])
    expect(panned).toEqual([{ kind: 'pan', dx: 20, dy: 0 }, { kind: 'pan', dx: 30, dy: 0 }])
    expect(kinds(r.handle(P({ phase: 'up', id: 9, type: 'touch', t: 2100, x: 50 })))).toEqual([])
  })

  it('coalesced points travel with the move', () => {
    const r = new InputRouter()
    r.handle(P({ phase: 'down', id: 1, type: 'pen', t: 0 }))
    const [m] = r.handle(P({ phase: 'move', id: 1, type: 'pen', t: 5, coalesced: [{ x: 1, y: 1, pressure: 0.2 }, { x: 2, y: 2, pressure: 0.3 }], predicted: [{ x: 3, y: 3, pressure: 0.3 }] }))
    expect(m).toEqual({ kind: 'ink-move', id: 1, points: [{ x: 1, y: 1, pressure: 0.2 }, { x: 2, y: 2, pressure: 0.3 }], predicted: [{ x: 3, y: 3, pressure: 0.3 }] })
  })

  it('palm first: a pan begun just before the pen is reverted, the toast flagged once, and the palm ignored after', () => {
    const r = new InputRouter()
    r.penMode = true
    r.handle(P({ phase: 'down', id: 9, type: 'touch', t: 0, x: 100, y: 100 }))
    r.handle(P({ phase: 'move', id: 9, type: 'touch', t: 10, x: 115, y: 100 }))
    r.handle(P({ phase: 'move', id: 9, type: 'touch', t: 20, x: 140, y: 110 }))
    const at = r.handle(P({ phase: 'down', id: 1, type: 'pen', t: 20 + PALM_MS - 10 }))
    expect(at[0]).toEqual({ kind: 'palm-revert', dx: -40, dy: -10, first: true })
    expect(kinds(at)).toEqual(['palm-revert', 'ink-start'])
    // The palm keeps moving while the pen draws: nothing.
    expect(r.handle(P({ phase: 'move', id: 9, type: 'touch', t: 200, x: 300, y: 300 }))).toEqual([])
    r.handle(P({ phase: 'up', id: 1, type: 'pen', t: 300 }))
    expect(r.handle(P({ phase: 'up', id: 9, type: 'touch', t: 310 }))).toEqual([])
    // A second palm-first: reverted, but the toast is not flagged again.
    r.handle(P({ phase: 'down', id: 8, type: 'touch', t: 1000, x: 0 }))
    r.handle(P({ phase: 'move', id: 8, type: 'touch', t: 1010, x: 30 }))
    const again = r.handle(P({ phase: 'down', id: 2, type: 'pen', t: 1050 }))
    expect(again[0]).toMatchObject({ kind: 'palm-revert', first: false })
  })

  it('a pan begun long before the pen stays', () => {
    const r = new InputRouter()
    r.penMode = true
    r.handle(P({ phase: 'down', id: 9, type: 'touch', t: 0, x: 0 }))
    r.handle(P({ phase: 'move', id: 9, type: 'touch', t: 10, x: 40 }))
    expect(kinds(r.handle(P({ phase: 'down', id: 1, type: 'pen', t: 10 + PALM_MS + 50 })))).toEqual(['ink-start'])
  })

  it('a touch landing while the pen is down is ignored', () => {
    const r = new InputRouter()
    r.handle(P({ phase: 'down', id: 1, type: 'pen', t: 0 }))
    expect(r.handle(P({ phase: 'down', id: 9, type: 'touch', t: 10 }))).toEqual([])
    expect(r.handle(P({ phase: 'move', id: 9, type: 'touch', t: 20, x: 80 }))).toEqual([])
    expect(r.handle(P({ phase: 'up', id: 9, type: 'touch', t: 30 }))).toEqual([])
  })

  it('two fingers tapped is undo, three is redo, two moving is a pinch', () => {
    const r = new InputRouter()
    r.penMode = true
    r.handle(P({ phase: 'down', id: 1, type: 'touch', t: 0, x: 0 }))
    r.handle(P({ phase: 'down', id: 2, type: 'touch', t: 5, x: 100 }))
    r.handle(P({ phase: 'up', id: 1, type: 'touch', t: 80 }))
    expect(kinds(r.handle(P({ phase: 'up', id: 2, type: 'touch', t: 90, x: 100 })))).toEqual(['undo'])
    for (const id of [1, 2, 3]) r.handle(P({ phase: 'down', id, type: 'touch', t: 1000 + id, x: id * 50 }))
    for (const id of [1, 2]) r.handle(P({ phase: 'up', id, type: 'touch', t: 1100 }))
    expect(kinds(r.handle(P({ phase: 'up', id: 3, type: 'touch', t: 1110, x: 150 })))).toEqual(['redo'])
    r.handle(P({ phase: 'down', id: 1, type: 'touch', t: 2000, x: 0, y: 0 }))
    r.handle(P({ phase: 'down', id: 2, type: 'touch', t: 2001, x: 100, y: 0 }))
    const [pinch] = r.handle(P({ phase: 'move', id: 2, type: 'touch', t: 2010, x: 200, y: 0 }))
    expect(pinch).toMatchObject({ kind: 'pinch', scale: 2, cx: 100, dx: 50 })
    r.handle(P({ phase: 'up', id: 1, type: 'touch', t: 2100 }))
    expect(r.handle(P({ phase: 'up', id: 2, type: 'touch', t: 2110 }))).toEqual([])
  })

  it('a slow two-finger touch is not undo', () => {
    const r = new InputRouter()
    r.penMode = true
    r.handle(P({ phase: 'down', id: 1, type: 'touch', t: 0 }))
    r.handle(P({ phase: 'down', id: 2, type: 'touch', t: 5, x: 100 }))
    r.handle(P({ phase: 'up', id: 1, type: 'touch', t: 900 }))
    expect(r.handle(P({ phase: 'up', id: 2, type: 'touch', t: 905, x: 100 }))).toEqual([])
  })

  it('a long press is reported once, and the release is no tap', () => {
    const r = new InputRouter()
    r.penMode = true
    r.handle(P({ phase: 'down', id: 1, type: 'touch', t: 0, x: 40, y: 50 }))
    expect(r.tick(LONG_PRESS_MS - 1)).toEqual([])
    expect(r.tick(LONG_PRESS_MS + 1)).toEqual([{ kind: 'long-press', x: 40, y: 50 }])
    expect(r.tick(LONG_PRESS_MS + 100)).toEqual([])
    expect(r.handle(P({ phase: 'up', id: 1, type: 'touch', t: 700 }))).toEqual([])
  })

  it('pen hover shows an 18 px ring and draws nothing', () => {
    const r = new InputRouter()
    expect(r.handle(P({ phase: 'move', id: 1, type: 'pen', t: 0, x: 10, y: 20, buttons: 0 }))).toEqual([{ kind: 'hover', x: 10, y: 20, radius: 18 }])
    expect(r.handle(P({ phase: 'leave', id: 1, type: 'pen', t: 5 }))).toEqual([{ kind: 'hover-end' }])
    r.handle(P({ phase: 'move', id: 1, type: 'pen', t: 6, buttons: 0 }))
    expect(kinds(r.handle(P({ phase: 'down', id: 1, type: 'pen', t: 10 })))).toEqual(['hover-end', 'ink-start'])
  })

  it('before any pen, a finger draws; a second finger cancels the stroke and pinches', () => {
    const r = new InputRouter()
    expect(kinds(r.handle(P({ phase: 'down', id: 1, type: 'touch', t: 0 })))).toEqual(['ink-start'])
    expect(kinds(r.handle(P({ phase: 'move', id: 1, type: 'touch', t: 10, x: 30 })))).toEqual(['ink-move'])
    expect(kinds(r.handle(P({ phase: 'down', id: 2, type: 'touch', t: 20, x: 100 })))).toEqual(['ink-cancel'])
    expect(kinds(r.handle(P({ phase: 'move', id: 2, type: 'touch', t: 30, x: 150 })))).toEqual(['pinch'])
  })

  it('the mouse draws in the ink tools, presses in select, and pans with the hand or the middle button', () => {
    const r = new InputRouter()
    expect(kinds(r.handle(P({ phase: 'down', id: 1, type: 'mouse', t: 0 })))).toEqual(['ink-start'])
    expect(kinds(r.handle(P({ phase: 'up', id: 1, type: 'mouse', t: 10 })))).toEqual(['ink-end'])
    r.tool = 'select'
    expect(kinds(r.handle(P({ phase: 'down', id: 1, type: 'mouse', t: 20 })))).toEqual(['press'])
    expect(kinds(r.handle(P({ phase: 'move', id: 1, type: 'mouse', t: 30, x: 5 })))).toEqual(['drag'])
    expect(kinds(r.handle(P({ phase: 'up', id: 1, type: 'mouse', t: 40, x: 5 })))).toEqual(['release'])
    expect(r.handle(P({ phase: 'down', id: 1, type: 'mouse', t: 50, buttons: 4 }))).toEqual([])
    expect(r.handle(P({ phase: 'move', id: 1, type: 'mouse', t: 60, x: 12, y: -3, buttons: 4 }))).toEqual([{ kind: 'pan', dx: 12, dy: -3 }])
  })
})
