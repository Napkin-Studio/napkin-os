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

/** The first words of the action, with its @names and any aside in brackets left out: "@mira (30s, short
 *  silver hair…) steps off a green tram" is "Steps off a green tram", not "(30s" (live test 2026-11-16). */
export function titleOf(s: Pick<Shot, 'action' | 'camera'>): string {
  const plain = withoutAsides(s.action ?? '')
    // "@maya's trembling finger" keeps its name: "Maya's trembling finger", not "'s trembling finger" (UAT 2026-11-21).
    .replace(/@([a-z][a-z0-9]*)(?:_\w+)?(?=['\u2019]s\b)/gi, (_, k: string) => cap(k))
    .replace(/@\w+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  // Cut at a stop or a dash between words, never inside "1:04", "3.5" or "close-up" (UAT 2026-11-21: "At 1:04,
  // she tiptoes…" was titled "At 1").
  const words = plain.split(/[.;,:](?=\s|$)|\s[—–-]\s|—/)[0].trim()
  return words ? cap(words.length > 26 ? `${words.slice(0, 25).replace(/\s+\S*$/, '')}…` : words) : cap(cameraLabel('size', s.camera.size))
}
