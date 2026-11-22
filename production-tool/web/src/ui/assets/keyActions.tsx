// A character's actions (the Assets library's character card): its role, Make the other views, Publish.

import { useState } from 'react'
import { useConfig, useDoc } from '../../app/context'
import { OTHER_VIEWS, type CanvasController } from '../../canvas/controller'
import { REF_ROLES, type KeyEntry, type RefRole } from '../../contracts/types'
import { refsList } from '../../model/selectors'
import { RelayError } from '../../relay'
import { PaidButton } from '../PaidButton'
import { missingViews as missingOf, viewsWhat } from '../viewsWhat'

const errText = (e: unknown) => (e instanceof Error ? e.message : 'That did not work. Try again.')
const roleWord = (r: RefRole) => (r === 'brand_rule' ? 'brand rule' : r)

/** A character's actions in its card: its role, Make the other views, Publish (the old row's, kept). */
export function useKeyActions(k: KeyEntry, ctrl: CanvasController | null) {
  const doc = useDoc()
  const { controls } = useConfig()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refs = refsList(doc).filter((r) => r.key === k.key)
  const front = refs.find((r) => r.variant === 'front')
  // Near angles count as made (UAT round 3 R3-10): a back three-quarter covers the back.
  const missingViews = missingOf(refs, OTHER_VIEWS)
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof RelayError && e.error.code === 'conflict' ? e.message : errText(e))
    } finally {
      setBusy(null)
    }
  }
  return {
    role: (
      <select className="ad-role" aria-label={`What ${k.key} is`} value={k.role} onChange={(e) => ctrl?.setRole(k.key, e.target.value as RefRole)}>
        {REF_ROLES.map((r) => <option key={r} value={r}>{roleWord(r)}</option>)}
      </select>
    ),
    views: controls.views && front && missingViews.length > 0
      ? <PaidButton className="btn-rect primary wide" label="Make the other views" busy={busy === 'views'} disabled={!!busy || !ctrl}
          what={viewsWhat(k.key, missingViews)} yes={`Make ${missingViews.length}`}
          onYes={() => void run('views', () => ctrl!.makeViews(k.key, missingViews))} />
      : null,
    publish: (
      <button type="button" className="side-link" disabled={!!busy || !ctrl || !refs.length} title="Keep it in the team library, for your other projects" onClick={() => run('publish', () => ctrl!.publish(k.key))}>
        {busy === 'publish' ? 'Publishing…' : k.library ? `Publish v${k.library.ver + 1} to the team library` : 'Publish v1 to the team library'}
      </button>
    ),
    error: error ? <span role="alert" className="ad-error">{error}</span> : null,
  }
}

