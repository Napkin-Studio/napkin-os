// "What the X agent will send" (features/production-new-ui.clan; mock production-new-ui-v2 sendplan/sendclips): the
// small disclosure beside a paid next step in the bar. No send tray and no price: the rows say what goes with the
// job, the brief included (brief/model.ts briefSendRow: the spine of the Brief node linked into this node or
// carried down to it), and that nothing goes until the person presses the action.

import type { Id, LinkEndpoint, Op, ProductionDocument } from '../contracts/types'
import { briefSendRow } from '../brief/model'
import { brandClanOf } from '../brandClan/model'
import { brandRows } from '../jobs/context'

export interface SendRow { key: string; label: string; detail?: string }

/** The rows for an action on `nodeId`: what the action names, then the brief when there is one (the parts `op`'s
 *  director reads), then the promise. */
export function sendRows(d: ProductionDocument, nodeId: Id | undefined, what: SendRow[], action: string, op?: Op, promise?: string): SendRow[] {
  const brief = nodeId ? briefSendRow(d, nodeId, op) : undefined
  const clan = nodeId ? brandClanSendRow(d, nodeId, op) : undefined
  return [
    ...what,
    ...(brief ? [{ key: brief.key, label: brief.label, detail: brief.detail }] : []),
    ...(clan ? [clan] : []),
    { key: 'promise', label: promise ?? `Nothing goes until you press ${action}.` },
  ]
}

/** The node `id` names, as a link end. */
function endOf(d: ProductionDocument, id: Id): LinkEndpoint | undefined {
  if (d.scripts?.[id]) return { kind: 'script', id }
  if (d.storyboards?.[id]) return { kind: 'storyboard', id }
  if (d.videos?.[id]) return { kind: 'video', id }
  if (d.format_sets?.[id]) return { kind: 'format_set', id }
  return undefined
}

/** The Brand Clan a job on `nodeId` sends (A50: the job sent its rules, colours and type and the list did not say so): its
 *  name and version, what of it goes by default for `op` (jobs/context brandRows, the tray's own rows), and where it comes
 *  from. Undefined with no Brand Clan linked into the node or up the canvas, or when `op` reads no brand. */
export function brandClanSendRow(d: ProductionDocument, nodeId: Id, op?: Op): SendRow | undefined {
  const end = endOf(d, nodeId)
  const bc = end ? brandClanOf(d, nodeId) : undefined
  if (!end || !bc) return undefined
  const rows = brandRows(d, op ?? 'frame', end, {}).filter((r) => r.ref === bc.node.id && r.on)
  if (!rows.length) return undefined
  const rules = rows.filter((r) => r.kind === 'brand_rule')
  const tone = rules.some((r) => r.key === 'tone')
  const n = rules.length - (tone ? 1 : 0)
  const parts = [tone ? 'tone' : '', n ? `${n} ${n === 1 ? 'rule' : 'rules'}` : '', rows.some((r) => r.kind === 'palette') ? 'colours' : '', rows.some((r) => r.kind === 'typography') ? 'type' : ''].filter(Boolean)
  const t = bc.at
  const named = (kind: string, title: string | undefined) => (title?.trim() && title.trim().toLowerCase() !== kind.toLowerCase() ? `${kind} · ${title.trim()}` : `the ${kind}`)
  const from = bc.via === 'link' ? 'linked'
    : `from ${d.scripts?.[t] ? named('Script', d.scripts[t].title) : d.storyboards?.[t] ? named('Storyboard', d.storyboards[t].title) : d.videos?.[t] ? named('Film', d.videos[t].title) : 'upstream'}`
  return { key: `brand_clan:${bc.node.id}`, label: `Brand Clan · ${bc.node.title} v${bc.node.source.version}`, detail: [parts.join(', '), from].filter(Boolean).join(' · ') }
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
