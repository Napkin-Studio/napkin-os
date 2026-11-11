// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Deep O's state grammar: a port of design/new-ui/identity-v4/mark/deep-o-grammar.js
// (round 4), the one copy the approved mock (napkin-app-v1.html) drives its bar mark
// with. Same states, timings, easing, breath and fps caps; change a number there and
// change it here.
//
// Contract: the HOST owns the state. The model never changes state by itself; it only
// eases toward what it was told.
//   model.set({ state, agent, progress, kind })   progress = steps done / steps
//   model.handoff(toAgent)                        hold 1.5 s + glide 2.4 s = 3.9 s
//   model.step(dt, reducedMotion)                 eased numbers for the drawing
//   model.fpsCap(reducedMotion)                   frames per second this moment needs (0 = none)

export type MarkState = 'sleep' | 'awake' | 'working' | 'handoff' | 'done' | 'needs' | 'error'
export type MarkKind = 'write' | 'think' | 'search' | 'read' | 'provider' | 'check' | 'queue' | 'work'

const TAU = Math.PI * 2
export const TIMING = { hold: 1.5, glide: 2.4, swell: 1.2 }
const L_MIN = 0

interface Targets { key: number; glow: number; night: number; sat: number; lift: number; warm: number; arcOn: number; fx: number; fy: number; hw: number; wave: number }
export const STATES: Record<MarkState, Targets> = {
  sleep:   { key: .34, glow: .16, night: 1,   sat: 1,   lift: -.10, warm: 0, arcOn: 0, fx: -.03,  fy: -.05,  hw: .050, wave: 0 },
  awake:   { key: 1,   glow: .62, night: 0,   sat: 1,   lift: 0,    warm: 0, arcOn: 0, fx: 0,     fy: 0,     hw: .050, wave: 1 },
  working: { key: 1,   glow: 1.1, night: 0,   sat: 1,   lift: .03,  warm: 0, arcOn: 1, fx: 0,     fy: 0,     hw: .062, wave: 0 },
  handoff: { key: 1,   glow: 1.0, night: 0,   sat: 1,   lift: .03,  warm: 0, arcOn: 1, fx: 0,     fy: 0,     hw: .062, wave: 0 },
  done:    { key: 1,   glow: 1.05, night: 0,  sat: 1,   lift: .05,  warm: 0, arcOn: 1, fx: 0,     fy: 0,     hw: .062, wave: 0 },
  needs:   { key: 1,   glow: .85, night: 0,   sat: 1,   lift: .26,  warm: 1, arcOn: 1, fx: -.045, fy: -.035, hw: .054, wave: 0 },
  error:   { key: .78, glow: .10, night: .35, sat: .08, lift: -.05, warm: 0, arcOn: 1, fx: 0,     fy: 0,     hw: .050, wave: 0 },
}
export const LABEL: Record<MarkState, string> = { sleep: 'Sleeping', awake: 'Awake', working: 'Working', handoff: 'Handoff', done: 'Done', needs: 'Needs you', error: 'Error' }
const KIND: Record<MarkKind, [number, number]> = { write: [1, .55], think: [.85, .30], search: [1, .75], read: [.8, .40], provider: [1.2, .36], check: [1, .80], queue: [.8, .12], work: [1, .45] }
const BREATH: Partial<Record<MarkState, [number, number, number]>> = { awake: [.04, 6, 15], sleep: [.06, 9, 4], needs: [.05, 3.6, 10] }
const NEEDS_HALO = .30
const PLAN_KINDS: Record<string, MarkKind[]> = { Brief: ['read', 'think', 'write', 'check'], Research: ['think', 'search', 'read', 'write', 'check'], Strategy: ['read', 'think', 'write', 'check'],
  Copy: ['read', 'write', 'check', 'write'], Image: ['read', 'think', 'provider', 'check'], Deck: ['read', 'think', 'write', 'check'] }

