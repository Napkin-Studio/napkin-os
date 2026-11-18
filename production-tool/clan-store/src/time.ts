// The note window (ui-behaviour 3.13), the twin of relay/time_rules.py; both
// pass contracts/examples/windows.json.
//
// A note at shot time t gets [floor(t) - 1, ceil(t) + 1] in whole seconds
// (Aleph 2 on Runway takes whole-second ranges), clamped to the shot, never
// under 2 s, never across a cut: near either end it shifts inward rather than
// shrinking. A shot too short to hold 2 whole seconds has no window.

export const MIN_WINDOW_S = 2

export interface NoteWindow { from_s: number; to_s: number }

export function noteWindow(t: number, shotS: number): NoteWindow | null {
  const end = Math.floor(shotS + 1e-9)
  if (end < MIN_WINDOW_S || t < 0 || t > shotS) return null
  let lo = Math.floor(t) - 1
  let hi = Math.ceil(t) + 1
  if (lo < 0) {
    hi -= lo
    lo = 0
  }
  if (hi > end) {
    lo -= hi - end
    hi = end
  }
  return { from_s: Math.max(lo, 0), to_s: hi }
}

/** Why a stored window breaks the rule, or null. */
export function windowProblem(w: NoteWindow, shotS: number): string | null {
  if (w.to_s - w.from_s < MIN_WINDOW_S) return `the window is ${w.to_s - w.from_s} s; a fix needs at least ${MIN_WINDOW_S} s`
  if (w.from_s < 0 || w.to_s > shotS + 1e-9) return `the window ${w.from_s}-${w.to_s} s crosses a cut (the shot is ${shotS} s)`
  return null
}
