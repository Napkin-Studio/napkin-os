// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The brief's version list (features/brief-versions-undo.clan; v2 section 4): each approved
// version with its signer and date, the working draft on top, any two side by side, and
// Restore. Restore writes the old words into the draft as a new edit; a signed version stays
// locked and nothing newer is removed. The host reads every version from the brief's own chain.

import { useCallback, useEffect, useState } from 'react'
import { host } from '../../host'
import type { VersionsView } from '../../host'
import { pushData } from '../appExport'
import { compareParts, type PartDiff } from './compare'
import type { BriefUndo } from './useBriefUndo'
import './versions.css'

const day = (iso: string | null) => {
  const d = iso ? new Date(iso) : null
  return d && !isNaN(d.getTime()) ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
}

type Pick = number | 'draft'
const nameOf = (p: Pick) => (p === 'draft' ? 'Working draft' : `v${p}`)

interface Props {
  undo: BriefUndo
  /** After a write: the app reads the document again. */
  onChanged: () => void
  /** What the document is called in the list's sentences: a brief, or a script. */
  noun?: string
}

export default function VersionPanel({ undo, onChanged, noun = 'brief' }: Props) {
  const [view, setView] = useState<VersionsView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Pick[]>([])
  const [diffs, setDiffs] = useState<{ left: Pick; right: Pick; parts: PartDiff[] } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    host.getVersions().then(
      v => { setView(v); setError(null) },
      e => setError(String(e instanceof Error ? e.message : e)),
    )
  }, [])
  useEffect(() => {
    load()
    const offs = [host.on('clan-data-changed', load), host.on('clan-patch-saved', load)]
    return () => { for (const off of offs) off.then(f => f()).catch(() => {}) }
  }, [load])

  // Two picked: read both and show what differs. The older goes on the left.
  useEffect(() => {
    if (picked.length !== 2) return
    const [a, b] = [...picked].sort((x, y) => (x === 'draft' ? 1 : y === 'draft' ? -1 : x - y))
    let stale = false
    Promise.all([host.getVersion(a), host.getVersion(b)]).then(
      ([l, r]) => { if (!stale) setDiffs({ left: a, right: b, parts: compareParts(l.parts, r.parts) }) },
      e => { if (!stale) setError(String(e instanceof Error ? e.message : e)) },
    )
    return () => { stale = true }
  }, [picked, view])

  const toggle = (p: Pick) => setPicked(cur => cur.includes(p) ? cur.filter(x => x !== p) : [...cur, p].slice(-2))

  const restore = async (n: number) => {
    setBusy(true); setError(null)
    try {
      const before = (await host.getVersion('draft')).parts
      await host.restoreVersion(n)
      const [after, now] = await Promise.all([host.getVersion('draft'), host.getVersions()])
      undo.remember(before, after.parts, now.draft.last_edit?.decision ?? `restore-${n}-${Date.now()}`)
      setView(now)
      host.getCurrent().then(c => pushData(c.data), () => {})
      onChanged()
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setBusy(false)
    }
  }

  if (!view && !error) return <div className="vh" data-testid="version-history"><p className="vh-mid">Reading the versions.</p></div>
  const newest = view?.versions[0]
  const draft = view?.draft

  const draftNote = !draft ? '' : draft.restored_from != null ? `Restored from v${draft.restored_from}`
    : !newest ? (draft.changed ? 'Not signed yet' : 'Nothing written yet')
    : draft.changed ? 'Changed since the last signed version' : 'Nothing changed since the last signed version'

  return (
    <div className="vh" data-testid="version-history">
      <ul className="vh-rows" aria-label={`Versions of this ${noun}`}>
        {draft && (
          <li className="vh-row vh-draft" data-testid="version-row" data-kind="draft">
            <div className="vh-main">
              <strong className="vh-name">Working draft</strong>
              <span className="vh-sub">{draftNote}{draft.edited_by && draft.at ? ` · ${draft.edited_by}, ${day(draft.at)}` : ''}</span>
            </div>
            <div className="vh-actions">
              <button type="button" className="ch-btn vh-btn" aria-pressed={picked.includes('draft')} onClick={() => toggle('draft')}>Compare</button>
            </div>
          </li>
        )}
        {view?.versions.map((v, i) => (
          <li key={v.decision || v.n} className="vh-row" data-testid="version-row" data-version={v.n} data-locked={v.locked}>
            <div className="vh-main">
              <strong className="vh-name">v{v.n}</strong>
              <span className="vh-sub">Signed by {v.signer} · {day(v.at)}</span>
              {v.locked && <span className="vh-lock">Locked</span>}
              {!v.readable && <span className="vh-sub vh-gone">Its words cannot be shown: a later change was not kept in a way that can be undone.</span>}
            </div>
            {v.readable && (
              <div className="vh-actions">
                <button type="button" className="ch-btn vh-btn" aria-pressed={picked.includes(v.n)} onClick={() => toggle(v.n)}>Compare</button>
                {!(i === 0 && !draft?.changed) && (
                  <button type="button" className="ch-btn vh-btn" disabled={busy} onClick={() => void restore(v.n)}>Restore</button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {view && view.versions.length === 0 && <p className="vh-mid">Nothing is signed yet. Each time the {noun} is signed and locked it becomes a version here.</p>}
      {picked.length === 1 && <p className="vh-mid">Pick one more to compare it with {nameOf(picked[0])}.</p>}
      {picked.length === 2 && diffs && (
        <section className="vh-compare" data-testid="version-compare" aria-label={`${nameOf(diffs.left)} and ${nameOf(diffs.right)}, side by side`}>
          <div className="vh-cols vh-colhead"><span>{nameOf(diffs.left)}</span><span>{nameOf(diffs.right)}</span></div>
          {diffs.parts.length === 0 && <p className="vh-mid">These two read the same.</p>}
          {diffs.parts.map(p => (
            <div key={p.path} className="vh-part" data-testid="compare-part">
              <h4 className="vh-label">{p.label}</h4>
              <div className="vh-cols">
                <p className="vh-cell">{p.left || <em>Empty</em>}</p>
                <p className="vh-cell">{p.right || <em>Empty</em>}</p>
              </div>
            </div>
          ))}
        </section>
      )}
      {error && <p className="vh-err" role="alert">{error}</p>}
    </div>
  )
}
