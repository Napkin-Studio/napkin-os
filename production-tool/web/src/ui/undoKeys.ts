// Where Ctrl/Cmd+Z belongs to something else: a field being typed in, or the canvas,
// whose Excalidraw keeps its own undo (ui/UndoButtons.tsx).

/** Keys typed here belong to the field or the canvas, not to the document's undo. */
export function keepsItsOwnUndo(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null
  return !!el?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], .excalidraw')
}
