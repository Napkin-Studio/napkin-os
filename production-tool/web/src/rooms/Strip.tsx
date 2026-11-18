// The Make room strip's parts (features/join-or-cut-shots.clan, mock join-or-cut-v1): the gap toggle between
// two shots (joined: the blue link chip; cut: the scissors chip and CUT), its tip (what flipping it does), a
// shot in the strip (its frame, or its words when it has none), the box's limits panel and the stills of a
// take, one per shot window. The gap toggles are the only join and cut control (owner, 2026-11-16).

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { useDoc } from '../app/context'
import type { Id } from '../contracts/types'
import { selectedFrame } from '../jobs/frames'
import { shotNumber } from '../model/selectors'
import { cameraWord } from './delta'
import type { BoxLimit, FlipWords, Gap } from './joinCut'
import { Mentions } from './Mentions'
import { shotTitle, type Box, type Gen } from './model'
import { Poster } from './Poster'

const s1 = (n: number) => `${Math.round(n * 10) / 10}`

export const JoinIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M6.6 9.4 9.4 6.6" /><path d="M7.4 4.6l1.3-1.3a2.6 2.6 0 0 1 3.7 3.7l-1.3 1.3" /><path d="M8.6 11.4l-1.3 1.3a2.6 2.6 0 0 1-3.7-3.7l1.3-1.3" /></svg>
)
export const CutIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><circle cx="4.5" cy="4.5" r="2" /><circle cx="4.5" cy="11.5" r="2" /><path d="M6.2 5.6 13.5 12M6.2 10.4 13.5 4" /></svg>
)
export const WarnIcon = () => (
  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M8 1.8 15 14H1z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /><path d="M8 6.2v3.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><circle cx="8" cy="11.8" r=".9" fill="currentColor" /></svg>
)

/** A gap's toggle: Enter, Space or a click flips it; ← and → move to the gap before or after. */
export function GapButton({ gap, suggest, onFlip, onTip, onTipEnd }: {
  gap: Gap
  /** The cut the box suggests when the join is past its model's limits. */
  suggest?: boolean
  onFlip: (gap: Gap, keyboard: boolean) => void
  onTip: (gap: Gap, el: HTMLElement) => void
  onTipEnd: () => void
}) {
  const a = gap.n - 1
  const label = gap.blocked ? `Shots ${a} and ${gap.n} are always separate videos: ${gap.blocked}`
    : gap.joined ? `Shots ${a} and ${gap.n} are one video. Cut here` : `Shots ${a} and ${gap.n} are separate videos. Join them`
  const key = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const all = [...(e.currentTarget.closest('.jc-strip')?.querySelectorAll<HTMLButtonElement>('.jc-gap') ?? [])]
    const i = all.indexOf(e.currentTarget)
    const next = all[(i + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length]
    next?.focus()
  }
  return (
    <button type="button" className={`jc-gap ${gap.joined ? 'joined' : 'cut'} ${suggest ? 'suggest' : ''} ${gap.blocked ? 'blocked' : ''}`} data-gap={gap.shotId}
      aria-pressed={gap.joined} aria-label={label} aria-disabled={!!gap.blocked || undefined} aria-describedby="jcTip"
      onClick={(e: MouseEvent<HTMLButtonElement>) => { if (!gap.blocked) onFlip(gap, e.detail === 0) }} onKeyDown={key}
      onMouseEnter={(e) => onTip(gap, e.currentTarget)} onMouseLeave={(e) => { if (document.activeElement !== e.currentTarget) onTipEnd() }}
      onFocus={(e) => onTip(gap, e.currentTarget)} onBlur={onTipEnd}>
      <span className="jc-chip">
        <span className="ic-now">{gap.joined ? <JoinIcon /> : <CutIcon />}</span>
        <span className="ic-flip">{gap.joined ? <CutIcon /> : <JoinIcon />}</span>
      </span>
      {(!gap.joined || suggest) && <span className="jc-glb">{suggest ? 'cut?' : 'cut'}</span>}
    </button>
  )
}

