// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Send to Judge for the open document (features/judge.clan): the score card read from the host and kept current
// (read once, again the moment the host says the document's data changed, and on a slow poll), the one bar button,
// and the state a failed run leaves. The host does the scoring and the arithmetic; this holds nothing of either.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { host } from '../../host'
import { httpHost } from '../../host/http'
import type { DocOps, JudgeCardView } from '../../host/types'
import type { AppState, BarItem } from '../appBar'
import { failureOf, refusalLine, SEND_TO_JUDGE } from './judgeModel'

const POLL_MS = 4000

export interface Judge {
  card: JudgeCardView | null
  /** Said once, in the host's words, when the last run or overrule did not go through. */
  line: string | null
  busy: boolean
  /** The bar's button; null when the document is not Judge's. */
  item: BarItem | null
  /** The state a failed run leaves, for the strip between the bar and the work. */
  state: AppState | null
  send: () => Promise<void>
  overrule: (reason: string, route?: 'team' | 'cd') => Promise<boolean>
}

type Held = { doc: string; card: JudgeCardView | null; failed: { why: 'provider' | 'refused' | 'timeout' | 'other'; line: string } | null; note: string | null }

export function useJudge(docPath: string, on: boolean): Judge {
  // Kept with the document it was read for, like the shell's other bands: the next document starts with nothing.
  const [held, setHeld] = useState<Held>({ doc: docPath, card: null, failed: null, note: null })
  const cur: Held = held.doc === docPath ? held : { doc: docPath, card: null, failed: null, note: null }
  const patch = useCallback((p: Partial<Held>) => setHeld(h => ({ ...(h.doc === docPath ? h : { doc: docPath, card: null, failed: null, note: null }), ...p, doc: docPath })), [docPath])
  const [busy, setBusy] = useState(false)
  const ops = useRef<{ doc: string; ops: Promise<DocOps> } | null>(null)
  const opsOf = useCallback(() => {
    if (typeof host.docOps !== 'function') return Promise.reject(new Error('Judge scores on the server, not in this build.'))
    if (ops.current?.doc !== docPath) ops.current = { doc: docPath, ops: host.docOps(docPath) }
    return ops.current.ops
  }, [docPath])
  const load = useRef<() => void>(() => {})
  useEffect(() => {
    if (!on) return
    let fresh = true
    let busyRead = false
    const read = async () => {
      if (busyRead) return
      busyRead = true
      try { const v = await (await opsOf()).judge.card(); if (fresh) patch({ card: v }) } catch { /* the card stays as it was */ } finally { busyRead = false }
    }
    load.current = () => { void read() }
    void read()
    const timer = setInterval(() => { void read() }, POLL_MS)
    let unlisten: (() => void) | undefined
    void httpHost.on('clan-data-changed', () => { void read() }).then(u => { if (fresh) unlisten = u; else u() }).catch(() => {})
    return () => { fresh = false; clearInterval(timer); unlisten?.() }
  }, [docPath, on, opsOf, patch])

  const piece = cur.card?.piece ?? undefined
  const send = useCallback(async () => {
    if (busy) return
    setBusy(true)
    patch({ failed: null, note: null })
    try {
      patch({ card: await (await opsOf()).judge.send(piece) })
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      patch({ failed: { why: failureOf(m), line: refusalLine(m) } })
    } finally { setBusy(false) }
  }, [busy, piece, opsOf, patch])

  const overrule = useCallback(async (reason: string, route?: 'team' | 'cd') => {
    try {
      await (await opsOf()).judge.overrule(reason, route)
      patch({ note: null }); load.current()
      return true
    } catch (e) {
      const m = refusalLine(e instanceof Error ? e.message : String(e))
      patch({ note: m.startsWith('Judge could not score') ? 'The overrule did not go through. Nothing was changed.' : m })
      return false
    }
  }, [opsOf, patch])

  const { card, failed, note } = cur
  const item = useMemo<BarItem | null>(() => on ? ({
    kind: 'button', id: SEND_TO_JUDGE, label: 'Send to Judge', primary: false,
    disabled: busy || (card !== null && !card.can_score),
    title: card && !card.can_score ? (card.why_not ?? '') : 'Judge scores this version out of 30 and advises. The creative director decides.',
  }) : null, [on, busy, card])
  const state = useMemo<AppState | null>(() => failed ? { name: 'run-failed', why: failed.why } : null, [failed])
  return { card, line: note ?? failed?.line ?? null, busy, item, state, send, overrule }
}
