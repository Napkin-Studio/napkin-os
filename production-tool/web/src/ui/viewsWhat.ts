// "3 views of @marco: 3/4, side, back" for the confirm before Make the other views (UAT round 2 R2-6).
import { viewLabel } from '../canvas/controller'
import type { NamedRef, View } from '../contracts/types'

export function viewsWhat(key: string, views: readonly View[]): string {
  const words = views.map((v) => viewLabel(v).toLowerCase()).join(', ')
  return `${views.length} ${views.length === 1 ? 'view' : 'views'} of @${key}: ${words}`
}

/** The views a picture's variant name already covers, near angles too (UAT round 3 R3-10: Make the other views offered
 *  "back" although @ruby_back-three-quarter was there). A back three-quarter covers the back; a front three-quarter the
 *  three-quarter; a profile or a left/right side covers the side; rear covers the back. */
export function viewsCovered(variant: string): View[] {
  const words = variant.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  const has = (...w: string[]) => w.some((x) => words.includes(x))
  const out = new Set<View>()
  const back = has('back', 'rear', 'behind')
  const quarter = has('quarter', 'quarters', '3q', '34', 'threequarter')
  if (has('front', 'frontal') && !quarter) out.add('front')
  // A back three-quarter is near the back, not the (front) three-quarter: it covers the back only.
  if (quarter && !back) out.add('three-quarter')
  if (has('side', 'profile', 'left', 'right') && !quarter) out.add('side')
  if (back) out.add('back')
  return [...out]
}

/** The views still to make for a key, given its pictures' variants. */
export function missingViews(refs: readonly Pick<NamedRef, 'variant'>[], wanted: readonly View[]): View[] {
  const covered = new Set(refs.flatMap((r) => viewsCovered(r.variant ?? '')))
  return wanted.filter((v) => !covered.has(v))
}
