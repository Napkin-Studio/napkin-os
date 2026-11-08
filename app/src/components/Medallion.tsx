// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The medallion: the approved mock's satin "H1" mark (design/new-ui/
// napkin-app-v1.html, mountH1Mark and tickH1Mark), in the agency's colours. A
// satin sphere with a window cut into it; through the window, a sky over a sea
// whose horizon line is the agency's accent. It is the way home, and the one
// mark that changes when the app the person is IN needs them (owner, 9 Nov
// 2026): then the horizon warms and rises, and a ring closes round the sphere
// with a breathing halo. Nothing else moves it: not other clients' work, not
// the desk.
//
// Awake, the horizon swells slowly (two travelling sines, as the mock); with
// reduced motion, or where there is no animation frame (a test), it is drawn
// once and holds still.

import { useEffect, useId, useRef } from 'react'
import { CIRC, medallionLook, wavePath, type MedallionState } from './medallionLook'

export type { MedallionState } from './medallionLook'

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** The mark, `size` px across, in the agency's `base` and `accent`. */
export function MedallionMark({ base, accent, state, size = 38 }: { base: string; accent: string; state: MedallionState; size?: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const L = medallionLook(base, accent, state)
  const sea = useRef<SVGPathElement>(null)
  const wave = useRef<SVGPathElement>(null)
  const bloom = useRef<SVGPathElement>(null)
  const halo = useRef<SVGCircleElement>(null)

  // The horizon's swell, and the needs halo's breath: attributes only, no React render per frame.
  useEffect(() => {
    if (typeof requestAnimationFrame !== 'function' || reduced()) return
    let id = 0
    let last = 0
    const tick = (now: number) => {
      id = requestAnimationFrame(tick)
      if (now - last < 1000 / 15) return // the mock's awake wave runs at 15 fps
      last = now
      const t = now / 1000
      sea.current?.setAttribute('d', wavePath(t, L.amp, L.yBase, true))
      const w = wavePath(t, L.amp, L.yBase, false)
      wave.current?.setAttribute('d', w)
      bloom.current?.setAttribute('d', w)
      if (L.arc) halo.current?.setAttribute('opacity', (0.44 * (1 + 0.3 * (0.5 + 0.5 * Math.sin(t * 2 * Math.PI / 3.6)))).toFixed(3))
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [L.amp, L.yBase, L.arc])

  const still = wavePath(0, L.amp, L.yBase, false)
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="-50 -50 100 100" style={{ display: 'block', overflow: 'visible' }}
      aria-hidden data-testid="medallion-mark" data-state={state}>
      <defs>
        <radialGradient id={`${uid}sphere`} cx="30%" cy="24%" r="76%" fx="26%" fy="20%">
          <stop offset="0%" stopColor={L.shellHi} />
          <stop offset="46%" stopColor={L.shellMid} />
          <stop offset="100%" stopColor={L.shellLo} />
        </radialGradient>
        <linearGradient id={`${uid}fresnel`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.42" />
          <stop offset="50%" stopColor={base} stopOpacity="0" />
          <stop offset="100%" stopColor={accent} stopOpacity="0.28" />
        </linearGradient>
        <linearGradient id={`${uid}wall`} x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0%" stopColor={L.wallTop} />
          <stop offset="55%" stopColor={L.wallMid} />
          <stop offset="100%" stopColor={L.wallBounce} />
        </linearGradient>
        <linearGradient id={`${uid}sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={L.skyTop} />
          <stop offset="100%" stopColor={L.skyBot} />
        </linearGradient>
        <linearGradient id={`${uid}sea`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={L.seaTop} />
          <stop offset="100%" stopColor="#040508" />
        </linearGradient>
        <filter id={`${uid}cavity`} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="-2.2" dy="2.8" stdDeviation="2.4" floodColor="#000000" floodOpacity="0.52" />
        </filter>
        <clipPath id={`${uid}cut`}><circle cx={L.wall.x} cy={L.wall.y} r="33" /></clipPath>
        <clipPath id={`${uid}win`}><circle cx={L.win.x} cy={L.win.y} r="28.2" /></clipPath>
      </defs>
      <ellipse cx="1" cy="44" rx="28" ry="4.5" fill="rgba(10,12,18,0.22)" />
      <circle r="47" fill={`url(#${uid}sphere)`} stroke="rgba(255,255,255,0.14)" strokeWidth="1.1" />
      <circle r="46.4" fill="none" stroke={`url(#${uid}fresnel)`} strokeWidth="1.3" />
      <g clipPath={`url(#${uid}cut)`}>
        <circle cx={L.wall.x} cy={L.wall.y} r="33" fill={`url(#${uid}wall)`} />
        <circle cx={L.wall.x + 2} cy={L.wall.y + 2} r="34" fill="none" stroke="#000000" strokeWidth="5.5" strokeOpacity="0.48" />
      </g>
      <g clipPath={`url(#${uid}win)`} filter={`url(#${uid}cavity)`}>
        <rect x="-50" y="-50" width="100" height="100" fill={`url(#${uid}sky)`} />
        <path ref={bloom} d={still} fill="none" stroke={L.line} strokeWidth="10" strokeLinecap="round" opacity="0.36" />
        <path ref={sea} d={wavePath(0, L.amp, L.yBase, true)} fill={`url(#${uid}sea)`} />
        <path ref={wave} d={still} fill="none" stroke={L.line} strokeWidth="4.3" strokeLinecap="round" />
        <circle cx={L.win.x} cy={L.win.y} r="28.5" fill="none" stroke="#020306" strokeWidth="4.2" strokeOpacity="0.42" />
      </g>
      <circle cx={L.win.x} cy={L.win.y} r="28.2" fill="none" stroke={L.line} strokeWidth="1.25" strokeOpacity="0.6" />
      {L.arc && (
        <>
          <circle ref={halo} r="44.2" fill="none" stroke={L.line} strokeWidth="8.5" strokeLinecap="round" opacity="0.44"
            strokeDasharray={`${CIRC.toFixed(1)} ${CIRC.toFixed(1)}`} transform="rotate(-90)" />
          <circle r="44.2" fill="none" stroke={L.line} strokeWidth="5.2" strokeLinecap="round"
            strokeDasharray={`${CIRC.toFixed(1)} ${CIRC.toFixed(1)}`} transform="rotate(-90)" data-testid="medallion-arc" />
        </>
      )}
    </svg>
  )
}
