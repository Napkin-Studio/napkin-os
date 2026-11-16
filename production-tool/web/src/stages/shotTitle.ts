// A storyboard card's title (stages/Storyboard.tsx): the first words of its action, else its size.
import type { Shot } from '../contracts/types'
import { cameraLabel } from '../jobs/frameEdit'

const cap = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1)

/** The first words of the action, with its @names and any aside in brackets left out: "@mira (30s, short
 *  silver hair…) steps off a green tram" is "Steps off a green tram", not "(30s" (live test 2026-11-16). */
export function titleOf(s: Pick<Shot, 'action' | 'camera'>): string {
  const plain = (s.action ?? '')
    .replace(/\([^()]*\)/g, ' ')    // a description after a name: "(30s, short silver hair)"
    .replace(/\([^()]*$/, ' ')      // one left open at the end
    .replace(/@\w+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const words = plain.split(/[.;,:—-]/)[0].trim()
  return words ? cap(words.length > 26 ? `${words.slice(0, 25).replace(/\s+\S*$/, '')}…` : words) : cap(cameraLabel('size', s.camera.size))
}
