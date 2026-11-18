// Escape back to the canvas from an editor (Shrey 2026-11-19; ui/chrome/TopBars EditorBar, the Sizes overview).

import { useEffect, useRef } from 'react'

const TEXT = 'input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]'

/** The text field the focus is in, if it is in one. */
export function textOf(target: EventTarget | null): HTMLElement | null {
  return ((target as Element | null)?.closest?.(TEXT) as HTMLElement | null) ?? null
}

/** Leave the text field the focus is in: the caret goes, nothing typed is lost. */
export function leaveText(target: EventTarget | null) {
  const field = textOf(target) ?? textOf(document.activeElement)
  field?.blur()
  if (document.activeElement && document.activeElement !== document.body && textOf(document.activeElement)) (document.activeElement as HTMLElement).blur()
}

/** A menu, popover or dialog is open. `page`: the page asking, when it is itself a dialog (the Sizes overview);
 *  it does not count. */
export function overlayOpen(doc: Document = document, page?: Element | null): boolean {
  return [...doc.querySelectorAll('.float, [role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"], [data-escape-holds]')].some((x) => x !== page)
}

/** Nothing else would take this Escape: the focus is not in text, and no menu, popover or dialog is open. */
export function escapeFree(target: EventTarget | null, doc: Document = document, page?: Element | null): boolean {
  return !textOf(target) && !overlayOpen(doc, page)
}

/** What an Escape does on a page with a way back, read before any handler runs: nothing (something else
 *  takes it), leave the text (the first Escape from a text field: the caret goes, nothing is lost), or back. */
export function escapeStep(target: EventTarget | null, doc: Document = document, page?: Element | null): 'none' | 'text' | 'back' {
  if (overlayOpen(doc, page)) return 'none'
  return textOf(target) ? 'text' : 'back'
}

/** Escape returns to the canvas from an editor when nothing else takes it (Shrey 2026-11-19): not while a menu,
 *  popover, draft or selection would close first. From a text field the first Escape leaves the text and the
 *  second goes back. What was open is read before any handler runs (the capture phase), so a handler that
 *  closes something on this same Escape never makes it a Back too. */
export function useEscapeBack(onBack: () => void, enabled: boolean) {
  const live = useRef({ onBack, enabled })
  useEffect(() => { live.current = { onBack, enabled } })
  useEffect(() => {
    let step: 'none' | 'text' | 'back' = 'none'
    const first = (e: KeyboardEvent) => { step = e.key === 'Escape' && !e.defaultPrevented ? escapeStep(e.target) : 'none' }
    const last = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || step === 'none' || !live.current.enabled) return
      // A rich-text editor (ProseMirror) always marks Escape handled (its base keymap selects the parent node);
      // its own popovers (the @ list) are caught as open above. Any other field that handled Escape keeps it.
      if (e.defaultPrevented && !(step === 'text' && (textOf(e.target)?.isContentEditable ?? false))) return
      const was = step
      step = 'none'
      e.preventDefault()
      if (was === 'text') leaveText(e.target)
      else live.current.onBack()
    }
    window.addEventListener('keydown', first, true)
    window.addEventListener('keydown', last)
    return () => {
      window.removeEventListener('keydown', first, true)
      window.removeEventListener('keydown', last)
    }
  }, [])
}
