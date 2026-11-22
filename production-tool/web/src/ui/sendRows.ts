// "What the X agent will send" (features/production-new-ui.clan; mock production-new-ui-v2 sendplan/sendclips): the
// small disclosure beside a paid next step in the bar. No send tray and no price: the rows say what goes with the
// job, the brief included (brief/model.ts briefSendRow: the spine of the Brief node linked into this node or
// carried down to it), and that nothing goes until the person presses the action.

import type { Id, Op, ProductionDocument } from '../contracts/types'
import { briefSendRow } from '../brief/model'

export interface SendRow { key: string; label: string; detail?: string }

/** The rows for an action on `nodeId`: what the action names, then the brief when there is one (the parts `op`'s
 *  director reads), then the promise. */
export function sendRows(d: ProductionDocument, nodeId: Id | undefined, what: SendRow[], action: string, op?: Op, promise?: string): SendRow[] {
  const brief = nodeId ? briefSendRow(d, nodeId, op) : undefined
  return [
    ...what,
    ...(brief ? [{ key: brief.key, label: brief.label, detail: brief.detail }] : []),
    { key: 'promise', label: promise ?? `Nothing goes until you press ${action}.` },
  ]
}

/** What goes with Make clips on a storyboard: the drawn frames (an end card is typeset in the render, never drawn,
 *  so it is no frame: jobs/frames.ts needsFrame), and that Make clips opens the Film room, where each box is made
 *  on its own Make (UAT round 3, R3-F10: "6 frames" for 5 and a type end card; "Nothing goes until you press Make
 *  clips" when Make clips sends nothing). */
export function makeClipsRows(frames: number, endCards: number, named: number): { what: SendRow[]; promise: string } {
  return {
    what: [
      { key: 'frames', label: `${frames} ${frames === 1 ? 'frame' : 'frames'}, their words and camera`, ...(endCards ? { detail: endCards === 1 ? 'the end card is typeset from its words, no clip' : 'the end cards are typeset from their words, no clips' } : {}) },
      { key: 'refs', label: `${named} named ${named === 1 ? 'picture' : 'pictures'}` },
    ],
    promise: 'Make clips opens the Film room. Nothing goes until you press Make on a box there.',
  }
}
