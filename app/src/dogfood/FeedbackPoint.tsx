// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Feedback by pointing at it, the shell's side (pointer.ts holds the state;
// features/feedback-point.clan). The F key, the banner, the outline over what
// is under the cursor in the shell, the note card next to what was picked,
// and the thanks. Inside a tool's frame the page outlines and names things
// itself (shared/clan-fields.html) and tells the shell what was picked.
// Nothing renders unless the build records and the person has agreed.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  aboutLine, cancelPointing, cardSpot, describeShell, doneSent, feedbackDoc, keyAction, pick, pointState,
  sendNote, sentWithLine, startPointing, subscribePoint, type NoteKind, type Picked, type Rect,
} from './pointer'
import { dogfoodState, recording, subscribe } from './recorder'

const KINDS: { k: NoteKind; label: string }[] = [
  { k: 'wrong', label: 'Wrong' }, { k: 'unclear', label: 'Unclear' }, { k: 'idea', label: 'Idea' },
]

/** Our own UI is never what feedback is about. */
const OURS = '.fbp-ui'

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.top, w: r.width, h: r.height }
}

/** The note: kind, a line, what goes with it, Cancel / Send. */
export function NoteCard({ picked, at }: { picked: Picked; at: { left: number; top: number } }) {
  const [kind, setKind] = useState<NoteKind>('wrong')
  const [text, setText] = useState('')
  const doc = feedbackDoc()
  const send = () => sendNote(kind, text)
  // No "Attach a screenshot": the tool's frame is cross-origin, so the shell cannot read
  // its pixels, and the app has no canvas library. Not offered rather than faked.
  return (
    <div className="fbp-ui fbp-card" role="dialog" aria-label="Feedback" style={{ left: at.left, top: at.top }}>
      <div className="fbp-about">ABOUT <span>· {aboutLine(picked.target, doc, picked.page).replace(/^ABOUT · /, '')}</span></div>
      <div className="fbp-kinds" role="radiogroup" aria-label="What kind of feedback">
        {KINDS.map(x => (
          <button key={x.k} type="button" role="radio" aria-checked={kind === x.k} className={kind === x.k ? 'on' : undefined}
            data-dogfood={`feedback kind ${x.k}`} onClick={() => setKind(x.k)}>{x.label}</button>
        ))}
      </div>
      <textarea value={text} onChange={e => setText(e.target.value)} autoFocus aria-label="Your feedback"
        placeholder="What is wrong, unclear, or an idea?"
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() } }} />
      <div className="fbp-with">{sentWithLine(picked.target, doc)}</div>
      <div className="fbp-acts">
        <button type="button" className="ch-btn" data-dogfood="feedback cancel" onClick={cancelPointing}>Cancel</button>
        <button type="button" className="ch-btn fbp-go" data-dogfood="feedback send" onClick={send}>Send</button>
      </div>
    </div>
  )
}

export const BANNER = 'Click what your feedback is about · Esc to cancel'
export const THANKS = 'Thanks, it went to the Napkin team with what you pointed at.'

/** The banner, the outline, the card and the thanks; the F key. */
export default function FeedbackPoint() {
  const df = useSyncExternalStore(subscribe, dogfoodState, dogfoodState)
  const st = useSyncExternalStore(subscribePoint, pointState, pointState)
  const on = df.on && df.consented
  const [hover, setHover] = useState<{ rect: Rect; label: string } | null>(null)
  const phase = useRef(st.phase)
  useEffect(() => { phase.current = st.phase }, [st.phase])

  // F anywhere in the shell (the frame tells us its own, clan:feedback-key); Esc cancels.
  useEffect(() => {
    if (!on) return
    const onKey = (e: KeyboardEvent) => {
      const a = keyAction(e, phase.current)
      if (a === 'start') { e.preventDefault(); startPointing() }
      else if (a === 'cancel') { e.preventDefault(); cancelPointing() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [on])

  // Pointing in the shell: outline and name what is under the cursor; one click picks it,
  // and does nothing else (the button under it is not pressed).
  const pointing = on && st.phase === 'pointing'
  useEffect(() => {
    if (!pointing) return
    document.documentElement.classList.add('fbp-pointing')
    const under = (t: EventTarget | null) => {
      const el = t instanceof Element ? t : null
      if (!el || el.closest(OURS) || el.tagName === 'IFRAME') return null
      return describeShell(el)
    }
    const move = (e: PointerEvent) => {
      const d = under(e.target)
      setHover(d ? { rect: rectOf(d.el as Element), label: d.target.label } : null)
    }
    const block = (e: Event) => {
      if (e.target instanceof Element && e.target.closest(OURS)) return
      e.preventDefault(); e.stopPropagation()
    }
    const click = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest(OURS)) return
      e.preventDefault(); e.stopPropagation()
      const d = under(e.target)
      if (d) pick({ target: d.target, in: 'shell', rect: rectOf(d.el as Element) })
    }
    document.addEventListener('pointermove', move, true)
    document.addEventListener('pointerdown', block, true)
    document.addEventListener('mousedown', block, true)
    document.addEventListener('click', click, true)
    return () => {
      document.documentElement.classList.remove('fbp-pointing')
      document.removeEventListener('pointermove', move, true)
      document.removeEventListener('pointerdown', block, true)
      document.removeEventListener('mousedown', block, true)
      document.removeEventListener('click', click, true)
      setHover(null)
    }
  }, [pointing])

  // The thanks stays a few seconds.
  useEffect(() => {
    if (st.phase !== 'sent') return
    const t = setTimeout(doneSent, 4000)
    return () => clearTimeout(t)
  }, [st.phase])

  // Leaving the studio while pointing: the frame is told to stop too.
  useEffect(() => () => cancelPointing(), [])

  if (!on || !recording()) return null
  const view = { w: typeof window !== 'undefined' ? window.innerWidth : 1280, h: typeof window !== 'undefined' ? window.innerHeight : 800 }
  return (
    <>
      {st.phase === 'pointing' && (
        <div className="fbp-ui fbp-banner" role="status" aria-label={BANNER}>Click what your feedback is about<kbd>Esc</kbd> to cancel</div>
      )}
      {st.phase === 'pointing' && hover && <Outline rect={hover.rect} label={hover.label} />}
      {st.phase === 'note' && (
        <>
          <Outline rect={st.picked.rect} />
          <NoteCard key={`${st.picked.target.kind}:${st.picked.target.id}`} picked={st.picked} at={cardSpot(st.picked.rect, view)} />
        </>
      )}
      {st.phase === 'sent' && <div className="fbp-ui fbp-toast" role="status">{THANKS}</div>}
    </>
  )
}

function Outline({ rect, label }: { rect: Rect; label?: string }) {
  return (
    <div className="fbp-outline" aria-hidden="true" style={{ left: rect.x - 3, top: rect.y - 3, width: rect.w + 6, height: rect.h + 6 }}>
      {label && <span className="fbp-tag">{label}</span>}
    </div>
  )
}
