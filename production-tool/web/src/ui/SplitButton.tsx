// A split button (features/one-to-one-updates.clan): the common, cheap action on the left
// ("Redraw": this one), and ▾ for the wider ones, each with its count and cost so what it
// costs is visible ("Redraw this and the frames after (4)", "~$0.60"). The menu is a Float.

import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Float, MenuItem } from './Float'

export interface SplitItem {
  label: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  disabled?: boolean
  onSelect: () => void
}

export function SplitButton({ children, onClick, items, kind = 'dark', size = 'sm', disabled = false, title, menuLabel }: {
  children: ReactNode
  onClick: () => void
  /** The wider choices; none: a plain button. */
  items: SplitItem[]
  kind?: 'dark' | 'primary' | 'plain'
  size?: 'sm' | 'xs'
  disabled?: boolean
  title?: string
  menuLabel: string
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const cls = `btn ${size} ${kind === 'plain' ? '' : kind}`
  return (
    <span className={`splitbtn ${items.length ? '' : 'single'}`} onClick={(e) => e.stopPropagation()}>
      <button className={cls} disabled={disabled} title={title} onClick={onClick}>{children}</button>
      {items.length > 0 && (
        <>
          <button ref={ref} className={`${cls} caret`} disabled={disabled} aria-label={menuLabel} aria-haspopup="menu" aria-expanded={open}
            onClick={() => setOpen(!open)}>▾</button>
          <Float anchor={ref} open={open} onClose={close} align="end" label={menuLabel}>
            {items.map((it, i) => (
              <MenuItem key={i} icon={it.icon} hint={it.hint} disabled={it.disabled} onSelect={() => { close(); it.onSelect() }}>{it.label}</MenuItem>
            ))}
          </Float>
        </>
      )}
    </span>
  )
}
