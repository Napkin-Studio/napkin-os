// Delete in place: an inline confirm where one is needed, and "Deleted · Undo"
// for a few seconds where the thing was. Never a toast, never window.confirm.

import type { CSSProperties, ReactNode } from 'react'

export function UndoChip({ label, onUndo, style, className = '' }: { label: string; onUndo: () => void; style?: CSSProperties; className?: string }) {
  return (
    <div className={`undochip ${className}`} role="status" style={style} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <span>{label}</span>
      <span className="dot">·</span>
      <button className="btn xs ghost" onClick={onUndo}>Undo</button>
    </div>
  )
}

export function InlineConfirm({ text, yes, no = 'Keep', onYes, onNo, busy = false, children }: {
  text: ReactNode
  yes: string
  no?: string
  onYes: () => void
  onNo: () => void
  busy?: boolean
  children?: ReactNode
}) {
  return (
    <div className="confirm" role="alertdialog" aria-label={typeof text === 'string' ? text : undefined} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <div className="confirm-text">{text}</div>
      {children}
      <div className="row">
        <span className="spacer" />
        <button className="btn xs ghost" onClick={onNo} disabled={busy}>{no}</button>
        <button className="btn xs danger" onClick={onYes} disabled={busy} autoFocus>{yes}</button>
      </div>
    </div>
  )
}
