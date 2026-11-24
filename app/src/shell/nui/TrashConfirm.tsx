// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The one confirm for "Move to Trash", from a client page row or a tool's document menu.
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export function TrashConfirm({ title, onCancel, onConfirm }: { title: string; onCancel: () => void; onConfirm: () => void }) {
  const go = useRef<HTMLButtonElement>(null)
  useEffect(() => { go.current?.focus() }, [])
  return createPortal(
    <div className="nui tc-scrim" onMouseDown={e => { if (e.target === e.currentTarget) onCancel() }}
      onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onCancel() } }}>
      <div className="tc-card" role="alertdialog" aria-modal="true" aria-label={`Move ${title} to Trash`} data-testid="trash-confirm">
        <p className="tc-q">Move “{title}” to Trash?</p>
        <p className="tc-s">You can restore it for 30 days.</p>
        <div className="tc-act">
          <button type="button" className="btn-rect" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn-rect primary" ref={go} data-testid="trash-go" onClick={onConfirm}>Move to Trash</button>
        </div>
      </div>
    </div>, document.body)
}
