// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The nine screen states (v2 section 4), shared by every tool: Normal, Empty,
// Loading, Failed save, Missing access, Changed brief, Run failed, Not right
// and Long run. Each one is a flat region: one plain line, at most one more,
// and at most one primary button. No card, no icon, no motion.
//
// The words live in words.ts. The look is the shell's own (states.css): its
// tokens, its buttons, its eyebrow label; the proposal says what each state says.

import { useEffect, useState, type ReactNode } from 'react'
import { LogoSpinner } from '../../brand/LogoSpinner'
import {
  CHANGED_BRIEF, FAILED_SAVE, J001_BRIEF_EXAMPLE, LOADING, LONG_RUN, MISSING_ACCESS, NOT_RIGHT, runFailedLine,
  type Example, type RunFailure,
} from './words'
import { loadingPhase, RECTS_AFTER_MS, SPINNER_AFTER_MS } from './loading'
import './states.css'

interface Act {
  /** The button's words. */
  label: string
  onPress?: () => void
  /** A primary that cannot run yet is dashed, with its reason under it (v2 section 8). */
  reason?: string
  /** One primary per screen: a state shown beside a primary of the app's own passes false. */
  primary?: boolean
  busy?: boolean
}

function Button({ act, id }: { act: Act; id: string }) {
  const { label, onPress, reason, primary = true, busy } = act
  const cannot = reason !== undefined
  const cls = cannot ? 'ch-btn ns-btn ns-dashed' : primary ? 'ch-btn ch-btn-primary ns-btn ns-primary' : 'ch-btn ns-btn'
  return (
    <div className="ns-act">
      <button
        type="button"
        className={cls}
        aria-disabled={cannot || busy ? true : undefined}
        aria-describedby={cannot ? `${id}-why` : undefined}
        onClick={cannot || busy ? undefined : onPress}
      >{label}</button>
      {cannot && <p className="ns-why" id={`${id}-why`}>{reason}</p>}
    </div>
  )
}

/** The frame every state sits in: a labelled region. `compact` drops the outer space (inside a launcher card). */
function Frame({ state, label, children, compact, live }: { state: string; label: string; children: ReactNode; compact?: boolean; live?: 'status' | 'alert' }) {
  return (
    // A group, not a landmark: the same state appears in several places on a page and landmarks must be unique.
    <div className={`ns${compact ? ' ns-compact' : ''}`} data-state={state} aria-label={label} role={live ?? 'group'}>
      {children}
    </div>
  )
}

let seq = 0
/** A stable id per mounted state, for aria-describedby. */
function useId_(prefix: string): string {
  const [id] = useState(() => `${prefix}-${++seq}`)
  return id
}

// ── 1. Normal ───────────────────────────────────────────────────────────────
/** The work, and one obvious next button. */
export function Normal({ work, next, title }: { work: ReactNode; next?: Act; title?: string }) {
  const id = useId_('ns-normal')
  return (
    <Frame state="normal" label={title ?? 'The work'}>
      <div className="ns-work">{work}</div>
      {next && <Button act={next} id={id} />}
    </Frame>
  )
}

// ── 2. Empty ────────────────────────────────────────────────────────────────
/**
 * One line on what goes here, a finished example, and one starting verb. Never
 * a blank box. `inert` draws the verb as plain text for a card that opens
 * nothing (the launcher's coming-soon card); `reason` makes the verb dashed.
 */
export function Empty({ line, example = J001_BRIEF_EXAMPLE, verb, onStart, reason, compact, inert }: {
  line: string; example?: Example; verb: string; onStart?: () => void; reason?: string; compact?: boolean; inert?: boolean
}) {
  const id = useId_('ns-empty')
  return (
    <Frame state="empty" label="Empty" compact={compact}>
      <p className="ns-line">{line}</p>
      <div className="ns-example">
        <p className="eyebrow">{example.title}</p>
        {example.lines.map(l => <p key={l} className="ns-small">{l}</p>)}
      </div>
      {inert
        ? <div className="ns-act"><span className="ch-btn ns-btn ns-dashed" aria-disabled="true">{verb}</span>{reason && <p className="ns-why">{reason}</p>}</div>
        : <Button act={{ label: verb, onPress: onStart, reason }} id={id} />}
    </Frame>
  )
}

// ── 3. Loading ──────────────────────────────────────────────────────────────
/**
 * What is loading, in place. Under 300 ms it shows nothing but its words (the
 * screen has already answered within 100 ms); from 300 ms grey rectangles in
 * the final layout; the mark only from one second (v2 Never: spinners for
 * anything under a second). `after` pins the phase for the gallery.
 */
