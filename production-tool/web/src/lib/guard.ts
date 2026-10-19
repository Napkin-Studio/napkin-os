// Small guards for what the participant sends (features/video-stage-findings.clan).

/**
 * One run at a time: a call while the last one is still going is dropped, not queued.
 * The flag is set synchronously, before the first await, so a double click inside one
 * frame (before React re-renders the button as disabled) still sends once and pays once.
 */
export function oneAtATime() {
  let busy = false
  return {
    get busy() {
      return busy
    },
    async run<T>(fn: () => Promise<T>): Promise<T | undefined> {
      if (busy) return undefined
      busy = true
      try {
        return await fn()
      } finally {
        busy = false
      }
    },
  }
}

/**
 * The first `max` characters of `text`, counted as the relay counts them (code points),
 * so a cut never lands inside an emoji: half a surrogate pair is not valid UTF-8 and
 * the request then failed as "uncertain" (2026-10-09).
 */
export function clipText(text: string, max: number): string {
  if (text.length <= max) return text
  const points = Array.from(text)
  return points.length <= max ? text : points.slice(0, max).join('')
}