export function targetLen(state: MarkState, progress: number): number {
  if (state === 'working' || state === 'needs' || state === 'error') return Math.max(L_MIN, progress)
  if (state === 'handoff') return L_MIN
  if (state === 'done') return 1
  return L_MIN
}
const ease = (x: number) => .5 - .5 * Math.cos(Math.PI * Math.min(Math.max(x, 0), 1))

export type MarkParams = Targets & { len: number; kw: number; ks: number; swell: number; breath: number; sheen: number; pulse: number; halo: number; waveAmt: number }
export interface MarkModelState {
  state: MarkState; agent: string; progress: number; kind: MarkKind; handTo?: string
  t: number; hoT: number; doneT: number; arcTail: number; hoBase: number; sweep: number; drift: number; settleT: number
  bAmt: number; bAe: number; ph: number; bPer?: number; hoLift0: number; swell0: number
}
export interface MarkModel {
  S: MarkModelState
  c: MarkParams
  set(o: { state?: MarkState; agent?: string; progress?: number; kind?: MarkKind }): void
  handoff(to: string): void
  snap(rm: boolean): void
  step(dt: number, rm: boolean): MarkParams
  fpsCap(rm: boolean): number
  settling(): boolean
}

export function createModel(init: { state?: MarkState; agent?: string; progress?: number } = {}): MarkModel {
  const S: MarkModelState = { state: init.state || 'awake', agent: init.agent || 'Brief', progress: init.progress || 0, kind: 'work',
    t: 0, hoT: -1, doneT: -1, arcTail: 0, hoBase: 0, sweep: -3, drift: -.6, settleT: 0, bAmt: 0, bAe: 0, ph: 0, hoLift0: 0, swell0: 0 }
  const c: MarkParams = { ...STATES[S.state], len: targetLen(S.state, S.progress), kw: 1, ks: .45, swell: 0, breath: 1, sheen: 0, pulse: 1, halo: 1, waveAmt: 0 }
  const kindOf = (): MarkKind => { const p = PLAN_KINDS[S.agent] || PLAN_KINDS.Brief; return p[Math.min(p.length - 1, Math.floor(S.progress * p.length + 1e-6))] }
  const keys = Object.keys(STATES.awake) as (keyof Targets)[]
  const model: MarkModel = {
    S, c,
    set(o = {}) {
      if (o.agent) S.agent = o.agent
      if (o.progress != null) S.progress = Math.max(0, Math.min(1, o.progress))
      if (o.state && o.state !== S.state) {
        S.state = o.state
        if (o.state === 'done') { S.doneT = 0; S.swell0 = c.swell }
        if (o.state === 'handoff') { S.hoT = 0; S.hoBase = S.arcTail; S.hoLift0 = c.lift }
      }
      S.kind = o.kind || kindOf(); S.settleT = 0
    },
    handoff(to) { S.handTo = to; S.progress = 0; this.set({ state: 'handoff' }); S.hoT = 0; S.hoBase = S.arcTail; S.hoLift0 = c.lift },
    snap(rm) {
      Object.assign(c, STATES[S.state]); const B = BREATH[S.state]
      S.bAmt = B && !rm ? 1 : 0; S.bAe = B ? B[0] : 0; c.halo = 1; c.waveAmt = c.wave * S.bAmt; c.len = targetLen(S.state, S.progress)
      c.swell = S.state === 'done' ? .15 : 0; S.sweep = -3
      if (S.state === 'handoff') { S.hoT = TIMING.hold + TIMING.glide; S.hoLift0 = c.lift }
      S.settleT = 9
    },
    step(dt, rm) {
      S.t += dt; S.settleT += dt
      const T = STATES[S.state], kE = rm ? 1 - Math.exp(-dt * 9) : 1 - Math.exp(-dt * (S.state === 'sleep' ? 1.1 : 3.2))
      for (const k of keys) c[k] += (T[k] - c[k]) * kE
      const kd = KIND[S.kind] || KIND.work; c.kw += (kd[0] - c.kw) * (1 - Math.exp(-6 * dt)); c.ks += (kd[1] - c.ks) * (1 - Math.exp(-6 * dt))
      const tl = targetLen(S.state, S.progress)
      if (S.state !== 'handoff') c.len += (tl - c.len) * (rm ? 1 : 1 - Math.exp(-dt * 3))
      if (S.state === 'handoff') {
        S.hoT += dt
        const sink = ease(S.hoT / TIMING.hold), g = ease((S.hoT - TIMING.hold) / TIMING.glide)
        if (S.hoT < TIMING.hold) c.len += (1 - c.len) * (rm ? 1 : 1 - Math.exp(-dt * 6)); else c.len = rm ? (g < .5 ? 1 : 0) : 1 - g
        c.lift = S.hoLift0 + (.03 - S.hoLift0) * ease(S.hoT / .5) - .30 * sink * (1 - g)
        if (!rm) { S.arcTail = S.hoBase + g; S.sweep = -2.4 + 4.8 * g }
      } else {
        if (!rm && S.state === 'working') S.arcTail += dt * c.ks / TAU * c.arcOn
        S.sweep += (-3 - S.sweep) * (1 - Math.exp(-2 * dt))
      }
      if (!rm && S.state === 'working') S.drift = -.9 + 1.8 * (.5 - .5 * Math.cos(S.t * .21))
      if (S.state === 'done') { S.doneT += dt; const u = Math.min(1, S.doneT / TIMING.swell); c.swell = rm ? .15 : S.swell0 + (.15 - S.swell0) * ease(u) + .85 * Math.sin(Math.PI * u) }
      else c.swell += (0 - c.swell) * kE
      const B = BREATH[S.state], want = B && !rm ? 1 : 0
      S.bAmt += (want - S.bAmt) * (1 - Math.exp(-dt * 1.5))
      S.bAe += ((B ? B[0] : 0) - S.bAe) * (1 - Math.exp(-dt * 1.5))
      if (B) S.bPer = B[1]
      S.ph += dt * TAU / (S.bPer || 6)
      const ph = Math.sin(S.ph)
      c.breath = 1 + S.bAe * ph * S.bAmt
      c.pulse = 1 - (1 - c.pulse) * (1 - kE)
      const hw = S.state === 'needs' ? 1 + NEEDS_HALO * (.5 + .5 * ph) * S.bAmt : 1
      c.halo += (hw - c.halo) * kE
      c.sheen = .05 * Math.sin(S.t * TAU / 11) * S.bAmt * (S.state === 'awake' ? 1 : .5)
      c.waveAmt = c.wave * S.bAmt
      return c
    },
    fpsCap(rm) {
      const s = S.state
      if (s === 'handoff' && S.hoT < TIMING.hold + TIMING.glide + .4) return rm ? 15 : (S.hoT > TIMING.hold ? 60 : 30)
      if (s === 'working') return rm ? (this.settling() ? 15 : 0) : 30
      if (s === 'done' && S.doneT < TIMING.swell + .3 && !rm) return 30
      if (this.settling()) return rm ? 15 : (s === 'sleep' ? 15 : 30)
      if (rm) return 0
      const B = BREATH[s]; return B ? B[2] : 0
    },
    settling() {
      const T = STATES[S.state]; let d = Math.abs(targetLen(S.state, S.progress) - c.len) + (S.sweep > -2.9 ? 1 : 0)
      for (const k of keys) d += Math.abs(T[k] - c[k])
      if (S.state === 'handoff') return false
      if (d < .03 && S.sweep <= -2.9) { for (const k of keys) c[k] = T[k]; c.len = targetLen(S.state, S.progress); return false }
      return true
    },
  }
  return model
}

// colour helpers, as the grammar's
const rgb = (h: string) => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255] }
const hex = (a: number[]) => '#' + a.map(x => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('')
/** `a` toward `b` by `t`, as DeepO.mix. */
export const mixO = (a: string, b: string, t: number): string => { const A = rgb(a), B = rgb(b); return hex(A.map((x, i) => x + (B[i] - x) * t)) }
