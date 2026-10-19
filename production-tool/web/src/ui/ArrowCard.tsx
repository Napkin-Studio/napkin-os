// Arrow cards (features/canvas-arrow-cards.clan): rest the pointer on a provenance
// arrow and, after a moment, a small card says what that step did; select the
// arrow (a click, a tap, the keyboard) and the card stays until Escape or a click
// elsewhere. Excalidraw has no hover per element, so this listens to the pointer
// over the canvas and hit-tests the arrows itself (canvas/arrowHit.ts); the words
// come from canvas/arrowCard.ts. Listeners are passive: Excalidraw keeps every event.

import { CaptureUpdateAction, viewportCoordsToSceneCoords } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useDoc, useUi } from '../app/context'
import { arrowCard, cardLines, type ArrowCard as Card, type NodeKind } from '../canvas/arrowCard'
import { arrowPath, hitArrow, provenanceOf, type ArrowLike, type Pt } from '../canvas/arrowHit'
import { byOwnId, cd, textOf, type El } from '../canvas/scene'

const DELAY_MS = 250

interface Shown { arrowId: string; at: Pt }

/** Is the person in the middle of something (drawing, dragging, typing, another tool)? Then no cards. */
function busy(api: ExcalidrawImperativeAPI): boolean {
  const st = api.getAppState()
  return st.activeTool.type !== 'selection' || !!st.newElement || !!st.selectionElement || st.selectedElementsAreBeingDragged ||
    st.isResizing || st.isRotating || !!st.editingTextElement
}

export function ArrowCards({ api, wrap, selected, toView }: {
  api: ExcalidrawImperativeAPI
  wrap: RefObject<HTMLDivElement | null>
  /** The selected elements: one provenance arrow pins its card. */
  selected: El[]
  toView: (p: Pt) => Pt
}) {
  const [hover, setHoverState] = useState<Shown | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<string | null>(null)
  /** The arrow whose card shows, for the listeners (they outlive a render). */
  const hoverId = useRef<string | null>(null)
  const setHover = useCallback((s: Shown | null) => {
    hoverId.current = s?.arrowId ?? null
    setHoverState(s)
  }, [])

  const pinnedArrow = selected.length === 1 && provenanceOf(selected[0]) ? selected[0] : undefined

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    pending.current = null
  }, [])

  // The pointer over the canvas: which arrow, if any, and show its card after a moment.
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const hide = () => {
      clearTimer()
      if (hoverId.current) setHover(null)
    }
    const move = (e: PointerEvent) => {
      // Only over the canvas itself (not a toolbar or a card), with no button down, in the selection tool.
      if (e.buttons !== 0 || (e.target as Element | null)?.tagName !== 'CANVAS' || busy(api)) return hide()
      const st = api.getAppState()
      const scene = viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, st)
      const hit = hitArrow(api.getSceneElements() as unknown as ArrowLike[], scene, st.zoom.value)
      if (!hit) return hide()
      if (hit.id === hoverId.current || hit.id === pending.current) return
      clearTimer()
      if (hoverId.current) setHover(null)
      const box = el.getBoundingClientRect()
      const at = { x: e.clientX - box.left, y: e.clientY - box.top }
      pending.current = hit.id
      timer.current = setTimeout(() => {
        timer.current = null
        pending.current = null
        setHover({ arrowId: hit.id, at })
      }, DELAY_MS)
    }
    el.addEventListener('pointermove', move, { passive: true })
    el.addEventListener('pointerdown', hide, { passive: true })
    el.addEventListener('pointerleave', hide, { passive: true })
    el.addEventListener('wheel', hide, { passive: true })
    return () => {
      clearTimer()
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerdown', hide)
      el.removeEventListener('pointerleave', hide)
      el.removeEventListener('wheel', hide)
    }
  }, [api, wrap, setHover, clearTimer])

  // Escape closes the card: the hover one, or the pinned one by letting go of the arrow.
  useEffect(() => {
    if (!hover && !pinnedArrow) return
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      clearTimer()
      setHover(null)
      if (pinnedArrow) api.updateScene({ appState: { selectedElementIds: {} }, captureUpdate: CaptureUpdateAction.NEVER })
    }
    document.addEventListener('keydown', key, true)
    return () => document.removeEventListener('keydown', key, true)
  }, [api, hover, pinnedArrow, setHover, clearTimer])

  if (pinnedArrow) {
    // Beside the arrow's middle, so it is where the person looked.
    const path = arrowPath(pinnedArrow as unknown as ArrowLike)
    const mid = path[Math.floor(path.length / 2)]
    return <CardView arrow={pinnedArrow} at={toView(mid)} pinned api={api} />
  }
  if (!hover) return null
  const arrow = api.getSceneElements().find((x) => x.id === hover.arrowId) as El | undefined
  if (!arrow) return null
  return <CardView arrow={arrow} at={hover.at} api={api} />
}

