// A save refused because the project was saved from somewhere else since this browser opened it
// (features/personal-workspaces.clan). Nothing was overwritten; the person chooses, and both
// choices keep both versions.

import { useState, useSyncExternalStore } from 'react'
import { useServices, useShell } from '../app/context'
import type { ServerCopy } from '../projects/serverCopy'

export function SaveConflictBox() {
  const { serverCopy } = useServices()
  return serverCopy ? <Box copy={serverCopy} /> : null
}

function Box({ copy }: { copy: ServerCopy }) {
  const shell = useShell()
  const conflict = useSyncExternalStore(copy.subscribe, copy.get)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!conflict) return null
  const choose = (fn: () => Promise<unknown>) => async () => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="storenote conflict" role="alertdialog" aria-label="This project was saved somewhere else">
      <span>
        <b>Not saved: this project was saved from another browser or tab since you opened it here.</b>{' '}
        Nothing has been overwritten. Keep their version as a copy, or save yours as the newest version (theirs stays among the earlier saves).
        {error && <span className="conflict-error"> {error}</span>}
      </span>
      <span className="row" style={{ gap: 6 }}>
        <button className="btn xs" disabled={busy} onClick={choose(() => shell.keepTheirsAsCopy())}>Keep theirs as a copy</button>
        <button className="btn xs primary" disabled={busy} onClick={choose(() => shell.saveAsNewVersion())}>Save this as a new version</button>
      </span>
    </div>
  )
}
