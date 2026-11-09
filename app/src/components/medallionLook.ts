// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The medallion's numbers (components/Medallion.tsx), apart so a test can read
// them with no DOM: the approved mock's mountH1Mark/tickH1Mark colours and
// geometry, eased fully to each state.

/** What the medallion says: at rest, or the app you are in needs you. */
export type MedallionState = 'awake' | 'needs'

/** #rrggbb `a` mixed toward `b` by `t` (0 = a, 1 = b), as the mock's DeepO.mix. */
export function mix(a: string, b: string, t: number): string {
  const p = (h: string) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(h.trim())
    return m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)) : [0, 0, 0]
  }
  const ca = p(a), cb = p(b)
  return '#' + ca.map((v, i) => Math.round(v + (cb[i] - v) * t).toString(16).padStart(2, '0')).join('')
}

/** The mock's horizon: a wave across the window, filled down to the sea when `fill`. */
export function wavePath(t: number, amp: number, yBase: number, fill: boolean): string {
  const pts: string[] = []
  const steps = 18
  const x0 = -44, x1 = 54
  for (let i = 0; i <= steps; i++) {
    const x = x0 + (x1 - x0) * (i / steps)
    const nx = x / 17.5
    const y = yBase - amp * (0.7 * Math.sin(nx * 2.45 - t * 2.5) + 0.3 * Math.sin(nx * 4.2 + t * 1.8 + 1.3))
    pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`)
  }
  if (fill) pts.push(`L ${x1} 48 L ${x0} 48 Z`)
  return pts.join(' ')
}

const WARM = '#EBCB9E'
/** The ring's length, round the sphere. */
export const CIRC = 2 * Math.PI * 44.2

/** Every colour and position of the mark for a state: the mock's numbers, eased fully to the state. */
export function medallionLook(base: string, acc: string, state: MedallionState) {
  const warm = state === 'needs' ? 1 : 0
  const line = mix(acc, WARM, warm)
  const awakeSky = mix(base, '#FFFFFF', 0.45)
  const sky = mix(awakeSky, mix(awakeSky, WARM, 0.35), warm)
  return {
    shellHi: mix(base, '#FFFFFF', 0.34),
    shellMid: mix(base, '#FFFFFF', 0.06),
    shellLo: mix(base, '#050609', 0.52),
    wallTop: mix(base, '#020305', 0.76),
    wallMid: mix(base, '#06070B', 0.56),
    wallBounce: mix(mix(base, '#06070B', 0.45), acc, 0.18),
    skyTop: mix(sky, line, 0.2),
    skyBot: sky,
    seaTop: mix(base, '#090B10', 0.36),
    line,
    // the window faces up and right at rest, and turns to face you when it needs you
    win: { x: 10.5 * (1 - warm), y: -8.5 * (1 - warm) || 0 },
    wall: { x: 7.5 * (1 - warm), y: -6.5 * (1 - warm) || 0 },
    // the horizon rises when it needs you; the wave is the sign it is awake
    yBase: state === 'needs' ? -1.8 - 2.2 * 0.26 : -1.8,
    amp: state === 'needs' ? 0.6 : 3.95,
    arc: state === 'needs',
  }
}

