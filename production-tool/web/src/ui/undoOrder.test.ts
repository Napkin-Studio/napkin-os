// UAT round 4 S3-3: a pen stroke, then Ctrl+Z outside the canvas, undid the earlier paid "Apply edits as v2" instead of
// the stroke. Whichever the person touched last answers Ctrl+Z.
import { afterEach, describe, expect, it } from 'vitest'
import { canvasTakesUndo, noteCanvasWork, noteDocStep, registerCanvasUndo, resetUndoOrder } from './undoOrder'

describe('Ctrl+Z takes back the last thing the person did', () => {
  afterEach(() => resetUndoOrder())
  it('the live repro: Apply as v2 (a document step), then a pen stroke: the stroke goes first', () => {
    let t = 0
    resetUndoOrder(() => ++t)
    const undone: string[] = []
    registerCanvasUndo((dir) => { undone.push(dir); return true })
    noteDocStep() // apply edits as v2
    noteCanvasWork() // the pen stroke
    expect(canvasTakesUndo('undo')).toBe(true)
    expect(undone).toEqual(['undo'])
  })
  it('a document step after the stroke is the one undone; with nothing on the canvas to undo, the document goes', () => {
    let t = 0
    resetUndoOrder(() => ++t)
    registerCanvasUndo(() => true)
    noteCanvasWork()
    noteDocStep()
    expect(canvasTakesUndo('undo')).toBe(false)
    resetUndoOrder(() => ++t)
    registerCanvasUndo(() => false)
    noteCanvasWork()
    expect(canvasTakesUndo('undo')).toBe(false)
  })
  it('no canvas on the page: the document', () => {
    noteCanvasWork()
    expect(canvasTakesUndo('undo')).toBe(false)
  })
})
