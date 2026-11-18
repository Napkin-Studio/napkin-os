// The Script agent's draft or edit on the page, where it changes things (features/production-new-ui.clan; mock
// production-new-ui-v2 "script": "Drafts land on the page where they change things, signed, with Keep / Keep mine
// / Why"). What she was asked, her words (a draft) or the change word by word (an edit), Keep, Discard, Why and
// Ask again. Nothing changes on the page until Keep. Moved here from her Booth (features/script-freeform.clan).

import { useEffect, useState } from 'react'
import { proseHash, StaleSuggestion } from '../../../clan-store/src'
import type { Id, ProductionDocument, Suggestion, WriteInput, WriteIntent, WriteMode, WriteTarget } from '../contracts/types'
import type { ModelStore } from '../model/store'
import { AgentFigure } from '../ui/agents/AgentFigure'
import { useWhy } from '../ui/booth/hooks'
import type { HistoryFocus } from '../ui/History'
import type { ComposedScript } from './compose'
import { discardDraft, keep, linesOf, wordDiff } from './skye'
import { askedWords, draftLines, draftSeconds, landsWhere, trimDiff } from './skyeBooth'

export interface DraftCardProps {
  sug: Suggestion
  store: ModelStore
  doc: ProductionDocument
  composed: ComposedScript
  empty: boolean
  requestOf: (jobId: string) => WriteInput | undefined
  onWrite: (target: WriteTarget, intent: WriteIntent, opts: { instruction?: string; mode?: WriteMode }) => Promise<unknown>
  onWhy: (f: HistoryFocus) => void
  /** Kept or discarded: the line the editor says, with Undo when it changed the page. */
  onDone: (text: string, undo: boolean) => void
}

export function DraftCard({ sug, store, doc, composed, empty, requestOf, onWrite, onWhy, onDone }: DraftCardProps) {
  const [stale, setStale] = useState(sug.state === 'stale')
  const [busy, setBusy] = useState(false)
  const [showWhy, toggleWhy] = useWhy()
  const kind = sug.target.kind
  const current = () => store.text.prose(kind, sug.target.id)
  useEffect(() => {
    let alive = true
    if (sug.state === 'open') void proseHash(current()).then((h) => alive && setStale(h !== sug.base_hash))
    return () => {
      alive = false
    }
  })
  const write = requestOf(sug.job_id)
  const isDraft = sug.mode === 'draft'
  const asked = askedWords(write, sug)
  const sceneNo = (id: Id) => composed.rows.filter((r) => r.kind === 'scene').findIndex((r) => r.id === id) + 1
  const shotNo = (id: Id) => composed.shots.findIndex((s) => s.id === id) + 1
  const where = landsWhere(sug, write, empty, sceneNo, shotNo)
  const docId = (() => {
    try {
      return store.documentId()
    } catch {
      return ''
    }
  })()
  const act = async (fn: () => Promise<{ line: string }>, text: string, undo: boolean) => {
    setBusy(true)
    try {
      await fn()
      onDone(text, undo)
    } catch (e) {
      if (e instanceof StaleSuggestion) setStale(true)
      else onDone(e instanceof Error ? e.message : 'That did not work.', false)
    } finally {
      setBusy(false)
    }
  }
  const askAgain = () => void onWrite(sug.target, write?.intent ?? 'tighten', { ...(write?.mode ? { mode: write.mode } : {}), ...(write?.instruction ? { instruction: write.instruction } : {}) })
  const before = linesOf(doc, current()).map((l) => l.text).join('\n')
  const lines = isDraft ? draftLines(doc, sug) : null
  const diff = isDraft ? [] : trimDiff(wordDiff(before, sug.proposed.text))
  return (
    <article className={`se-draft ${stale ? 'stale' : ''}`} role="group" aria-label={`The Script agent's ${isDraft ? 'draft' : 'edit'}`} data-suggestion={sug.id}
      contentEditable={false} suppressContentEditableWarning>
      <div className="dh"><AgentFigure agent="skye" size={18} decorative /><span className="who">Script agent · {isDraft ? 'draft' : 'edit'}</span><span className="where">· {stale ? new StaleSuggestion().message : where}</span></div>
      <p className="note">{asked.lead}{asked.quote ? <>: <q>{asked.quote}</q></> : null}</p>
      {lines ? (
        <div className="text">
          {lines.lines.map((l, i) => <div key={i} className={`l ${lines.screenplay ? 'sp' : ''} k-${l.kind}`}>{l.text}</div>)}
        </div>
      ) : (
        <div className="diff">
          {diff.map((x, i) => (x.kind === 'same' ? <span key={i}>{x.text}</span> : x.kind === 'gone' ? <del key={i}>{x.text}</del> : <ins key={i}>{x.text}</ins>))}
        </div>
      )}
      {kind === 'scene' ? (
        // A page draft says its length by the band's rule, not the agent's own count (live test 2026-11-18:
        // "15 s" on a draft the band then read as 53 s).
        <p className="note">about {draftSeconds(doc, sug)} s</p>
      ) : (sug.proposed.duration_s !== undefined || (sug.proposed.new_beats ?? []).length > 0) && (
        <p className="note">{sug.proposed.duration_s !== undefined ? `${sug.proposed.duration_s} s` : ''}{(sug.proposed.new_beats ?? []).map((b) => ` + ${b.kind} at ${b.at_s} s`).join('')}</p>
      )}
      <div className="acts">
        {!stale && <button type="button" className="k" disabled={busy} onClick={() => void act(() => keep(store, sug.id), isDraft ? 'Kept. The Script agent’s draft is on the page.' : 'Kept. The change is on the page.', true)}>Keep</button>}
        <button type="button" disabled={busy} onClick={() => void act(() => discardDraft(store, sug.id), 'Discarded. The page is as it was.', false)}>Discard</button>
        <button type="button" aria-expanded={showWhy} onClick={toggleWhy}>Why</button>
        <button type="button" className={stale ? 'k' : undefined} disabled={busy} onClick={askAgain}>Ask again</button>
      </div>
      {showWhy && (
        <div className="why">
          {sug.note}{' '}
          <button type="button" className="linkbtn" onClick={() => onWhy({ label: 'The Script agent\'s draft', addresses: [`${docId}#suggestions[${sug.id}]`, `${docId}#jobs[${sug.job_id}]`, `${docId}#${sug.target.kind}s[${sug.target.id}]`] })}>In History</button>
        </div>
      )}
    </article>
  )
}
