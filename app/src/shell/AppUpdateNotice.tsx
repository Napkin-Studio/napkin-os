// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// A locked document keeps the page its client approved; when a newer version
// of its app is installed it says so, quietly, and anyone who may edit it can
// bring it up to date (OS-layer contract §7.1, features/doc-app-upgrade.clan).
// Nothing changes until Update is pressed, and the lock stays.

import type { AppUpdate } from '../host'
import { appUpdateWords } from './appUpdateWords'

interface Props {
  update: AppUpdate | null | undefined
  locked: boolean
  noun: string
  busy: boolean
  onUpdate: () => void
}

/** The quiet note under the bar: the link-changed banner's pattern. */
export function AppUpdateNotice({ update, locked, noun, busy, onUpdate }: Props) {
  const w = appUpdateWords(update, locked, noun)
  if (!w) return null
  return (
    <div className="ch-banner ch-banner-note" role="status" data-testid="app-update">
      <span className="ch-banner-dot" aria-hidden />
      <span className="ch-banner-text">
        <strong>{w.lead}</strong>
        {w.blocked ?? <span className="ch-banner-hint">{w.hint}</span>}
      </span>
      {!w.blocked && (
        <button type="button" className="ch-link" onClick={onUpdate} disabled={busy} data-testid="app-update-button">
          {busy ? 'Updating…' : 'Update'}
        </button>
      )}
    </div>
  )
}
