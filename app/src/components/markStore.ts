// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The medallion's one model for the whole studio (the mock's sharedModel), where
// it looks, where the pointer is, and whether the person has engaged.

import { useSyncExternalStore } from 'react'
import { createModel, type MarkModel } from '../brand/deepO'
import type { Look, MarkTarget } from './medallionMotion'

export const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// ---------- the one model, and engagement, for the whole studio ----------
let shared: MarkModel | null = null
let look_: Look = { lx: 0, ly: 0, vx: 0, vy: 0 }
export const modelOf = (first: MarkTarget): MarkModel => {
  if (!shared) { shared = createModel({ state: first.state, progress: first.progress }); shared.snap(reduced()) }
  return shared
}

let engaged = false
const engagedSubs = new Set<() => void>()
/** The person engaged (the mock's wakeMark): from now on the mark is awake when nothing else holds it. */
export function engage(): void {
  if (engaged) return
  engaged = true
  engagedSubs.forEach(f => f())
}
/** Whether the person has engaged since the studio opened. */
export function useEngaged(): boolean {
  return useSyncExternalStore(f => { engagedSubs.add(f); return () => { engagedSubs.delete(f) } }, () => engaged, () => false)
}
/** For tests: forget the model and engagement. */
export function resetMark(): void { shared = null; look_ = { lx: 0, ly: 0, vx: 0, vy: 0 }; engaged = false }

let listening = false
let ptr_: { x: number; y: number } | null = null
export function listen() {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('pointermove', e => { ptr_ = { x: e.clientX, y: e.clientY } }, { passive: true })
  document.addEventListener('pointerleave', () => { ptr_ = null })
  // Engaging is the person's input, a click, or a key that moves focus on the desk or in the app
  // (a prompt), never on the bar; a focus the page moves by itself on load is not the person.
  const onAct = (e: Event) => { const t = e.target as Element | null; if (e.isTrusted && t && typeof t.closest === 'function' && !t.closest('[data-testid="os-bar"]')) engage() }
  for (const ev of ['input', 'click', 'keydown']) document.addEventListener(ev, onAct, true)
  // The app's own page (a prompt) is a frame: focus going into it is engaging too.
  window.addEventListener('blur', () => { setTimeout(() => { if (document.activeElement?.tagName === 'IFRAME') engage() }, 0) })
}


export const look = (): Look => look_
export const setLook = (l: Look): Look => (look_ = l)
export const pointer = () => ptr_
