// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The shortcuts sheet (`?`): every key the shell has, read from the command table the bar's commands come from,
// so a new command with a key is listed with no edit here. A dialog, closed by Escape or its button.

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { shortcutRows, keysText, type Command } from './commands'

export function ShortcutRows({ commands, mac }: { commands: readonly Command[]; mac: boolean }) {
  return (
    <dl className="bar-keys" data-testid="shortcuts-list">
      {shortcutRows(commands).map(r => (
        <div key={r.id} className="bar-keyrow">
          <dt>{r.title}</dt>
          <dd><kbd>{keysText(r.shortcut, mac)}</kbd></dd>
        </div>
      ))}
    </dl>
  )
}

export function ShortcutsSheet({ commands, mac, onClose }: { commands: readonly Command[]; mac: boolean; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { box.current?.focus({ preventScroll: true }) }, [])
  return createPortal(
    <div className="nui">
      <div
        ref={box}
        className="bar-sheet-shortcuts"
        role="dialog"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
        data-testid="shortcuts"
        onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() } }}
      >
        <div className="bar-sheet-head">
          <h2>Keyboard shortcuts</h2>
          <button type="button" className="bar-close" onClick={onClose} aria-label="Close the shortcuts">Close</button>
        </div>
        <ShortcutRows commands={commands} mac={mac} />
      </div>
    </div>,
    document.body,
  )
}
