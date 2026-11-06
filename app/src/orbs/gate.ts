// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The press gate. With 3D circles a press must be SEEN before the page moves on:
// the circle squishes and ripples, and the click that opens the next screen
// follows about 250 ms after the press (at least 100 ms after a release, so a
// drag to play with the circle is still play). A person who presses, drags and
// releases (on the circle or anywhere) gets the same, at release.
//
// Never in the way: Enter and Space (a click with no pointer, detail 0) go
// straight on and only kick the ripple; flat circles, no WebGL and reduced
// motion get the plain click with no delay at all.
//
// `PressGate` is the state machine with its clock given to it, so it is tested
// without a browser; `installPressGate` is the thin DOM wiring.

import type { Orbs } from './engine'

export const GATE_MS = 250
export const GATE_MIN_AFTER_RELEASE_MS = 100

export interface GateClock {
  now(): number
  later(fn: () => void, ms: number): unknown
  cancel(id: unknown): void
}

export interface GateTarget {
  /** Still on the page and still pressable. */
  ok(): boolean
  /** The press: squish and ripple. */
  press(x: number, y: number): void
  /** Deliver the click. */
  click(): void
  /** Enter or Space: the ripple only. */
  kick(): void
}

interface Held { target: GateTarget; t0: number; id: number; view: string }

export class PressGate {
  private held: Held | null = null
  private pend: unknown = null
  private synth = false
  private took = false
  private clock: GateClock
  private active: () => boolean
  private view: () => string
  constructor(clock: GateClock, active: () => boolean, view: () => string) {
    this.clock = clock; this.active = active; this.view = view
  }

  /** A primary press on a circle's button. Returns true when the gate took it. */
  down(target: GateTarget | null, e: { button: number; isPrimary: boolean; pointerId: number; clientX: number; clientY: number }): boolean {
    if (e.button || !e.isPrimary || !this.active() || this.pend != null || !target) return false
    this.held = { target, t0: this.clock.now(), id: e.pointerId, view: this.view() }
    this.took = true
    target.press(e.clientX, e.clientY)
    return true
  }

  /** The release, anywhere: the click goes on after the ripple has started. */
  up(e: { pointerId: number }): void {
    const g = this.held
    if (!g || e.pointerId !== g.id) return
    this.held = null
    if (this.pend != null) return
    const wait = Math.max(g.t0 + GATE_MS, this.clock.now() + GATE_MIN_AFTER_RELEASE_MS) - this.clock.now()
    this.pend = this.clock.later(() => {
      this.pend = null
      if (!g.target.ok() || this.view() !== g.view || !this.active()) return
      this.synth = true
      try { g.target.click() } finally { this.synth = false }
    }, wait)
  }

  /** A touch that became a scroll is not a tap. */
  cancel(): void { this.held = null; this.took = false }

  /** The place changed under a waiting click: drop it. */
  reset(): void { if (this.pend != null) this.clock.cancel(this.pend); this.pend = null; this.held = null; this.took = false }

  /**
   * A click event. Returns 'pass' (let it through), 'own' (the gate owns pointer clicks: swallow it) or
   * 'kick' (keyboard: ripple, and let it through).
   */
  click(detail: number, target: GateTarget | null): 'pass' | 'own' | 'kick' {
    if (this.synth || !this.active() || !target) return 'pass'
    if (detail > 0) { if (!this.took) return 'pass'; this.took = false; return 'own' }
    target.kick()
    return 'kick'
  }

  get waiting(): boolean { return this.pend != null }
}

const hostOf = (btn: Element): HTMLElement | null => btn.querySelector<HTMLElement>('[data-orb="on"]')

/** Wire the gate to the document for the buttons that hold a live 3D circle under `root`. */
export function installPressGate(root: HTMLElement, orbs: Orbs, view: () => string): () => void {
  const reduced = () => { try { return orbs.isReduced() } catch { return false } }
  const gate = new PressGate(
    { now: () => performance.now(), later: (f, ms) => setTimeout(f, ms), cancel: id => clearTimeout(id as ReturnType<typeof setTimeout>) },
    () => orbs.ok() && !reduced(),
    view,
  )
  const buttonOf = (t: EventTarget | null): HTMLElement | null => {
    const el = t instanceof Element ? t.closest<HTMLElement>('button') : null
    return el && root.contains(el) && hostOf(el) ? el : null
  }
  const targetOf = (btn: HTMLElement | null): GateTarget | null => btn && {
    ok: () => btn.isConnected,
    press: (x, y) => { orbs.press(hostOf(btn), x, y) },
    click: () => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, detail: 1 })) },
    kick: () => { orbs.kick(hostOf(btn)) },
  }
  const onDown = (e: PointerEvent) => { gate.down(targetOf(buttonOf(e.target)), e) }
  const onUp = (e: PointerEvent) => gate.up(e)
  const onCancel = () => gate.cancel()
  const onClick = (e: MouseEvent) => {
    const v = gate.click(e.detail, targetOf(buttonOf(e.target)))
    if (v === 'own') { e.stopPropagation(); e.preventDefault() }
  }
  const onHash = () => gate.reset()
  document.addEventListener('pointerdown', onDown, true)
  window.addEventListener('pointerup', onUp, true)
  window.addEventListener('pointercancel', onCancel, true)
  document.addEventListener('click', onClick, true)
  window.addEventListener('hashchange', onHash)
  return () => {
    gate.reset()
    document.removeEventListener('pointerdown', onDown, true)
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('pointercancel', onCancel, true)
    document.removeEventListener('click', onClick, true)
    window.removeEventListener('hashchange', onHash)
  }
}
