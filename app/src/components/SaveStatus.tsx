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
export default function SaveStatus({ updatedAt, state = 'idle', onRetry, onRefresh, note }: {
  updatedAt?: string | null
  state?: SaveState
  /** Failed save: Try again, said here once (the page keeps what was typed). */
  onRetry?: () => void
  /** The host moved on while the person typed (409): take its version; nothing is forced over it. */
  onRefresh?: () => void
  /** One line about the last undo or redo, or why it did nothing (the shell's own undo stack). */
  note?: string | null
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])
  // An undo's note is for a moment: it is said, then it steps aside.
  const [gone, setGone] = useState<string | null>(null)
  useEffect(() => {
    if (!note) return
    const id = window.setTimeout(() => setGone(note), 9_000)
    return () => window.clearTimeout(id)
  }, [note])
  const at = lastSaved(null, updatedAt)
  const time = at?.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const failed = state === 'failed', moved = state === 'changed'
  const undoNote = note && note !== gone ? note : null
  return (
    <>
      {failed || moved ? (
        <span className="ch-saved ch-saved-bad" data-state={failed ? 'failed-save' : 'changed-save'} role="alert" title={failed ? FAILED_SAVE.line : CHANGED_BRIEF.moved}>
          Not saved
          {failed && onRetry && <> <button type="button" className="ch-link" onClick={onRetry}>{FAILED_SAVE.retry}</button></>}
          {moved && <>{onRefresh && <> <button type="button" className="ch-link" onClick={onRefresh}>{CHANGED_BRIEF.update()}</button></>}</>}
        </span>
      ) : (
        <span className="ch-saved" title={`Every change is kept as you make it.${time ? ` Last change kept at ${time}.` : ''}`}>
          {/* the clock ticks every 30 s; a time newer than its last tick reads as just now */}
          {savedWords(at, Math.max(now, at?.getTime() ?? 0))}
        </span>
      )}
      {undoNote && <span className="ch-saved ch-saved-note" role="status" data-testid="undo-note">{undoNote}</span>}
    </>
  )
}
