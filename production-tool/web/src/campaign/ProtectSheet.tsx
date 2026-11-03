// "What must stay" on the Campaign board: change the boxes after the sizes are made. Crops follow at once (free);
// extend and regenerate sizes are marked out of date, because making them again spends.

import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { FormatSet, ProtectBox } from '../contracts/types'
import { ProtectEditor } from './ProtectEditor'
import './campaign.css'

export function ProtectSheet({ set, onSave, onClose }: {
  set: FormatSet
  onSave(protect: { boxes: ProtectBox[]; keep_middle?: boolean }): void
  onClose(): void
}) {
  const [boxes, setBoxes] = useState<ProtectBox[]>(set.protect?.boxes ?? [])
  const same = JSON.stringify(boxes) === JSON.stringify(set.protect?.boxes ?? [])
  // On the page, not in the board: the board scales and moves with the canvas.
  return createPortal(
    <div className="cf-scrim" role="presentation" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className="cf-sheet pt-panel" role="dialog" aria-modal="true" aria-label="What must stay">
        <header className="cf-sheethead">
          <h2>What must stay in every size</h2>
          <button type="button" className="btn xs ghost" onClick={onClose} aria-label="Close">Close</button>
        </header>
        <div className="cf-body">
          <div className="faint cf-note">Crops follow right away. Extend and Regenerate sizes are marked out of date, and Update sizes remakes them. Locked sizes stay as they are.</div>
          <ProtectEditor master={{ asset: set.master.asset, w: set.master.w ?? 1, h: set.master.h ?? 1 }} boxes={boxes} setBoxes={setBoxes} />
          <footer className="cf-foot">
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <span className="pt-grow" />
            <button type="button" className="btn" onClick={() => onSave({ boxes: [], keep_middle: true })}>Nothing in particular: keep the middle</button>
            <button type="button" className="btn primary" disabled={!boxes.length || same} onClick={() => onSave({ boxes })}>Save</button>
          </footer>
        </div>
      </section>
    </div>,
    document.body,
  )
}
