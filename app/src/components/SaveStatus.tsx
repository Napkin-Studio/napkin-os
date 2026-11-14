// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { useEffect, useState } from 'react'
import { lastSaved, savedWords } from '../shell/docFreshness'
import type { SaveState } from './states/saveQueue'
import { CHANGED_BRIEF, FAILED_SAVE } from './states/words'

/**
 * "saved 37m ago" under the document's name in the OS bar (the mock's
 * .tba-saved). Only shown where it is true by construction (the studio, the
 * desktop's files). The time is this document's own updated_at, as the
 * library listing has it (read every 5 s); the clock time goes in the tooltip.
 *
 * Not the host's clan-data-changed / clan-patch-saved events: they come on
 * one stream for the whole workspace (they name their document since
 * 2026-11-12), and before they did, a write anywhere read as this one saved
 * (UAT 2026-11-12). The listing is enough for "saved 37m ago".
 *
 * A write that did not land reads "Not saved" (the bridge tells the shell how each write went:
 * states/saveQueue.ts).
 */
export default function SaveStatus({ updatedAt, state = 'idle' }: { updatedAt?: string | null; state?: SaveState }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])
  const at = lastSaved(null, updatedAt)
  const time = at?.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  // A write that did not land is not "saved": the line steps aside, and SaveAlert says so, once.
  if (state === 'failed' || state === 'changed') return null
  return (
    <span className="ch-saved" title={`Every change is kept as you make it.${time ? ` Last change kept at ${time}.` : ''}`}>
      {/* the clock ticks every 30 s; a time newer than its last tick reads as just now */}
      {savedWords(at, Math.max(now, at?.getTime() ?? 0))}
    </span>
  )
}

/**
 * Failed save, said once, here (features/align-booth.clan; the strip between the bar and the document is gone): "Not saved"
 * with Try again, or with Update when the host moved on while the person typed (409). It sits under the bar's right edge,
 * over the page and never pushing it, at every width. An undo's note, which only the bands said, is said here too, for a moment.
 */
export function SaveAlert({ state = 'idle', onRetry, onRefresh, note, noteKey = 0, judge, onJudgeDismiss }: {
  state?: SaveState
  onRetry?: () => void
  onRefresh?: () => void
  note?: string | null
  /** Counts each time the note is said: the same words said again are shown again. */
  noteKey?: number
  /** Judge's refusal or failure for a run sent from the shell's own button, in the host's words. */
  judge?: string | null
  onJudgeDismiss?: () => void
}) {
  // The note is for a moment: it is said, then it steps aside; saying it again (a new key) brings it back.
  const [gone, setGone] = useState<number | null>(null)
  useEffect(() => {
    if (!note) return
    const id = window.setTimeout(() => setGone(noteKey), 9_000)
    return () => window.clearTimeout(id)
  }, [note, noteKey])
  const failed = state === 'failed', moved = state === 'changed'
  const undoNote = note && gone !== noteKey ? note : null
  if (!failed && !moved && !undoNote && !judge) return null
  return (
    <div className="tb-alert">
      {(failed || moved) && (
        <span className="tb-alert-line" data-state={failed ? 'failed-save' : 'changed-save'} role="alert">
          <b>Not saved</b>
          <span className="tb-alert-text">{failed ? FAILED_SAVE.line : `${CHANGED_BRIEF.moved} What you typed stays on the page until you update.`}</span>
          {failed && onRetry && <button type="button" className="ch-btn" onClick={onRetry}>{FAILED_SAVE.retry}</button>}
          {moved && onRefresh && <button type="button" className="ch-btn" onClick={onRefresh}>{CHANGED_BRIEF.update()}</button>}
        </span>
      )}
      {judge && (
        <span className="tb-alert-line" data-state="run-failed" data-testid="judge-failed" role="alert">
          <span className="tb-alert-text">{judge}</span>
          {onJudgeDismiss && <button type="button" className="ch-btn" onClick={onJudgeDismiss}>Dismiss</button>}
        </span>
      )}
      {undoNote && <span className="tb-alert-line" role="status" data-testid="undo-note">{undoNote}</span>}
    </div>
  )
}
