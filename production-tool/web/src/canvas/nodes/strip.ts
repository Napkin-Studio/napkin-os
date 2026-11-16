// The Storyboard node's strip of frames (canvas/nodes/cards.tsx): at most STRIP_TILES tiles. With more shots
// than that the last tile says how many more instead of the strip quietly ending (live test 2026-11-16:
// 6 of 7 shots, no hint).

export const STRIP_TILES = 6

/** How many shots get a frame tile, and how many the last tile counts as "+N". */
export function stripOf(count: number, tiles = STRIP_TILES): { shown: number; more: number } {
  if (count <= tiles) return { shown: count, more: 0 }
  return { shown: tiles - 1, more: count - (tiles - 1) }
}
