// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// One short line that says what just happened, in the shell's toast.

import type { ToastLine } from './useToast'

export function Toast({ toast }: { toast: ToastLine | null }) {
  if (!toast) return null
  return (
    <div className="ch-toast" data-error={toast.error || undefined} role="status" aria-live="polite">
      <div className="ch-toast-title"><span className="ch-chip-dot" aria-hidden />{toast.title}</div>
      {toast.body && <div className="ch-toast-body">{toast.body}</div>}
    </div>
  )
}