/** The tip over a gap: what flipping it does, a warning when the join is past its model's limits, the keys. */
export function GapTip({ anchor, words }: { anchor: HTMLElement; words: FlipWords }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; ax: number; below: boolean } | null>(null)
  useLayoutEffect(() => {
    const tip = ref.current
    const chip = anchor.querySelector('.jc-chip') ?? anchor
    if (!tip) return
    const r = chip.getBoundingClientRect()
    const t = tip.getBoundingClientRect()
    const left = Math.max(8, Math.min(window.innerWidth - t.width - 8, r.left + r.width / 2 - t.width / 2))
    const box = (anchor.closest('.jc-box') ?? anchor.nextElementSibling ?? anchor).getBoundingClientRect()
    let top = Math.min(r.top, box.top) - t.height - 10
    let below = false
    if (top < 60) { top = r.bottom + 30; below = true }
    setPos({ left, top, ax: r.left + r.width / 2 - left, below })
  }, [anchor, words.head, words.sub, words.warn])
  return (
    <div ref={ref} id="jcTip" role="tooltip" className={`jc-tip ${pos?.below ? 'below' : ''}`}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, ['--ax' as string]: `${pos?.ax ?? 0}px` }}>
      <b>{words.head}</b>
      <span>{words.sub}</span>
      {words.warn && <span className="w">{words.warn}</span>}
      <span className="k"><kbd>Enter</kbd> {words.verb === 'Join' ? 'join' : 'cut here'} · <kbd>←</kbd><kbd>→</kbd> next gap</span>
    </div>
  )
}

/** A shot in the strip: its frame (or its words), its number and name, its size and length. */
export function StripShot({ id, picked, onPick }: { id: Id; picked: boolean; onPick: () => void }) {
  const doc = useDoc()
  const s = doc.shots[id]
  const n = shotNumber(doc, id)
  const frame = selectedFrame(doc, id)
  const title = shotTitle(s, n)
  return (
    <div className={`jc-shot ${picked ? 'focus' : ''}`}>
      <button type="button" className="jc-shotbtn" onClick={onPick} aria-pressed={picked} aria-label={`Shot ${n}: ${title}`} title={`Shot ${n} · ${title}`}>
        {frame ? <Poster sha={frame.asset} className="jc-thumb" /> : <span className="jc-words"><span className="cl"><Mentions text={s?.action || s?.direction || ''} /></span></span>}
        <span className="jc-sn"><b>{n}</b> {title}</span>
        <span className="jc-sc">{cameraWord('size', s?.camera.size)} · {s1(s?.duration_s ?? 0)} s</span>
      </button>
    </div>
  )
}

/** The box says when it is past what its model makes in one go, with the two ways out; or, softly, that a
 *  frame is left out of the pictures the model takes. */
export function LimitPanel({ limit, onUse, onCut, cutN }: { limit: BoxLimit; onUse?: () => void; onCut?: () => void; cutN?: number }) {
  if (!limit.hard) {
    return (
      <div className="jc-limit soft" role="note"><WarnIcon />
        <div>{limit.why}
          {limit.alt && onUse && <div className="jc-lacts"><button type="button" className="btn sm" onClick={onUse}>Use {limit.alt.label} · takes them all</button></div>}
        </div>
      </div>
    )
  }
  const [head, ...rest] = limit.why.split(/(?<=\.) /)
  return (
    <div className="jc-limit" role="status"><WarnIcon />
      <div><b>{head}</b>{rest.length ? ` ${rest.join(' ')}` : ''}<span className="jc-lsub">Nothing is sent until it fits.</span>
        <div className="jc-lacts">
          {limit.alt && onUse && <button type="button" className="btn sm dark" onClick={onUse}>Use {limit.alt.label} · up to {limit.alt.maxS} s</button>}
          {limit.cutBefore && onCut && <button type="button" className="btn sm" onClick={onCut}>Cut before shot {cutN}</button>}
        </div>
      </div>
    </div>
  )
}

/** A take of a box made together: each shot's still from it, under its frame, with the shot's window. */
export function TakeStills({ take, box, fresh }: { take: Gen; box: Box; fresh: boolean }) {
  const segs = take.segments.filter((s) => box.shotIds.includes(s.shotId))
  if (segs.length < 2) return null
  const lo = segs[0].inS
  return (
    <div className={`jc-take ${fresh ? 'fresh' : ''}`}>
      <div className="jc-takehd"><span className="tk">v{take.version}</span>{fresh && <span className="jc-just">Just made</span>}<span>Each shot’s window, under its frame</span></div>
      <div className="jc-row stills">
        {segs.map((s, i) => (
          <span key={s.shotId} className="jc-stillwrap">
            {i > 0 && <span className="jc-gsp" aria-hidden="true" />}
            <figure><Poster sha={take.asset} atS={(s.inS + s.outS) / 2} className="jc-thumb" /><figcaption>{s1(s.inS - lo)}–{s1(s.outS - lo)} s</figcaption></figure>
          </span>
        ))}
      </div>
    </div>
  )
}
