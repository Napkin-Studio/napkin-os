// Escape back to the canvas from an editor (Shrey 2026-11-19; ui/chrome/TopBars EditorBar).

import { useEffect, useRef } from 'react'

/** Nothing else would take this Escape: the focus is not in text, and no menu, popover or dialog is open. */
export function escapeFree(target: EventTarget | null, doc: Document = document): boolean {
  const el = target as Element | null
  if (el?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]')) return false
  return !doc.querySelector('.float, [role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"], [data-escape-holds]')
}

/** Escape returns to the canvas from an editor when nothing else takes it (Shrey 2026-11-19): not while
 *  typing, nor while a menu, popover, draft or selection would close first. Whether anything was open is read
 *  before any handler runs (the capture phase), so a handler that closes something on this same Escape
 *  never makes it a Back too. */
export function useEscapeBack(onBack: () => void, enabled: boolean) {
  const live = useRef({ onBack, enabled })
  useEffect(() => { live.current = { onBack, enabled } })
  useEffect(() => {
    let armed = false
    const first = (e: KeyboardEvent) => { armed = e.key === 'Escape' && !e.defaultPrevented && escapeFree(e.target) }
    const last = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !armed || e.defaultPrevented || !live.current.enabled) return
      armed = false
      e.preventDefault()
      live.current.onBack()
    }
    window.addEventListener('keydown', first, true)
    window.addEventListener('keydown', last)
    return () => {
      window.removeEventListener('keydown', first, true)
      window.removeEventListener('keydown', last)
    }
  }, [])
}
