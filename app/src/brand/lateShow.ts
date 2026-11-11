// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// A loading sign shows only on a slow wait: a quick one shows nothing but the
// right background. The boot screen (bootLook.ts) and the shell's loading signs
// (LogoSpinner.tsx) keep one clock: the wait starts when the page does, and a
// sign that takes over from another (the boot screen to the sign-in check to
// the shell's "Opening the studio…") carries on from where that one was, so
// the mark never vanishes and fades in again on the way to the desk.

/** How long a wait must last before its sign appears. */
export const SHOW_AFTER_MS = 400
/** How long the sign takes to fade in. */
export const SHOW_FADE_MS = 300
/** A sign that mounts this soon after the last one went is the same wait. */
export const HANDOFF_MS = 80

interface Clock { start: number; live: number; ended: number | null }
// No sign yet: the boot screen is the page's first wait, from time 0.
let clock: Clock = { start: 0, live: 0, ended: null }

/**
 * When the wait a sign mounting now belongs to began (pure: a render may call it
 * twice). It carries on the wait of a sign still up, or of one gone within
 * HANDOFF_MS; the very first sign, while the boot screen is still in the page
 * (`bootUp`), carries on the boot screen's, from 0; anything else starts now.
 */
export function waitStart(now: number, bootUp: boolean): number {
  if (clock.live > 0 || (clock.ended != null && now - clock.ended <= HANDOFF_MS)) return clock.start
  if (clock.ended == null && bootUp) return 0
  return now
}

/**
 * The sign's CSS animation-delay, in ms. It is negative once the wait has lasted
 * longer than SHOW_AFTER_MS, so the fade is already part (or all) of the way
 * through, as the sign before it was.
 */
export function lateDelay(start: number, now: number): number {
  return Math.round(SHOW_AFTER_MS - (now - start))
}

/** A sign is up (its effect ran), in the wait that began at `start`. */
export function lateBegin(start: number): void {
  clock.start = start
  clock.live += 1
  clock.ended = null
}

/** A sign is gone. */
export function lateEnd(now: number = performance.now()): void {
  clock.live = Math.max(0, clock.live - 1)
  if (clock.live === 0) clock.ended = now
}

/** For tests: the page just loaded. */
export function resetLateClock(): void {
  clock = { start: 0, live: 0, ended: null }
}
