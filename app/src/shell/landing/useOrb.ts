// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Gives a circle's markup the 3D look when the shared engine can. The circle is
// React's: the engine only draws into the canvas it is handed, and never moves
// a node. Flat stays when it cannot (no WebGL, reduced data, an unknown
// material, too many circles, "Flat circles").

import { useEffect, useRef, useSyncExternalStore, type RefObject } from 'react'
import { shared, type OrbActivity, type OrbHandle } from '../../orbs/engine'

export interface OrbArgs {
  /** A material name. */
  agent: string
  activity: OrbActivity
  size: number
  slot: string
  enabled: boolean
}

/**
 * Whether this circle should have a canvas at all: only when the engine can draw (WebGL is up) and the
 * circle asked for 3D. On the server, and in a browser with no WebGL, a circle is just its flat svg.
 */
export function useCanvas(wanted: boolean): boolean {
  return useSyncExternalStore(f => shared().onChange(f), () => wanted && shared().canDraw(), () => false)
}

export function useOrb(wrap: RefObject<HTMLElement | null>, canvas: RefObject<HTMLCanvasElement | null>, a: OrbArgs): void {
  const handle = useRef<OrbHandle | null>(null)
  const latest = useRef(a)
  useEffect(() => { latest.current = a })
  // Attach on mount and when the circle's place changes; detach on the way out.
  useEffect(() => {
    const w = wrap.current, c = canvas.current
    if (!a.enabled || !w || !c) return
    const now = latest.current
    handle.current = shared().attach({ wrap: w, canvas: c }, { agent: now.agent, activity: now.activity, size: now.size, slot: now.slot })
    return () => { handle.current?.detach(); handle.current = null }
  }, [wrap, canvas, a.enabled, a.slot])
  // A change of who or what is said to the engine; the ring eases to it.
  useEffect(() => {
    handle.current?.update({ agent: a.agent, activity: a.activity, size: a.size, slot: a.slot })
  }, [a.agent, a.activity, a.size, a.slot])
}
