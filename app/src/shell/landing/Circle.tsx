// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// A flat circle: a disc in the client's material, its initials, and a ring that
// says what is happening. Plain SVG, no script and no WebGL: the default and
// the fallback (no WebGL, reduced motion, reduced data). The 3D engine, when it
// lands, draws over the same markup. Always decorative: the button that holds a
// circle carries its accessible name, and state is also said in words beside it.

import { useId, useRef } from 'react'
import { materialOf } from './materials'
import type { Activity } from './model'
import { useCanvas, useOrb } from './useOrb'

interface Props {
  size: number
  material: string
  /** Up to three characters; the mark on the disc. */
  initials?: string
  activity?: Activity
  /** Dim: a tool that is not here yet. */
  dim?: boolean
  /**
   * Where this circle lives on the page, with no size in it: the 3D engine keeps the ring and its turn
   * under this key when the page draws again. Leave it out for a circle that never moves.
   */
  slot?: string
  /**
   * Ask for the 3D circle (the landing, the clients page, a client's tools). Without it the circle is the
   * plain flat SVG with no canvas: the trail's small discs, and anything that never wanted a sphere.
   */
  orb?: boolean
}

/** Below this the circle is a mark, not a sphere: always flat. */
export const MIN_3D = 60

const R = 1 // the ring
const TAU = 2 * Math.PI
/** How much of the ring each verb's arc covers. */
const ARC = { work: 0.28, think: 0.34, check: 0.5 } as const

export function Circle({ size, material, initials, activity = 'idle', dim, slot, orb }: Props) {
  const m = materialOf(material)
  const wrap = useRef<HTMLSpanElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const autoSlot = useId()
  const wants = !!orb && size >= MIN_3D
  const three = useCanvas(wants) // false on the server and without WebGL: no canvas in the page at all
  useOrb(wrap, canvas, { agent: material, activity, size, slot: slot ?? `auto:${autoSlot}`, enabled: three })
  // viewBox: the ring is r=1, the disc inside it.
  const len = TAU * R
  const svg = (
    <svg
      className="lc-cir"
      data-activity={activity}
      width={size}
      height={size}
      viewBox="-1.15 -1.15 2.3 2.3"
      aria-hidden
      style={dim && !three ? { opacity: 0.55 } : undefined}
    >
      <circle r={R} fill="none" stroke="var(--lc-ring-track)" strokeWidth={0.05} />
      {(activity === 'work' || activity === 'think' || activity === 'read' || activity === 'check') && (
        // A turning arc, one colour per verb (the app's ring tokens): work is a quarter, thinking a
        // slower third, reading two short opposed arcs, checking a long slow arc. Shape and
        // speed differ as well as colour; the words beside the circle say it too.
        <g className="lc-act">
          {activity === 'read' ? (
            [0, 180].map(a => (
              <circle key={a} r={R} fill="none" stroke={`var(--lc-ring-${activity})`} strokeWidth={0.07} strokeLinecap="round"
                strokeDasharray={`${len * 0.14} ${len}`} transform={`rotate(${a - 90})`} />
            ))
          ) : (
            <circle r={R} fill="none" stroke={`var(--lc-ring-${activity})`} strokeWidth={0.07} strokeLinecap="round"
              strokeDasharray={`${len * ARC[activity]} ${len}`} transform="rotate(-90)" />
          )}
        </g>
      )}
      {activity === 'human' && (
        <circle r={R} fill="none" stroke="var(--lc-ring-human)" strokeWidth={0.06} strokeLinecap="round" />
      )}
      {activity === 'error' && (
        // Broken, and ink: failed is not colour alone.
        <circle r={R} fill="none" stroke="var(--lc-ring-error)" strokeWidth={0.09}
          strokeDasharray={`${len * 0.2} ${len * 0.06}`} transform="rotate(-90)" />
      )}
      <circle r={0.82} fill={m.base} stroke={m.edge} strokeWidth={0.03} />
      {initials && (
        <text
          className="lc-ini"
          textAnchor="middle"
          dominantBaseline="central"
          y={0.02}
          fill={m.ink}
          fontSize={initials.length > 2 ? 0.4 : 0.5}
        >
          {initials}
        </text>
      )}
    </svg>
  )
  if (!wants) return svg
  // The svg is the flat circle and the fallback; the canvas, once the engine draws into it, is on top.
  return (
    <span
      ref={wrap}
      className={`lc-c3${dim ? ' lc-dim' : ''}`}
      data-orb-host=""
      data-orb-agent={material}
      data-orb-activity={activity}
      data-orb-size={size}
    >
      {svg}
      {three && <canvas ref={canvas} aria-hidden />}
    </span>
  )
}
