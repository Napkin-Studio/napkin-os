// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What the dial (Dial.tsx) holds, worked out from the tool table. Pure, so the
// petals and the More tools list are table-tested.

import type { ClientSummary } from './model'
import { TOOLS, toolById, type Tool } from './tools'

/** The petals, in order round the dial: four apps, then More tools. */
export const DIAL_TOOLS = ['brief', 'research', 'deck', 'prod'] as const

/** What "More tools" lists: every tool not on the dial, and every Soon tool (TOOLS order). */
export function moreTools(live: ReadonlySet<string>): Tool[] {
  return TOOLS.filter(t => !(DIAL_TOOLS as readonly string[]).includes(t.id) || !live.has(t.id))
}

/** A petal: one of the four apps, or More tools. */
export type Petal = { kind: 'tool'; tool: Tool; live: boolean } | { kind: 'more' }

export function petalsOf(live: ReadonlySet<string>): Petal[] {
  return [
    ...DIAL_TOOLS.map(id => { const tool = toolById(id)!; return { kind: 'tool' as const, tool, live: live.has(id) } }),
    { kind: 'more' as const },
  ]
}

/** What a petal says under its name: Soon, Start, or how many are open and what they are doing. */
export function petalWords(summary: ClientSummary, t: Tool, live: boolean): string {
  if (!live) return 'Soon'
  const tally = summary.perTool[t.id]
  if (!tally.open) return 'Start'
  return tally.needsYou ? `${tally.open} open · needs you` : `${tally.open} open`
}
