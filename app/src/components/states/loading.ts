// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// When a wait shows what (v2 section 8: respond within 100 ms; loads over 300 ms
// show grey rectangles in the final layout; no spinner for anything under a second).

/** What a wait looks like after `ms`: nothing, grey rectangles, then the mark. */
export type LoadingPhase = 'quiet' | 'rects' | 'spinner'
export const RECTS_AFTER_MS = 300
export const SPINNER_AFTER_MS = 1000

export function loadingPhase(ms: number): LoadingPhase {
  return ms >= SPINNER_AFTER_MS ? 'spinner' : ms >= RECTS_AFTER_MS ? 'rects' : 'quiet'
}
