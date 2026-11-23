// Napkin's briefs here (features/brief-node.clan): the list Assets › From Napkin shows, and the brief a project is
// born with. There is no brief screen and no brief typed here: the person links one of the agency's Brief Maker
// briefs from Assets › From Napkin, or continues in Production from Brief Maker, and the canvas gets its Brief
// node, alone (owner 2026-11-18: a blank canvas asks nothing).
//
// Continue in › Production is a spin-off (features/production-spinoff.clan): the OS writes the project with the
// brief carried whole under data.upstream.<brief id>, and the project's manifest says which brief that is
// (lineage.carried). The page makes the Brief node from that carried brief, never reading the OS for it.

import type { NodeEnv } from '../canvas/nodes/nodes'
import type { SpunOffFrom } from '../../../clan-store/src'
import { bringBrief } from './canvas'
import { briefFromDocument } from './model'
import { BriefReadError, type BriefSource, type OsBriefItem, type OsBriefRead } from './os'
import { BRIEF_APP_ID } from './spine'

/** Whether Assets › From Napkin lists briefs: this page can read Napkin's briefs. */
export async function offersStartFromBrief(src: BriefSource): Promise<boolean> {
  return src.available()
}

/** The briefs the picker lists, newest first; the words to show when there are none or they cannot be read. */
export async function briefChoices(src: BriefSource): Promise<{ items: OsBriefItem[]; empty?: string }> {
  try {
    const items = (await src.list()).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    return items.length ? { items } : { items, empty: 'No briefs yet. Write one in Brief Maker, then start from it here.' }
  } catch (e) {
    return { items: [], empty: e instanceof BriefReadError ? e.message : 'Napkin’s briefs could not be read just now.' }
  }
}

/** The brief a project was spun off from, as the OS would have read it: from what the project carries. Null when the
 *  carried data holds no brief under the parent's id (a project made some other way). */
export function carriedBrief(from: SpunOffFrom, upstream: Record<string, Record<string, unknown>> | undefined): OsBriefRead | null {
  const data = upstream?.[from.document_id]
  if (!data || typeof data !== 'object') return null
  return { documentId: from.document_id, title: from.title.trim() || 'Brief', appId: BRIEF_APP_ID, dataSha256: from.data_sha256, version: from.version, data }
}

/** Bring the brief this project was born with: its Brief node alone (brief/canvas.ts bringBrief), made from the carried
 *  brief. Once: a project that has a Brief node for it already is left as it is. Null when there is nothing to bring. */
export async function bringCarriedBrief(env: NodeEnv, from: SpunOffFrom | null): Promise<Awaited<ReturnType<typeof bringBrief>> | null> {
  if (!from) return null
  const doc = env.doc.get()
  if (briefFromDocument(doc, from.document_id)) return null
  const read = carriedBrief(from, doc.upstream)
  return read ? bringBrief(env, read, 'spinoff') : null
}
