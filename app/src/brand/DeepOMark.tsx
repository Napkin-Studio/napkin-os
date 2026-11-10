// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The one mark engine: Deep O, at any size and in any state, wherever the studio
// shows its mark (the OS bar's medallion, sign-in, every loading sign, the busy
// veil). Its geometry is brand/deepOSvg.ts, its motion the grammar (brand/deepO.ts),
// both as the approved mock draws its bar mark (napkin-app-v1.html headerMark,
// mountH1Mark, tickH1Mark).
//
// The host owns the state; the mark only eases toward what it was told. Above
// 24 px it is the satin mark, below and at 24 px the grammar's small cut. Both are
// SVG, so it needs neither canvas nor WebGL; where there is no animation frame (a
// test, a server render) it is drawn once, as the model stands.
//
// Loading is `working`: with a `progress` the ring shows it (steps done / steps,
// never faked); without one the length of the wait is unknown, and a short arc
// goes round (indeterminate). The bar's mark is `shared`: one model for the
// whole studio (the mock's sharedModel), so leaving the desk keeps its state.
// Every other mark has its own. It looks toward the pointer only while awake.
//
// Reduced motion: the grammar's reduced steps (no breath, no wave, no turning
// arc), no pointer follow, frames only while it settles; an indeterminate wait
// breathes its arc instead of turning it, so there is still a sign of life.

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createModel, TIMING, type MarkKind, type MarkModel, type MarkState } from './deepO'
import {
  defaultProgress, h1Attrs, h1Inner, INDETERMINATE_LEN, nodePainter, paintH1, SMALL_MAX, smallInner, SPIN_PERIOD,
  type MarkPalette,
} from './deepOSvg'
import { pointerTarget, stepLook, type Look } from '../components/medallionMotion'
import { listen, look as sharedLook, modelOf, pointer, reduced, setLook as setSharedLook } from '../components/markStore'
import { useAgencyMark } from './useAgencyMark'

export type { MarkPalette } from './deepOSvg'

export interface DeepOMarkProps {
  /** Pixels across, 16 to about 120. */
  size?: number
  state?: MarkState
  /** Steps done / steps. Leave it out while working when the length is unknown. */
  progress?: number
  kind?: MarkKind
  /** The run's stage; a new stage while working plays the handoff. */
  stage?: string | null
  /** The agency's colours; by default the agency on the page, else the last one here, else Napkin's. */
  palette?: MarkPalette
  /** The studio's one model (the OS bar's medallion and sign-in). */
  shared?: boolean
  /** Look toward the pointer while awake. Default: on for the shared mark. */
  follow?: boolean
  testId?: string
}


