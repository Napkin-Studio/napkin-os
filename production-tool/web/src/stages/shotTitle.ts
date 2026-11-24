// A storyboard card's title (stages/Storyboard.tsx): the first words of its action, else its size.
import type { Shot } from '../contracts/types'
import { cameraLabel } from '../jobs/frameEdit'

const cap = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1)

/** Words with any aside in brackets left out, closed or left open at the end: "@mira (30s, short silver
 *  hair…) steps off a green tram" is "@mira steps off a green tram" (live test 2026-11-16). The Storyboard's
 *  card titles and the Make and Edit rooms' shot names both read a shot this way. */
export function withoutAsides(text: string): string {
  return text
    .replace(/\([^()]*\)/g, ' ')    // a description after a name: "(30s, short silver hair)"
    .replace(/\([^()]*$/, ' ')      // one left open at the end
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim()
}

// A stop that closes an abbreviation is no cut: "1 a.m. A dark kitchen" keeps "a.m." (UAT round 3: "1 a.m").
const ABBREVIATION = /(?:\b(?:[a-z]\.)+[a-z]|\b(?:mr|mrs|ms|dr|st))$/i

/** The words up to the first stop or dash between words, never inside "1:04", "3.5", "close-up" or "a.m."
 *  (UAT 2026-11-21: "At 1:04, she tiptoes…" was titled "At 1"). */
export function firstClause(text: string): string {
  const cut = /[.;,:](?=\s|$)|\s[—–-]\s|—/g
  for (let m = cut.exec(text); m; m = cut.exec(text)) {
    if (m[0] === '.' && ABBREVIATION.test(text.slice(0, m.index))) continue
    return text.slice(0, m.index)
  }
  return text
}

/** The first words of the action, with any aside in brackets left out and each @name read as its plain name:
 *  "@mira (30s, short silver hair…) steps off a green tram" is "Mira steps off a green…", not "(30s" (live test
 *  2026-11-16), and "Hands hold @bottle under a running tap" keeps "bottle" (UAT round 4 F20: it read "Hands hold
 *  under a…"). The name's view (_front) is left off. */
export function titleOf(s: Pick<Shot, 'action' | 'camera'>): string {
  const plain = withoutAsides(s.action ?? '')
    .replace(/@([a-z][a-z0-9]*)(?:_\w+)?/gi, (_, k: string) => k)
    .replace(/\s+/g, ' ')
    .trim()
  const words = firstClause(plain).trim()
  return words ? cap(words.length > 26 ? `${words.slice(0, 25).replace(/\s+\S*$/, '')}…` : words) : cap(cameraLabel('size', s.camera.size))
}
