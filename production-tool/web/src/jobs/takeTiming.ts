// A take's timing (features/connected-video.clan, design 4.3 rule 5 and 4.4): where each shot starts in the
// take's prompt, and each shot's window once the take has landed. Pure; shared by the take request
// (jobs/clips.ts makeTake) and its landing (handlers.ts applyRunTake).

/** The take's length and each shot's start in its prompt: whole seconds, the slack at the heads of the
 *  shots after the first (trimmed off again by their windows; never from the first, pinned, frame). */
export function takeTiming(durations: number[]): { totalS: number; starts: number[] } {
  const sum = durations.reduce((a, b) => a + b, 0)
  const totalS = Math.ceil(sum - 1e-6)
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

/** Each shot's window of a take `totalS` long: from its cut (found, else planned) to the next, the head
 *  trimmed to the shot's length (never the first shot's, which starts on the pinned frame). */
export function takeWindows(durations: number[], starts: number[], cuts: { planned_s: number; found_s: number | null }[] | undefined, totalS: number): Window[] {
  const found = starts.map((s, i) => {
    if (i === 0) return { at: 0, detected: false }
    const c = cuts?.find((x) => Math.abs(x.planned_s - s) < 0.01)
    return c?.found_s != null ? { at: c.found_s, detected: true } : { at: s, detected: false }
  })
  return durations.map((d, i) => {
    const out = i + 1 < found.length ? found[i + 1].at : totalS
    const from = found[i].at
    const inS = i === 0 ? 0 : Math.max(from, out - d)
    const by = (i === 0 ? found[1]?.detected : found[i].detected) ? 'detected' : 'prompt'
    return { in_s: round(inS), out_s: round(out), by }
  })
}
