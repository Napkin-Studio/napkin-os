// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The medallion's motion, apart from the DOM so a test can read it: the approved
// mock's tickH1Mark (design/new-ui/napkin-app-v1.html), number for number, and the
// rule for which state the mark is told (the host owns the state; the mark eases).

import type { MarkKind, MarkParams, MarkState } from '../brand/deepO'
import { mixO } from '../brand/deepO'
import { wavePath } from './medallionLook'

// ---------- which state the mark is told ----------

/** The products whose documents the mark follows: Brief, Research, Deck and Production. */
const PRODUCTS = new Set(['brief-maker', 'campaign-research', 'deck-maker', 'production', 'production-tool'])
/** A product's document (by its app_id, `ie.napkin.brief-maker` or bare): only these ever tell the mark "needs". */
export function isProductApp(appId: string | null | undefined): boolean {
  return !!appId && PRODUCTS.has(appId.slice(appId.lastIndexOf('.') + 1))
}

export interface MarkTarget { state: MarkState; progress: number; kind?: MarkKind; stage?: string | null }

export interface MarkInputs {
  /** A product's document is open (the app the person is in: isProductApp). Never on the desk, a client or a tool page. */
  inDoc: boolean
  /** That document's open calls for this person (its Decisions count). Desk counts never reach the mark. */
  needs: number
  /** That document's run, as the host tracks it. */
  run?: { state: 'idle' | 'working' | 'waiting' | 'failed' | 'done'; stage?: string; progress?: [number, number] } | null
  /** A run on that document finished while it was open, and nothing is open since. */
  finished?: boolean
  /** The person has engaged (input, focus or a click on the desk or a prompt) since the studio opened. */
  engaged: boolean
}

/** The kind of step a run's stage names, for the arc's width and turn. */
export function kindOfStage(stage: string | undefined | null): MarkKind {
  const s = (stage ?? '').toLowerCase()
  if (/check|verif|review|valid|proof|judg|lock|gate/.test(s)) return 'check'
  if (/read|extract|research|source|ingest/.test(s)) return 'read'
  if (/search|retriev|fetch|scan/.test(s)) return 'search'
  if (/write|draft|compose|report/.test(s)) return 'write'
  if (/think|identif|select|synthes|plan|reason/.test(s)) return 'think'
  if (/provider|render|image|video/.test(s)) return 'provider'
  return 'work'
}

/**
 * The mock's rules (napkin-app-v1.html: wakeMark, syncNavigation, the run's
 * headerMark.set calls): sleep until the person engages, then awake; working
 * with progress = steps done / steps during a run; needs only when the app you
 * are IN needs you; done when a run finished with nothing open.
 */
export function markTarget(i: MarkInputs): MarkTarget {
  const rest: MarkTarget = { state: i.engaged ? 'awake' : 'sleep', progress: 0 }
  if (!i.inDoc) return rest
  const run = i.run
  if (i.needs > 0 || run?.state === 'waiting') return { state: 'needs', progress: 0.85 }
  if (run?.state === 'working') {
    const p = run.progress && run.progress[1] > 0 ? Math.min(1, run.progress[0] / run.progress[1]) : 0
    return { state: 'working', progress: p, kind: kindOfStage(run.stage), stage: run.stage ?? null }
  }
  if (run?.state === 'failed') return { state: 'error', progress: 0 }
  if (i.finished) return { state: 'done', progress: 1 }
  return rest
}

// ---------- following the pointer ----------

export interface Rect { left: number; top: number; width: number; height: number }

/**
 * Where the window wants to look: toward the pointer, only while the pointer is
 * over the medallion (0.56 of its size from the centre), and only as the mark
 * wakes (`pointerWake`: nothing at night 1, all of it below night 0.3).
 */
export function pointerTarget(night: number, warm: number, rect: Rect | null, ptr: { x: number; y: number } | null): { tx: number; ty: number } {
  const restX = 10.5 * (1 - warm)
  const restY = -8.5 * (1 - warm)
  const pointerWake = Math.max(0, 1 - Math.max(0, (night - 0.3) / 0.7))
  let tx = 0, ty = 0
  if (pointerWake > 0.01 && ptr && rect) {
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const rawDx = ptr.x - cx
    const rawDy = ptr.y - cy
    const distPx = Math.hypot(rawDx, rawDy)
    const hoverRadius = Math.max(rect.width, rect.height) * 0.56
    if (distPx <= hoverRadius) {
      const dx = rawDx / hoverRadius
      const dy = rawDy / hoverRadius
      const centerPullX = -restX * 0.65
      const centerPullY = -restY * 0.65
      const travel = 11.5
      tx = (centerPullX + dx * travel) * pointerWake
      ty = (centerPullY + dy * travel) * pointerWake
    }
  }
  return { tx, ty }
}

// ---------- one frame ----------

export interface Look { lx: number; ly: number; vx: number; vy: number }

const WARM = '#EBCB9E'
const CIRC = 2 * Math.PI * 44.2

