// Skye in the text (ui-behaviour 3.10; features/script-editor.clan): no chat, only
// - her bar on a selection: Tighten, Make it N s, Add a beat, Write the VO, Say it another way;
//   on an item she was asked to leave alone it asks first; off where she is not available;
// - her drafts on the items they change: the old words struck, the new underlined in coral, a
//   signed bubble, and Keep, Keep mine, Why. Nothing changes until Keep.

import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { proseHash, StaleSuggestion, type Prose } from '../../../clan-store/src'
import type { Suggestion, WriteIntent, WriteTarget } from '../contracts/types'
import type { ModelStore } from '../model/store'
import { AgentAvatar } from '../ui/agents/AgentFigure'
import type { HistoryFocus } from '../ui/History'
import { HANDS_OFF_LINE, keep, keepMineDraft, linesOf, QUOTA_OUT, SKYE, SKYE_OPTIONS, wordDiff } from './skye'


/** The bar on a selection inside one item. */
export function SkyeBar({ editor, target, seconds, handsOff, off, quota, working, onStart }: {
  editor: Editor | null
  target: WriteTarget | null
  seconds: number
  handsOff: boolean
  off: boolean
  quota: boolean
  working: boolean
  onStart: (intent: WriteIntent, opts: { selection?: { from: number; to: number; text: string }; seconds?: number; explicit?: boolean }) => void
}) {
  const [asked, setAsked] = useState(false)
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!editor) return
    const bump = () => setTick((x) => x + 1)
    editor.on('selectionUpdate', bump)
    editor.on('blur', bump)
    return () => {
      editor.off('selectionUpdate', bump)
      editor.off('blur', bump)
    }
  }, [editor])
  if (!editor || editor.isDestroyed || !target || off) return null
  const { from, to, empty } = editor.state.selection
  if (empty || !editor.isFocused) return null
  const at = editor.view.coordsAtPos(from)
  const selection = { from, to, text: editor.state.doc.textBetween(from, to, '\n').slice(0, 4000) }
  const style = { position: 'fixed' as const, left: Math.max(8, at.left), top: Math.max(8, at.top - 44) }
  return (
    <div className="skyebar" role="toolbar" aria-label={SKYE} style={style} onMouseDown={(e) => e.preventDefault()}>
      <AgentAvatar agent="skye" size={20} decorative />
      {quota ? <span className="skyebar-line">{QUOTA_OUT}</span>
        : handsOff && !asked ? (
          <>
            <span className="skyebar-line">{HANDS_OFF_LINE}</span>
            <button className="btn xs" onClick={() => setAsked(true)}>Ask her</button>
          </>
        ) : SKYE_OPTIONS.map((o) => (
          <button key={o.intent} className="btn xs ghost" disabled={working}
            onClick={() => onStart(o.intent, { selection, ...(o.intent === 'fit_seconds' ? { seconds } : {}), ...(handsOff ? { explicit: true } : {}) })}>
            {o.label(seconds)}
          </button>
        ))}
    </div>
  )
}

/** A draft on its item: struck and underlined words, Skye's signed note, Keep / Keep mine / Why. */
export function SuggestionCard({ sug, store, me, currentProse, onWhy, say, askAgain }: {
  sug: Suggestion
  store: ModelStore
  me: string
  currentProse: () => Prose
  onWhy: (f: HistoryFocus) => void
  say: (m: string, undo?: boolean) => void
  askAgain: () => void
}) {
  const [stale, setStale] = useState(sug.state === 'stale')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    if (sug.state === 'open') void proseHash(currentProse()).then((h) => alive && setStale(h !== sug.base_hash))
    return () => {
      alive = false
    }
  })
  const mine = sug.for === me
  const docId = (() => {
    try {
      return store.documentId()
    } catch {
      return ''
    }
  })()
  const why = () => onWhy({ label: 'Skye\'s draft', addresses: [`${docId}#suggestions[${sug.id}]`, `${docId}#jobs[${sug.job_id}]`, `${docId}#${sug.target.kind}s[${sug.target.id}]`] })
  if (!mine) {
    return (
      <div className="sugcard others">
        <AgentAvatar agent="skye" size={20} decorative />
        <span className="faint">Skye is drafting for {sug.for.replace(/^human:/, '')}</span>
      </div>
    )
  }
  const before = linesOf(store.get(), currentProse()).map((l) => l.text).join('\n')
  const diff = wordDiff(before, sug.proposed.text)
  const run = async (fn: () => Promise<{ line: string }>, undo = true) => {
    setBusy(true)
    try {
      const r = await fn()
      say(r.line, undo)
    } catch (e) {
      if (e instanceof StaleSuggestion) setStale(true)
      else say(e instanceof Error ? e.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={`sugcard ${stale ? 'stale' : ''}`} role="group" aria-label={`${SKYE}: ${sug.note}`}>
      <div className="sug-words">
        {diff.map((p, i) => (p.kind === 'same' ? <span key={i}>{p.text}</span> : p.kind === 'gone' ? <del key={i}>{p.text}</del> : <ins key={i}>{p.text}</ins>))}
        {sug.proposed.duration_s !== undefined && <span className="sug-meta"> · {sug.proposed.duration_s} s</span>}
        {(sug.proposed.new_beats ?? []).map((b, i) => <ins key={`b${i}`} className="sug-beat"> + {b.kind} at 0:{String(Math.floor(b.at_s)).padStart(2, '0')}{b.at_s % 1 ? '.5' : ''}</ins>)}
      </div>
      <div className="sug-bubble">
        <AgentAvatar agent="skye" size={20} decorative />
        <span><b>{SKYE}:</b> {stale ? new StaleSuggestion().message : sug.note}</span>
        <span className="spacer" />
        {stale ? (
          <button className="btn xs" onClick={askAgain}>Ask again</button>
        ) : (
          <>
            <button className="btn xs primary" disabled={busy} onClick={() => void run(() => keep(store, sug.id))}>Keep</button>
            <button className="btn xs" disabled={busy} onClick={() => void run(() => keepMineDraft(store, sug.id))}>Keep mine</button>
          </>
        )}
        <button className="btn xs ghost" onClick={why}>Why</button>
      </div>
    </div>
  )
}
