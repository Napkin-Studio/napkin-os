// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The mock's popover (`.p33-pop`, phase 33) and its modal (`.p33-modal`): one
// at a time, placed under what opened it (8px below; left-aligned, or
// right-aligned to it), kept on screen. Arrows move through its buttons, Home
// and End jump, Escape closes it and gives focus back; a click outside, a
// scroll, or leaving the window (a click into the app frame) closes it too.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { onListKey } from './popKit'

interface PopProps {
  anchor: HTMLElement | null
  align?: 'left' | 'right'
  onClose: (refocus: boolean) => void
  /** The menu's name, for a screen reader. */
  label: string
  className?: string
  /** Placed against the anchor's box instead (the bar's Continue in and Share: 40px under the app slot). */
  at?: (r: DOMRect, w: number) => { top: number; left: number }
  testid?: string
  children: ReactNode
}

export function Pop({ anchor, align = 'left', onClose, label, className = 'p33-pop', at, testid, children }: PopProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !anchor) return
    const r = anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight
    if (at) { setPos(at(r, w)); return }
    setPos({
      top: Math.min(r.bottom + 8, window.innerHeight - h - 8),
      left: Math.max(8, Math.min(align === 'right' ? r.right - w : r.left, window.innerWidth - w - 8)),
    })
  }, [anchor, align, at])
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button:not([disabled]), [role="menuitem"]')?.focus({ preventScroll: true })
    const outside = (e: PointerEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || anchor?.contains(t)) return
      onClose(false)
    }
    const away = () => onClose(false)
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('blur', away)
    window.addEventListener('scroll', away, { passive: true })
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('blur', away)
      window.removeEventListener('scroll', away)
    }
  }, [anchor, onClose])
  return createPortal(
    <div className="nui">
      <div
        ref={ref}
        className={className}
        role="menu"
        aria-label={label}
        data-testid={testid}
        style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
        onKeyDown={e => onListKey(e, ref.current, () => onClose(true))}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

/** The mock's modal: a card over a dimmed page; Escape, the ×, or a click on the dim closes it. */
export function Modal({ onClose, label, children }: { onClose: () => void; label: string; children: ReactNode }) {
  const card = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const was = document.activeElement as HTMLElement | null
    card.current?.querySelector<HTMLElement>('button, input')?.focus()
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('keydown', esc); was?.focus?.() }
  }, [onClose])
  return createPortal(
    <div className="nui">
      <div className="p33-modal" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        <div className="p33-mcard" role="dialog" aria-modal="true" aria-label={label} ref={card}>
          <button type="button" className="p33-mx" title="Close" aria-label="Close" onClick={onClose}>×</button>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  )
}

