// The tray every paid Make in the Film room opens first: what will be made, on which model, how many, and Make / Not now.
// Same shape as the canvas's send tray ("The Camera agent will make"), so no Make starts a job on one click (UAT
// walkthrough 2026-11-21, P13: Film Make sent a paid job with no tray). No price or cost words: those are only in
// Decisions and History (owner, 2026-10-13).

import { useRef, useState, type ReactNode } from 'react'
import { Float } from './Float'

export interface TrayRow { key: string; label: string; detail?: string }

export function MakeTray({ who = 'The Camera agent', label, busyLabel = 'Making…', busy, disabled, className, title, rows, yes = 'Make', onYes }: {
  who?: string
  label: ReactNode
  busyLabel?: string
  busy: boolean
  disabled?: boolean
  className: string
  title?: string
  rows: TrayRow[]
  yes?: string
  onYes: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  const head = `${who} will make`
  return (
    <>
      <button ref={ref} type="button" className={className} disabled={busy || disabled} title={title} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen(!open)}>{busy ? busyLabel : label}</button>
      <Float anchor={ref} open={open && !busy} onClose={() => setOpen(false)} role="dialog" label={head} side="above" align="start" className="pt-menu send-disc make-tray">
        <div className="lbl">{head}</div>
        <ul>{rows.map((r) => <li key={r.key}><b>{r.label}</b>{r.detail && <small>{r.detail}</small>}</li>)}</ul>
        <div className="row make-tray-row">
          <button type="button" className="btn xs ghost" onClick={() => setOpen(false)}>Not now</button>
          <button type="button" className="btn xs primary" autoFocus onClick={() => { setOpen(false); onYes() }}>{yes}</button>
        </div>
      </Float>
    </>
  )
}
