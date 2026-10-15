// An existing project's boards, as the Ad template made them before board-autolayout (BA2 = c: a new
// project now starts on an empty canvas). Tests use it for "an existing project": seedBoards gives
// these document boards their frames, with the nodes in theirs.

import { ranksBetween } from '../../../clan-store/src'
import type { Board, BoardPurpose, ProductionDocument } from '../contracts/types'

export const AD_TEMPLATE: readonly { key: string; title: string; purpose: BoardPurpose }[] = [
  { key: 'script', title: 'Script', purpose: 'script' },
  { key: 'characters', title: 'Characters', purpose: 'character' },
  { key: 'locations', title: 'Locations', purpose: 'location' },
  { key: 'references', title: 'References', purpose: 'reference' },
  { key: 'products', title: 'Products', purpose: 'product' },
  { key: 'storyboard', title: 'Storyboard', purpose: 'storyboard' },
  { key: 'video', title: 'Video', purpose: 'video' },
]

/** The template's seven document boards, in rank order. */
export function adBoards(): Board[] {
  const ranks = ranksBetween(null, null, AD_TEMPLATE.length)
  return AD_TEMPLATE.map((t, i) => ({ id: `board_${t.key}`, v: 1, field_v: {}, title: t.title, purpose: t.purpose, rank: ranks[i] }))
}

/** Put the template's boards into a document (an existing project); returns them. */
export function withAdBoards(doc: ProductionDocument): Board[] {
  const list = adBoards()
  for (const b of list) doc.boards[b.id] = b
  return list
}
