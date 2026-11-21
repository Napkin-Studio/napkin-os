// "Sending…" that lasts says what is happening (features/pt-canvas-r2.clan; UAT round 2 R2-3, UX 3: 50 s of "Sending…"
// on a 14-picture Generate, nothing said). The send uploads the pictures, then the Director (Dex) reads them and writes
// the prompt before the model is asked; with many pictures that takes up to about a minute.

import { useEffect, useState } from 'react'

/** True once `busy` has lasted `ms`; false again when it ends. */
export function useSlow(busy: boolean, ms = 3000): boolean {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!busy) return
    const t = setTimeout(() => setSlow(true), ms)
    return () => {
      clearTimeout(t)
      setSlow(false)
    }
  }, [busy, ms])
  return busy && slow
}

/** What a slow Generate is doing, for `pictures` pictures. */
export function sendingLine(pictures: number): string {
  if (pictures <= 0) return 'The Director agent is reading your words and writing the prompt…'
  const what = pictures === 1 ? 'the picture' : `${pictures} pictures`
  const long = pictures >= 8 ? ' With this many it can take up to a minute.' : ''
  return `Uploading ${what}, then the Director agent reads ${pictures === 1 ? 'it' : 'them'} and writes the prompt…${long}`
}
