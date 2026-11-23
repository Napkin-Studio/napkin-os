// A take's timing (features/connected-video.clan, design 4.3 rule 5 and 4.4): where each shot starts in the
// take's prompt, and each shot's window once the take has landed. Pure; shared by the take request
// (jobs/clips.ts makeTake) and its landing (handlers.ts applyRunTake).

/** The take's length and each shot's start in its prompt: the length the model makes (`fit`, the relay's
 *  fit_duration: the next allowed length, at least the model's minimum; whole seconds without one), the
 *  slack at the heads of the shots after the first (trimmed off again by their windows; never from the
 *  first, pinned, frame). UAT 2026-11-21: the web said ceil(sum) where the relay asked the model's 4 s. */
export function takeTiming(durations: number[], fit?: (seconds: number) => number): { totalS: number; starts: number[] } {
  const sum = durations.reduce((a, b) => a + b, 0)
  const totalS = Math.max(fit ? fit(sum) : 0, Math.ceil(sum - 1e-6))
  const extra = durations.length > 1 ? (totalS - sum) / (durations.length - 1) : 0
  const starts: number[] = []
  let t = 0
  for (const [i, d] of durations.entries()) {
    starts.push(round(t))
    t += d + (i > 0 ? extra : 0)
  }
  return { totalS, starts }
}

const round = (s: number) => Math.round(s * 1000) / 1000

export interface Window { in_s: number; out_s: number; by: 'prompt' | 'detected' }

/** Each shot's window of a take `totalS` long, the shot's own length (owner 2026-11-18: joined shots keep their
 *  storyboard windows). A cut the take really made (the job's cuts, in cut order: cut k starts shot k+1; the
 *  relay's own plan, whatever the web planned) starts its shot there and the tail is trimmed; a cut not found
 *  falls back to the plan: the shot starts where the prompt timed it and its slack is trimmed from its tail (round 4,
 *  R4-F7). UAT 2026-11-21: the take cut at 3.0 s and the window started at 3.5 s. */
export function takeWindows(durations: number[], starts: number[], cuts: { planned_s: number; found_s: number | null }[] | undefined, totalS: number): Window[] {
  const found = starts.map((s, i) => {
    if (i === 0) return { at: 0, detected: false }
    const c = cuts?.length === starts.length - 1 ? cuts[i - 1] : cuts?.find((x) => Math.abs(x.planned_s - s) < 0.01)
    const planned = c ? c.planned_s : s
    return c?.found_s != null ? { at: c.found_s, detected: true } : { at: planned, detected: false }
  })
  return durations.map((d, i) => {
    const next = i + 1 < found.length ? found[i + 1].at : totalS
    const from = found[i].at
    if (i > 0 && found[i].detected) return { in_s: round(from), out_s: round(Math.max(from + 0.04, Math.min(next, from + d))), by: 'detected' }
    // A later shot starts where the take's prompt timed it (the cut Dex wrote, "[1.5-4 s]"), its slack trimmed from the
    // tail: one source of truth for the window (UAT round 4, R4-F7: Dex timed shot 5 from 1.5 s, the window took 2.0 s).
    if (i > 0) return { in_s: round(from), out_s: round(Math.max(from + 0.04, Math.min(next, from + d))), by: 'prompt' }
    const by = found[1]?.detected ? 'detected' : 'prompt'
    return { in_s: 0, out_s: round(next), by }
  })
}