/** Every attribute the mock's tickH1Mark writes, for eased params `c`, the arc's tail and the look offset. */
export function frameAttrs(base: string, acc: string, c: MarkParams, arcTail: number, look: Look, t: number) {
  const lineC = mixO(acc, WARM, c.warm)
  const awakeSky = mixO(base, '#FFFFFF', 0.45)
  const warmSky = mixO(awakeSky, WARM, 0.35)
  const daySky = mixO(awakeSky, warmSky, c.warm)
  const nightSky = mixO(base, '#07080C', 0.62)
  const skyBot = mixO(daySky, nightSky, c.night)
  const skyTop = mixO(mixO(daySky, lineC, 0.20), mixO(base, '#040507', 0.76), c.night)
  const seaTop = mixO(mixO(base, '#090B10', 0.36), mixO(base, '#040507', 0.72), c.night)

  const waveActivity = Math.max(0, 1 - c.night * 0.92)
  const amp = 0.25 + 3.70 * waveActivity
  const yBase = 2.0 * c.night - 1.8 * (1 - c.night) - 2.2 * c.lift

  const arcAlpha = Math.min(1, c.arcOn) * c.pulse
  const arcLen = Math.max(0.1, Math.min(0.9999, c.len)) * CIRC
  const arcRot = -90 + (arcTail * 360)
  const haloAlpha = arcAlpha * (0.16 * c.halo + 0.28 * c.warm * c.halo + 0.25 * c.swell)

  const restX = 10.5 * (1 - c.warm)
  const restY = -8.5 * (1 - c.warm)
  const wallRestX = 7.5 * (1 - c.warm)
  const wallRestY = -6.5 * (1 - c.warm)
  let wx = restX + look.lx
  let wy = restY + look.ly
  const maxOffset = 14.2
  const mag = Math.hypot(wx, wy)
  if (mag > maxOffset) { wx = (wx / mag) * maxOffset; wy = (wy / mag) * maxOffset }
  const cxWall = wallRestX + look.lx * 0.62
  const cyWall = wallRestY + look.ly * 0.62

  const yb = yBase + look.ly * 0.28
  return {
    skyTop, skyBot, seaTop, line: lineC,
    wall: { x: +cxWall.toFixed(2), y: +cyWall.toFixed(2) },
    win: { x: +wx.toFixed(2), y: +wy.toFixed(2) },
    lipOpacity: (0.24 + 0.36 * (1 - c.night)).toFixed(2),
    sea: shiftedWave(t, amp, yb, look.lx * 0.45, true),
    wave: shiftedWave(t, amp, yb, look.lx * 0.45, false),
    waveOpacity: (0.55 + 0.45 * (1 - c.night)).toFixed(2),
    bloomOpacity: ((0.12 + 0.24 * (1 - c.night)) * c.breath).toFixed(2),
    arcOpacity: arcAlpha.toFixed(3),
    haloOpacity: haloAlpha.toFixed(3),
    dash: `${arcLen.toFixed(1)} ${CIRC.toFixed(1)}`,
    rot: `rotate(${arcRot.toFixed(1)})`,
  }
}

/** The mock's buildWavePath, with its sideways shift. */
export function shiftedWave(t: number, amp: number, yBase: number, xShift: number, fill: boolean): string {
  if (!xShift) return wavePath(t, amp, yBase, fill)
  const pts: string[] = []
  const steps = 18, x0 = -44, x1 = 54
  for (let i = 0; i <= steps; i++) {
    const x = x0 + (x1 - x0) * (i / steps)
    const nx = (x - xShift) / 17.5
    const y = yBase - amp * (0.70 * Math.sin(nx * 2.45 - t * 2.5) + 0.30 * Math.sin(nx * 4.20 + t * 1.8 + 1.3))
    pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`)
  }
  if (fill) pts.push(`L ${x1} 48 L ${x0} 48 Z`)
  return pts.join(' ')
}

/** The look's spring (the mock's w = 18, critically damped), one step of `dt` toward (tx, ty). */
export function stepLook(l: Look, tx: number, ty: number, dt: number): Look {
  const w = 18
  const vx = l.vx + (-w * w * (l.lx - tx) - 2 * w * l.vx) * dt
  const vy = l.vy + (-w * w * (l.ly - ty) - 2 * w * l.vy) * dt
  return { vx, vy, lx: l.lx + vx * dt, ly: l.ly + vy * dt }
}

/** A page-reported run (the bar's `mode: working`, label e.g. "Working · step 1/4") as the mark's run. */
export function pageRunOf(mode: { mode: 'ask' | 'working'; label: string } | null): MarkInputs['run'] {
  if (!mode || mode.mode !== 'working') return null
  const m = /(\d+)\s*\/\s*(\d+)/.exec(mode.label || '')
  return { state: 'working', progress: m ? [Math.max(0, Number(m[1]) - 1), Number(m[2])] : undefined }
}
