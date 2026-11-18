// The Storyboard node's strip of frames (canvas/nodes/cards.tsx): at most STRIP_TILES tiles. With more shots
// than that the last tile says how many more instead of the strip quietly ending (live test 2026-11-16:
// 6 of 7 shots, no hint).

export const STRIP_TILES = 6

/** How many shots get a frame tile, and how many the last tile counts as "+N". */
export function stripOf(count: number, tiles = STRIP_TILES): { shown: number; more: number } {
  if (count <= tiles) return { shown: count, more: 0 }
  return { shown: tiles - 1, more: count - (tiles - 1) }
}

/** The Storyboard node's line under its strip: how many shots Dex planned, counting his own (a shot he wrote
 *  keeps last_writer 'dex'; one added by hand has none, one a person rewrote is theirs). "Dex planned 7 shots"
 *  read wrong when 3 of them were added by hand in the Make room (live test 2026-11-16). */
export function plannedLine(shots: readonly { last_writer?: unknown }[]): string {
  const dex = shots.filter((s) => s.last_writer === 'dex').length
  const n = shots.length
  const many = (k: number) => `${k} ${k === 1 ? 'shot' : 'shots'}`
  if (!dex) return many(n)
  return dex === n ? `The Director agent planned ${many(n)} from the script` : `The Director agent planned ${dex} of the ${many(n)} from the script`
}
