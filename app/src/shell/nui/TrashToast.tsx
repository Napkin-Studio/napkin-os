// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// "Moved to Trash · Undo" and "Restored · Undo": one toast for both, wherever the Trash is used.

import type { TrashDesk, TrashState } from './trashDesk'
import './trash.css'

export function TrashToastView({ state, desk }: { state: TrashState; desk: TrashDesk }) {
  const t = state.toast
  if (!t) return null
  return (
    <div className="nui tc-toast" role="status" data-testid="toast">
      <span>{t.text}</span>
      <button type="button" onClick={() => { desk.dismiss(); t.undo() }}>Undo</button>
    </div>
  )
}
