// Which undo Ctrl/Cmd+Z means when the key is pressed outside the canvas and outside any editor (UAT round 4 S3-3: a
// pen stroke was drawn, focus left the canvas, and Ctrl+Z undid the earlier paid "Apply edits as v2" instead of the
// stroke). The canvas keeps its own undo (its scene steps), the document its own (doc/undo.ts): whichever the person
// touched last answers, so Ctrl+Z always takes back the last thing they did.

type CanvasUndo = (dir: 'undo' | 'redo') => boolean

let canvasUndo: CanvasUndo | null = null
let canvasAt = 0
let docAt = 0
let clock = () => Date.now()

/** The canvas registers its undo while it is the page (stages/Character.tsx); the returned function unregisters it. */
export function registerCanvasUndo(fn: CanvasUndo): () => void {
  canvasUndo = fn
  return () => { if (canvasUndo === fn) canvasUndo = null }
}

/** The person worked on the canvas (a press on its surface: a stroke, a drag, a sketch area). */
export function noteCanvasWork(): void { canvasAt = clock() }

/** The person made a document step (an undoable write, doc/store.ts). */
export function noteDocStep(): void { docAt = clock() }

/** Ctrl/Cmd+Z outside the canvas: the canvas's undo when the canvas was touched last and has a step to take back.
 *  True when the canvas took it. */
export function canvasTakesUndo(dir: 'undo' | 'redo'): boolean {
  if (!canvasUndo || canvasAt <= docAt) return false
  return canvasUndo(dir)
}

/** For the tests. */
export function resetUndoOrder(now?: () => number): void {
  canvasUndo = null
  canvasAt = 0
  docAt = 0
  clock = now ?? (() => Date.now())
}
