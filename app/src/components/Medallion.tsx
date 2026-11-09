// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The medallion: the approved mock's satin "H1" mark (design/new-ui/
// napkin-app-v1.html, mountH1Mark and tickH1Mark), in the agency's colours,
// driven by Deep O's state grammar (brand/deepO.ts) as the mock drives it. A
// satin sphere with a window cut into it; through the window, a sky over a sea
// whose horizon line is the agency's accent.
//
// The host owns the state (components/medallionMotion.ts markTarget): asleep
// until the person engages, then awake; working with its progress during a run;
// needs only when the app the person is IN needs them; done when a run ends with
// nothing open; handoff when the run moves to its next stage. The mark only
// eases toward what it was told. While it wakes it looks toward a pointer that is
// over it; asleep it does not. One model for the whole studio, as the mock's
// sharedModel, so leaving the desk keeps the state and the mark eases across.
//
// Reduced motion: the grammar's reduced steps (no breath, no wave, no turning
// arc), no pointer follow, and frames only while it settles. Where there is no
// animation frame (a test) it is drawn once, as the model stands.

import { useEffect, useId, useRef } from 'react'
import { TIMING } from '../brand/deepO'
import { frameAttrs, pointerTarget, stepLook, type MarkTarget } from './medallionMotion'
import { listen, look, modelOf, pointer, reduced, setLook } from './markStore'
import { mix } from './medallionLook'

export type { MarkTarget } from './medallionMotion'