const REST: Look = { lx: 0, ly: 0, vx: 0, vy: 0 }
const PAPER = { light: '#FFFDF8', dark: '#1B1A18' }
/** The colour behind the mark, for the small cut's contrast rim: the theme's paper. */
function surfaceNow(): string {
  if (typeof document === 'undefined') return PAPER.light
  const t = document.documentElement?.dataset?.theme
  const dark = t === 'dark' || (t !== 'light' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  return dark ? PAPER.dark : PAPER.light
}

export function DeepOMark({ size = 38, state = 'awake', progress, kind, stage, palette, shared = false, follow, testId = 'deep-o-mark' }: DeepOMarkProps) {
  const agency = useAgencyMark()
  const pal = palette ?? agency
  const uid = 'o' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const svg = useRef<SVGSVGElement>(null)
  const indeterminate = state === 'working' && progress == null
  const p = progress ?? defaultProgress(state)
  const small = size <= SMALL_MAX
  const followOn = follow ?? shared

  const [own] = useState<MarkModel | null>(() => {
    if (shared) return null
    const m = createModel({ state, progress: p })
    m.snap(reduced())
    return m
  })
  const model = shared ? modelOf({ state, progress: p }) : own!
  const ownLook = useRef<Look>(REST)

  // Tell the model (the mock's headerMark.set); a new stage during a run is a handoff, then working again.
  const stageRef = useRef<string | null>(null)
  useEffect(() => {
    let after = 0
    const prev = stageRef.current
    stageRef.current = state === 'working' ? stage ?? null : null
    if (state === 'working' && prev && stage && stage !== prev) {
      model.handoff(stage)
      after = window.setTimeout(() => model.set({ state: 'working', progress: p, kind }), (TIMING.hold + TIMING.glide) * 1000)
    } else {
      model.set({ state, progress: p, kind })
    }
    return () => window.clearTimeout(after)
  }, [model, state, p, kind, stage])

  // The draw loop (the mock's tickH1Mark): attributes only above 24 px, the small cut's markup below.
  useEffect(() => {
    listen()
    const el = svg.current
    if (!el || typeof requestAnimationFrame !== 'function') return
    const getLook = shared ? sharedLook : () => ownLook.current
    const putLook = shared ? setSharedLook : (l: Look) => (ownLook.current = l)
    const set = nodePainter(el)
    let surface = surfaceNow(), surfaceAt = 0
    let id = 0
    let lastT = performance.now()
    let lastDraw = 0
    const tick = (now: number) => {
      id = requestAnimationFrame(tick)
      if (document.hidden) { lastT = now; return }
      const rm = reduced()
      // only the frames the grammar asks for: always under reduced motion, and for the small cut (a fresh markup each frame)
      const cap = indeterminate ? (rm ? 10 : small ? 30 : 60) : rm || small ? model.fpsCap(rm) : 60
      if (!cap || now - lastDraw < 1000 / cap - 1) { lastT = now; return }
      lastDraw = now
      const dt = Math.min(0.05, (now - lastT) / 1000)
      lastT = now
      const c = model.step(dt, rm)
      if (indeterminate) {
        c.len = INDETERMINATE_LEN
        if (!rm) model.S.arcTail += dt / SPIN_PERIOD
      }
      // an indeterminate wait under reduced motion breathes its arc instead of turning it
      const breathe = indeterminate && rm ? 0.55 + 0.45 * (0.5 + 0.5 * Math.cos(now / 1000 * 2 * Math.PI / SPIN_PERIOD)) : 1
      const awake = model.S.state === 'awake'
      const r = followOn && awake && !rm && el.parentElement ? el.parentElement.getBoundingClientRect() : null
      const { tx, ty } = pointerTarget(c.night, c.warm, r, pointer())
      const l = putLook(stepLook(getLook(), tx, ty, dt))
      if (small) {
        if (now - surfaceAt > 1000) { surface = surfaceNow(); surfaceAt = now }
        el.innerHTML = smallInner(pal, size, surface, c, model.S.arcTail, uid, { arcOpacity: breathe })
      } else {
        const A = h1Attrs(pal, c, model.S.arcTail, l, rm ? 0 : now / 1000)
        paintH1(set, A)
        if (breathe !== 1) set('arc', { opacity: (Number(A.arcOpacity) * breathe).toFixed(3) })
      }
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, pal.base, pal.accent, small, size, indeterminate, followOn, uid, shared])

  // The first paint, before any frame: the model as it stands. Kept while the
  // colours and the cut hold, so a new state never resets what the loop paints.
  const inner = useMemo(() => {
    const c = indeterminate ? { ...model.c, len: INDETERMINATE_LEN } : model.c
    return small
      ? smallInner(pal, size, surfaceNow(), c, model.S.arcTail, uid)
      : h1Inner(pal, h1Attrs(pal, c, model.S.arcTail, shared ? sharedLook() : REST, 0), uid)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, pal.base, pal.accent, small, size, uid])
  // The same object while the first paint holds: React 19 writes innerHTML again
  // whenever this prop is a new object, even with the same markup, and that put the
  // first paint back over every frame (the mark froze in the state it mounted in;
  // back from a document that needed you, the desk showed "needs").
  const html = useMemo(() => ({ __html: inner }), [inner])

  return (
    <svg ref={svg} xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="-50 -50 100 100"
      style={{ display: 'block', overflow: 'visible', flexShrink: 0 }}
      aria-hidden data-testid={testId} data-state={state} data-cut={small ? 'small' : 'satin'}
      dangerouslySetInnerHTML={html} />
  )
}

export default DeepOMark