function CardView({ arrow, at, pinned = false, api }: { arrow: El; at: Pt; pinned?: boolean; api: ExcalidrawImperativeAPI }) {
  const doc = useDoc()
  const ui = useUi()
  const link = provenanceOf(arrow)
  const card: Card | null = useMemo(() => {
    if (!link) return null
    const els = api.getSceneElements() as El[]
    const kindOf = (nodeId: string): NodeKind | undefined => {
      const el = byOwnId(els, nodeId)
      const c = cd(el)
      if (!el || !c || c.kind === 'provenance' || c.kind === 'pin') return undefined
      return c.kind === 'note' ? { kind: 'note', text: textOf(el) } : { kind: c.kind }
    }
    return arrowCard(doc, ui, link, { kindOf })
  }, [doc, ui, link?.from, link?.to, api]) // eslint-disable-line react-hooks/exhaustive-deps
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  // Beside the pointer (below right), flipped to stay inside the canvas; placed before it paints.
  const place = useCallback(() => {
    const el = ref.current
    const box = el?.offsetParent as HTMLElement | null
    if (!el || !box) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const bw = box.clientWidth
    const bh = box.clientHeight
    const gap = 14
    let left = at.x + gap
    let top = at.y + gap
    if (left + w > bw - 8) left = Math.max(8, at.x - gap - w)
    if (top + h > bh - 8) top = Math.max(8, at.y - gap - h)
    setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }))
  }, [at.x, at.y])
  useLayoutEffect(place)

  if (!card) return null
  return (
    <div ref={ref} className={`float fpanel arrowcard ${pinned ? 'pinned' : ''}`} role={pinned ? 'dialog' : 'tooltip'}
      aria-label={cardLines(card).join('. ')} data-testid="arrow-card"
      style={pos ? { left: pos.left, top: pos.top } : { left: at.x, top: at.y, visibility: 'hidden' }}
      onPointerDown={(e) => e.stopPropagation()}>
      <div className="ac-head">
        <span className="ac-title">{card.title}</span>
        {pinned && (
          <button type="button" className="btn xs ghost icon" aria-label="Close" title="Close (Esc)"
            onClick={() => api.updateScene({ appState: { selectedElementIds: {} }, captureUpdate: CaptureUpdateAction.NEVER })}>✕</button>
        )}
      </div>
      <div className="ac-who">{card.who}</div>
      {card.fallback && <div className="ac-note">{card.fallback}</div>}
      {card.state && <div className="ac-note">{card.state}</div>}
      <dl className="ac-rows">
        <dt>From</dt>
        <dd>{card.from.map((f, i) => (
          <span key={f.label}>{i > 0 && ', '}<span className={f.here ? 'ac-here' : undefined}>{f.label}</span></span>
        ))}</dd>
        {card.words && <><dt>Your words</dt><dd className="ac-words">{card.words}</dd></>}
        {card.changed && <><dt>What it changed</dt><dd>{card.changed}</dd></>}
        {card.told && <><dt>What the model was told</dt><dd className="ac-told">{card.told}</dd></>}
      </dl>
      {card.passthrough && <div className="ac-foot">{card.passthrough}</div>}
      {(card.when || card.cost) && <div className="ac-foot">{[card.when, card.cost].filter(Boolean).join(' · ')}</div>}
    </div>
  )
}
