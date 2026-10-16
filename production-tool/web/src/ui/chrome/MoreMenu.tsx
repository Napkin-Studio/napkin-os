// More (⋯), the one overflow menu every top bar has (features/topbar-declutter.clan; ui-behaviour 3.1):
// a surface keeps one primary and at most one view switch in its bar; every other action lives here.
// Float + MenuItem: the arrow keys move, Escape closes and gives the focus back. Its head carries what
// left the bar at the narrower fit levels (the meta pills, the save state).

import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Float, MenuItem } from '../Float'
import { NOT_YET } from './panels'

export function MoreMenu({ where, tip, head, children }: {
  /** The surface, for the beta's record ("more: canvas"). */
  where: string
  /** What is in it, for the tooltip ("More: export, copy link"). */
  tip: string
  head?: ReactNode
  children: (close: () => void) => ReactNode
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  return (
    <>
      <button ref={ref} type="button" className={`btn icon pt-more ${open ? 'on' : ''}`} aria-label="More" data-tip={tip} data-dogfood={`more: ${where}`}
        aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="8" r="1.4" fill="currentColor" /><circle cx="8" cy="8" r="1.4" fill="currentColor" /><circle cx="12.5" cy="8" r="1.4" fill="currentColor" /></svg>
      </button>
      <Float anchor={ref} open={open} onClose={close} align="end" label="More" className="pt-menu pt-moremenu">
        {head && <><div className="pt-morehead">{head}</div><div className="pt-menusep" /></>}
        {children(close)}
      </Float>
    </>
  )
}

/** "Copy link to this" where the editor has no route yet (selbar.ts does the same on the canvas). */
export function CopyLinkLater() {
  return <MenuItem icon={<LinkIcon />} disabled hint={NOT_YET} onSelect={() => {}}>Copy link to this</MenuItem>
}

export function LinkIcon() {
  return <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M6 8a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 0 0-3.7-3.7l-.8.8M8 6a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 0 0 3.7 3.7l.8-.8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
}
