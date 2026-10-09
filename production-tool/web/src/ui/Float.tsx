// One floating surface for every menu and panel opened from a button: the ⋯ menu,
// the job tray, the model menu, a card's ⋯ menu (features/production-tool-look.clan).
// Rendered at body level so no card's overflow clips it and no canvas layer covers
// it; placed by lib/place.ts placeMenu. Closes on a click outside or Escape (focus
// goes back to the button); arrow keys move through a menu's items.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { placeMenu } from '../lib/place'

export function Float({ anchor, open, onClose, align = 'start', side = 'below', role = 'menu', label, className = '', children }: {
  anchor: RefObject<HTMLElement | null>
  open: boolean
  onClose: () => void
  align?: 'start' | 'end' | 'center'
  side?: 'below' | 'above'
  /** menu: items with role="menuitem", arrow keys; dialog: a panel with its own controls. */
  role?: 'menu' | 'dialog'
  label?: string
  className?: string
  children: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden', left: 0, top: 0 })

  // Placed after layout and again on every resize or scroll, so it follows its button.
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const a = anchor.current?.getBoundingClientRect()
      const el = panel.current
      if (!a || !el) return
      const p = placeMenu(a, { w: el.offsetWidth, h: el.offsetHeight }, { w: window.innerWidth, h: window.innerHeight }, align, side)
      setStyle((s) => (s.left === p.left && s.top === p.top && s.visibility === 'visible' ? s : { left: p.left, top: p.top, visibility: 'visible' }))
    }
    place()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null
    if (panel.current) ro?.observe(panel.current)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, anchor, align, side])

  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => {
      const t = e.target as Node
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return
      onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
      anchor.current?.focus()
    }
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('keydown', key, true)
    }
  }, [open, onClose, anchor])

  // A menu takes the focus on its first item, so the keyboard can go straight on.
  useEffect(() => {
    if (open && role === 'menu') panel.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus()
  }, [open, role])

  if (!open) return null
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (role !== 'menu' || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return
    const items = [...(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])]
    if (!items.length) return
    e.preventDefault()
    const i = items.indexOf(document.activeElement as HTMLElement)
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus()
  }
  return createPortal(
    // Clicks inside stay inside: React bubbles portal events to the card that opened it.
    <div ref={panel} className={`float ${role === 'menu' ? 'fmenu' : 'fpanel'} ${className}`} role={role} aria-label={label} style={style}
      onKeyDown={onKeyDown} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      {children}
    </div>,
    document.body,
  )
}

/** A menu item: the icon column, the words, and an optional hint on the right. */
export function MenuItem({ icon, children, hint, danger = false, disabled = false, onSelect }: {
  icon?: ReactNode
  children: ReactNode
  hint?: ReactNode
  danger?: boolean
  disabled?: boolean
  onSelect: () => void
}) {
  return (
    <button type="button" role="menuitem" className={`fmi ${danger ? 'danger' : ''}`} disabled={disabled} onClick={onSelect}>
      <span className="fmi-ico" aria-hidden="true">{icon}</span>
      <span className="fmi-text">{children}</span>
      {hint != null && <span className="fmi-hint">{hint}</span>}
    </button>
  )
}