/** The mark, `size` px across, in the agency's `base` and `accent`, told `target`. */
export function MedallionMark({ base, accent, target, size = 38 }: { base: string; accent: string; target: MarkTarget; size?: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const svg = useRef<SVGSVGElement>(null)
  const model = modelOf(target)

  // Tell the model (the mock's headerMark.set); a new stage during a run is a handoff, then working again.
  const stageRef = useRef<string | null>(null)
  useEffect(() => {
    let after = 0
    const prev = stageRef.current
    stageRef.current = target.state === 'working' ? target.stage ?? null : null
    if (target.state === 'working' && prev && target.stage && target.stage !== prev) {
      model.handoff(target.stage)
      after = window.setTimeout(() => model.set({ state: 'working', progress: target.progress, kind: target.kind }), (TIMING.hold + TIMING.glide) * 1000)
    } else {
      model.set({ state: target.state, progress: target.progress, kind: target.kind })
    }
    return () => window.clearTimeout(after)
  }, [model, target.state, target.progress, target.kind, target.stage])

  // The draw loop (the mock's tickH1Mark): attributes only, no React render per frame.
  useEffect(() => {
    listen()
    const el = svg.current
    if (!el || typeof requestAnimationFrame !== 'function') return
    const nodes = new Map<string, Element>()
    el.querySelectorAll('[data-k]').forEach(n => nodes.set(n.getAttribute('data-k')!, n))
    const set = (k: string, a: Record<string, string | number>) => { const n = nodes.get(k); if (n) for (const [x, v] of Object.entries(a)) n.setAttribute(x, String(v)) }
    let id = 0
    let lastT = performance.now()
    let lastDraw = 0
    const tick = (now: number) => {
      id = requestAnimationFrame(tick)
      if (document.hidden) { lastT = now; return }
      const rm = reduced()
      // reduced motion: only the frames the grammar asks for (none once settled)
      if (rm) { const cap = model.fpsCap(true); if (!cap || now - lastDraw < 1000 / cap) { lastT = now; return } }
      lastDraw = now
      const dt = Math.min(0.05, (now - lastT) / 1000)
      lastT = now
      const c = model.step(dt, rm)
      const btn = el.parentElement
      const r = btn ? btn.getBoundingClientRect() : null
      const { tx, ty } = rm ? { tx: 0, ty: 0 } : pointerTarget(c.night, c.warm, r, pointer())
      const l = setLook(stepLook(look(), tx, ty, dt))
      paint(set, frameAttrs(base, accent, c, model.S.arcTail, l, rm ? 0 : now / 1000))
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [model, base, accent])

  // The first paint, before any frame: the model as it stands.
  const A = frameAttrs(base, accent, model.c, model.S.arcTail, look(), 0)
  return (
    <svg ref={svg} xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="-50 -50 100 100" style={{ display: 'block', overflow: 'visible' }}
      aria-hidden data-testid="medallion-mark" data-state={target.state}>
      <defs>
        <radialGradient id={`${uid}sphere`} cx="30%" cy="24%" r="76%" fx="26%" fy="20%">
          <stop offset="0%" stopColor={mix(base, '#FFFFFF', 0.34)} />
          <stop offset="46%" stopColor={mix(base, '#FFFFFF', 0.06)} />
          <stop offset="100%" stopColor={mix(base, '#050609', 0.52)} />
        </radialGradient>
        <linearGradient id={`${uid}fresnel`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.42" />
          <stop offset="50%" stopColor={base} stopOpacity="0" />
          <stop offset="100%" stopColor={accent} stopOpacity="0.28" />
        </linearGradient>
        <linearGradient id={`${uid}wall`} x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0%" stopColor={mix(base, '#020305', 0.76)} />
          <stop offset="55%" stopColor={mix(base, '#06070B', 0.56)} />
          <stop offset="100%" stopColor={mix(mix(base, '#06070B', 0.45), accent, 0.18)} />
        </linearGradient>
        <linearGradient id={`${uid}sky`} x1="0" y1="0" x2="0" y2="1">
          <stop data-k="sky-top" offset="0%" stopColor={A.skyTop} />
          <stop data-k="sky-bot" offset="100%" stopColor={A.skyBot} />
        </linearGradient>
        <linearGradient id={`${uid}sea`} x1="0" y1="0" x2="0" y2="1">
          <stop data-k="sea-top" offset="0%" stopColor={A.seaTop} />
          <stop offset="100%" stopColor="#040508" />
        </linearGradient>
        <filter id={`${uid}cavity`} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="-2.2" dy="2.8" stdDeviation="2.4" floodColor="#000000" floodOpacity="0.52" />
        </filter>
        <clipPath id={`${uid}cut`}><circle data-k="cut-clip" cx={A.wall.x} cy={A.wall.y} r="33" /></clipPath>
        <clipPath id={`${uid}win`}><circle data-k="win-clip" cx={A.win.x} cy={A.win.y} r="28.2" /></clipPath>
      </defs>
      <ellipse cx="1" cy="44" rx="28" ry="4.5" fill="rgba(10,12,18,0.22)" />
      <circle r="47" fill={`url(#${uid}sphere)`} stroke="rgba(255,255,255,0.14)" strokeWidth="1.1" />
      <circle r="46.4" fill="none" stroke={`url(#${uid}fresnel)`} strokeWidth="1.3" />
      <g clipPath={`url(#${uid}cut)`}>
        <circle data-k="wall-fill" cx={A.wall.x} cy={A.wall.y} r="33" fill={`url(#${uid}wall)`} />
        <circle data-k="cavity-rim-sh" cx={(A.wall.x + 2.2).toFixed(2)} cy={(A.wall.y + 2.2).toFixed(2)} r="34" fill="none" stroke="#000000" strokeWidth="5.5" strokeOpacity="0.48" />
      </g>
      <g clipPath={`url(#${uid}win)`} filter={`url(#${uid}cavity)`}>
        <rect x="-50" y="-50" width="100" height="100" fill={`url(#${uid}sky)`} />
        <path data-k="bloom" d={A.wave} fill="none" stroke={A.line} strokeWidth="10" strokeLinecap="round" opacity={A.bloomOpacity} />
        <path data-k="sea" d={A.sea} fill={`url(#${uid}sea)`} />
        <path data-k="wave" d={A.wave} fill="none" stroke={A.line} strokeWidth="4.3" strokeLinecap="round" opacity={A.waveOpacity} />
        <circle data-k="win-ao" cx={A.win.x} cy={A.win.y} r="28.5" fill="none" stroke="#020306" strokeWidth="4.2" strokeOpacity="0.42" />
      </g>
      <circle data-k="lip" cx={A.win.x} cy={A.win.y} r="28.2" fill="none" stroke={A.line} strokeWidth="1.25" strokeOpacity={A.lipOpacity} />
      <circle data-k="arc-halo" r="44.2" fill="none" stroke={A.line} strokeWidth="8.5" strokeLinecap="round" opacity={A.haloOpacity} strokeDasharray={A.dash} transform={A.rot} />
      <circle data-k="arc" r="44.2" fill="none" stroke={A.line} strokeWidth="5.2" strokeLinecap="round" opacity={A.arcOpacity} strokeDasharray={A.dash} transform={A.rot} data-testid="medallion-arc" />
    </svg>
  )
}

function paint(set: (k: string, a: Record<string, string | number>) => void, A: ReturnType<typeof frameAttrs>) {
  set('sky-top', { 'stop-color': A.skyTop })
  set('sky-bot', { 'stop-color': A.skyBot })
  set('sea-top', { 'stop-color': A.seaTop })
  set('cut-clip', { cx: A.wall.x, cy: A.wall.y })
  set('wall-fill', { cx: A.wall.x, cy: A.wall.y })
  set('cavity-rim-sh', { cx: (A.wall.x + 2.2).toFixed(2), cy: (A.wall.y + 2.2).toFixed(2) })
  set('win-clip', { cx: A.win.x, cy: A.win.y })
  set('win-ao', { cx: A.win.x, cy: A.win.y })
  set('lip', { cx: A.win.x, cy: A.win.y, stroke: A.line, 'stroke-opacity': A.lipOpacity })
  set('sea', { d: A.sea })
  set('wave', { d: A.wave, stroke: A.line, opacity: A.waveOpacity })
  set('bloom', { d: A.wave, stroke: A.line, opacity: A.bloomOpacity })
  set('arc', { stroke: A.line, opacity: A.arcOpacity, 'stroke-dasharray': A.dash, transform: A.rot })
  set('arc-halo', { stroke: A.line, opacity: A.haloOpacity, 'stroke-dasharray': A.dash, transform: A.rot })
}
