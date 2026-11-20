// "3 views of @marco: 3/4, side, back" for the confirm before Make the other views (UAT round 2 R2-6).
import { viewLabel } from '../canvas/controller'
import type { View } from '../contracts/types'

export function viewsWhat(key: string, views: readonly View[]): string {
  const words = views.map((v) => viewLabel(v).toLowerCase()).join(', ')
  return `${views.length} ${views.length === 1 ? 'view' : 'views'} of @${key}: ${words}`
}
