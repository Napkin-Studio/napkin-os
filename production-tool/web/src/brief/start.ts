// "Start from a brief" (features/brief-node.clan): the data path the empty canvas's Start card and the
// brief → Production spin-off call. There is no brief screen and no brief typed here: the person picks
// one of the agency's Brief Maker briefs (link), or arrives from Brief Maker with one (spin-off), and the
// canvas gets the Brief node with a new Script linked to it.
//
// The spin-off arrives as /production/?brief=<OS document id> (the OS's Continue in names the brief, never
// its words: query parameters carry ids, app/route.ts). The page starts a project from it once and drops
// the parameter.

import type { NodeEnv } from '../canvas/nodes/nodes'
import { startFromBrief, type StartedFromBrief } from './canvas'
import { BriefReadError, type BriefSource, type OsBriefItem } from './os'

const DOC_ID = /^doc-[A-Za-z0-9._-]{1,120}$/

/** Whether the Start card offers "Start from a brief": this page can read Napkin's briefs. */
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

/** Start from the brief the person picked (or arrived with): read it now, then the node, a new Script and the link. */
export async function startFromBriefId(env: NodeEnv, src: BriefSource, documentId: string, how: 'link' | 'spinoff' = 'link'): Promise<StartedFromBrief> {
  return startFromBrief(env, await src.read(documentId), how)
}

/** The brief a spin-off from Brief Maker names (?brief=<doc id>), or null. */
export function briefSpinoffOf(search: string): string | null {
  const id = new URLSearchParams(search).get('brief')
  return id && DOC_ID.test(id) ? id : null
}

/** The page's search without the spin-off's parameter (replaced in the history once it is taken). */
export function withoutBriefSpinoff(search: string): string {
  const q = new URLSearchParams(search)
  q.delete('brief')
  const s = q.toString()
  return s ? `?${s}` : ''
}

/** Where the OS's Continue in sends a brief to start a film from it (the tool's base, '/production/'). */
export function briefSpinoffUrl(documentId: string, base = '/production/'): string {
  return `${base.endsWith('/') ? base : `${base}/`}?brief=${encodeURIComponent(documentId)}`
}
