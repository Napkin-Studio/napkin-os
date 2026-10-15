// The send tray for the Image editor's actions that run on Runway (ui-behaviour 3.12, 3.16): what
// Rhea will send (the frame, the mask, the words) and which model, "<model> on Runway". No price
// (owner, 2026-10-13): each job's cost is in History. Nothing is sent until Send; Cancel or Esc sends nothing.

import type { RefObject } from 'react'
import { AgentFigure } from '../../ui/agents/AgentFigure'
import { sayer } from '../../ui/agents/cast'
import { Float } from '../../ui/Float'

export interface TrayItem { what: string; detail?: string }

export function EditTray({ anchor, open, onClose, title, items, model, send, onSend }: {
  anchor: RefObject<HTMLElement | null>
  open: boolean
  onClose: () => void
  title: string
  items: TrayItem[]
  /** "Ideogram 4.5 on Runway" */
  model?: string
  send: string
  onSend: () => void
}) {
  return (
    <Float anchor={anchor} open={open} onClose={onClose} role="dialog" label={title} align="end" side="above" className="ie-tray">
      <div className="tray-head">
        <AgentFigure agent="rhea" size={22} decorative />
        <div className="tray-title"><b>{title}</b><span>{sayer('rhea')}</span></div>
      </div>
      <ul className="ie-tray-rows" aria-label="What goes">
        {items.map((it) => <li key={it.what}><b>{it.what}</b>{it.detail && <span className="faint"> · {it.detail}</span>}</li>)}
      </ul>
      <div className="tray-foot nowrap" title={`Nothing is sent until you press ${send}.`}>
        <span className="pt-mono tray-model">{model ?? 'The default model'}</span>
        <button type="button" className="btn sm" onClick={onClose}>Cancel</button>
        <button type="button" className="btn sm dark" onClick={onSend}>{send}</button>
      </div>
    </Float>
  )
}
