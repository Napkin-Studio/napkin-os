// Where Ctrl/Cmd+Z belongs to something else: a field being typed in, or the canvas (Excalidraw, or our own engine's [data-own-canvas], features/engine-select.clan),
// which keeps its own undo (ui/UndoButtons.tsx). The script editors keep none:
// their typing is LocalUndo steps (features/script-editor.clan), so ⌘Z there is the person's.

/** Keys typed here belong to the field or the canvas, not to the document's undo. */
export function keepsItsOwnUndo(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null
  if (el?.closest('[data-script-editor]') && !el.closest('input, textarea, select')) return false
  return !!el?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], .excalidraw, [data-own-canvas]')
}