export function Loading({ what, rows = 3, after }: { what: string; rows?: number; after?: number }) {
  const [ms, setMs] = useState(after ?? 0)
  useEffect(() => {
    if (after !== undefined) return
    const t1 = setTimeout(() => setMs(RECTS_AFTER_MS), RECTS_AFTER_MS)
    const t2 = setTimeout(() => setMs(SPINNER_AFTER_MS), SPINNER_AFTER_MS)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [after])
  const phase = loadingPhase(ms)
  return (
    <Frame state="loading" label="Loading" live="status">
      <p className="ns-line">{LOADING.what(what)}</p>
      {phase !== 'quiet' && (
        <div className="ns-rects" aria-hidden data-phase={phase}>
          {Array.from({ length: rows }, (_, i) => <i key={i} style={{ width: `${[89, 64, 76, 55][i % 4]}%` }} />)}
        </div>
      )}
      {phase === 'spinner' && <LogoSpinner size="sm" />}
    </Frame>
  )
}

// ── 4. Failed save ──────────────────────────────────────────────────────────
/** Their work kept, one plain line, Try again. `compact` and `primary: false` when it sits in the shell beside the app. */
export function FailedSave({ onRetry, primary = true, busy, compact }: { onRetry?: () => void; primary?: boolean; busy?: boolean; compact?: boolean }) {
  const id = useId_('ns-failed-save')
  return (
    <Frame state="failed-save" label="Failed save" live="alert" compact={compact}>
      <p className="ns-line">{FAILED_SAVE.line}</p>
      <Button act={{ label: FAILED_SAVE.retry, onPress: onRetry, primary, busy }} id={id} />
    </Frame>
  )
}

// ── 5. Missing access ───────────────────────────────────────────────────────
/** Who can grant it, and one button to ask. */
export function MissingAccess({ what, who, onAsk, asked }: { what: string; who: string; onAsk?: () => void; asked?: boolean }) {
  const id = useId_('ns-access')
  return (
    <Frame state="missing-access" label="Missing access">
      <p className="ns-line">{asked ? MISSING_ACCESS.asked(who) : MISSING_ACCESS.line(what, who)}</p>
      {!asked && <Button act={{ label: MISSING_ACCESS.ask(who), onPress: onAsk }} id={id} />}
    </Frame>
  )
}

// ── 6. Changed brief ────────────────────────────────────────────────────────
/** Two lines on what changed, and one button: Update to brief vN. */
export function ChangedBrief({ from, to, changes, onUpdate, primary = true, compact }: {
  from?: string; to?: string; changes: string; onUpdate?: () => void; primary?: boolean; compact?: boolean
}) {
  const id = useId_('ns-changed')
  return (
    <Frame state="changed-brief" label="Changed brief" live="status" compact={compact}>
      <p className="ns-line">{to && from ? CHANGED_BRIEF.first(to, from) : CHANGED_BRIEF.moved}</p>
      <p className="ns-small">{changes}</p>
      <Button act={{ label: CHANGED_BRIEF.update(to), onPress: onUpdate, primary }} id={id} />
    </Frame>
  )
}

// ── 7. Run failed ───────────────────────────────────────────────────────────
/** One plain line. The reserved estimate returned. Inputs kept. Try again. */
export function RunFailed({ why = 'other', onRetry, primary = true, busy, compact }: {
  why?: RunFailure; onRetry?: () => void; primary?: boolean; busy?: boolean; compact?: boolean
}) {
  const id = useId_('ns-run-failed')
  return (
    <Frame state="run-failed" label="Run failed" live="alert" compact={compact}>
      <p className="ns-line">{runFailedLine(why)}</p>
      <Button act={{ label: 'Try again', onPress: onRetry, primary, busy }} id={id} />
    </Frame>
  )
}

// ── 8. Not right ────────────────────────────────────────────────────────────
/** It asks what is wrong and offers three quick fixes. */
export function NotRight({ fixes = NOT_RIGHT.fixes, onFix }: { fixes?: readonly string[]; onFix?: (fix: string) => void }) {
  return (
    <Frame state="not-right" label="Not right">
      <p className="ns-line">{NOT_RIGHT.ask}</p>
      <div className="ns-fixes">
        {fixes.slice(0, 3).map(f => <button key={f} type="button" className="ch-btn ns-btn" onClick={() => onFix?.(f)}>{f}</button>)}
      </div>
    </Frame>
  )
}

// ── 9. Long run ─────────────────────────────────────────────────────────────
/** Time left, and the promise that Needs you says when it is done. No bar, no motion. */
export function LongRun({ minutes, step }: { minutes: number; step?: string }) {
  return (
    <Frame state="long-run" label="Long run" live="status">
      <p className="ns-line">{LONG_RUN.left(minutes)}</p>
      {step && <p className="ns-small">{step}</p>}
      <p className="ns-small">{LONG_RUN.needsYou}</p>
    </Frame>
  )
}
