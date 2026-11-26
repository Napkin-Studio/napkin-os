// The board in hand (UAT round 4 A19): a board just made, while its title and "What is it for?" are open, is where the
// next picture goes, though nothing is selected yet. The board layer holds it; the Picture tool reads it.

let held: string | null = null

export const boardInHand = {
  /** The board element id in hand, if any. */
  get: (): string | null => held,
  set(id: string) { held = id },
  /** Let go of `id` (only when it is still the one in hand). */
  clear(id: string) { if (held === id) held = null },
}
