// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What the Decisions drawer says, from the host's decision view (gaps.md §4):
// a call's question and where it is, the Graph's steps (sources, then each
// decision that shaped the document, oldest first), and the Lineage chain
// from /related. All derived in the shell; no route of its own.

import type { AttentionItem, DecisionBlock, DecisionsView, RelatedView } from '../../host'
import { didWhat, mainTarget, refOfAddress, sureWord, upper, whoOf, withCountry } from '../decisions/words'

const TITLE: Record<string, string> = {
  unverified_finding: 'Is this right?',
  open_contest: 'The sources disagree. Which is right?',
  flagged_field: 'This rests on a point you turned down',
  bad_verdict: 'Marked wrong, and not answered yet',
  unmerged_branch: 'Some work is not in the document yet',
  client_rejected: 'The client turned this part down',
  client_rejected_parts_unknown: 'The client turned it down. Which parts?',
}

/** A call's row: its question in bold, then the document and what kind of call it is. */
export function callWords(item: AttentionItem, docTitle: string): { title: string; sub: string } {
  const label = withCountry((item.label ?? '').replace(/^(Finding|Fact|Contest) · /, '')).trim()
  const kind = TITLE[item.code] ?? 'Needs your call'
  return label ? { title: label, sub: `${docTitle} · ${kind}` } : { title: kind, sub: `${docTitle} · ${item.text}` }
}

/** "3 open calls need your sign-off" / "1 open call needs your sign-off". */
export const callCount = (n: number): string => `${n} open call${n === 1 ? ' needs' : 's need'} your sign-off`

/** "Approve all and lock the brief" (more than one), "Approve and lock the brief" (one). */
export const approveWords = (n: number, noun: string): string => `${n > 1 ? 'Approve all' : 'Approve'} and lock the ${noun}`

export interface GraphStep {
  stage: string
  title: string
  detail: string
  badge: { text: string; tone: 'verified' | 'proposed' }
  /** The decision it is, for Show in document. */
  block?: DecisionBlock
}

const STAGE_OF = (b: DecisionBlock): string => {
  if (b.who.kind === 'person') return 'HUMAN'
  if (b.targets.some(t => t.kind === 'contest')) return 'CONTEST'
  if (typeof b.decision.was === 'string' && typeof b.decision.now === 'string') return 'REWRITE'
  if (b.decision.kind === 'finding') return 'INSIGHT'
  return (b.decision.kind ?? 'STEP').toUpperCase().replace(/_/g, ' ')
}

/**
 * How it was decided: 01 · SOURCES (what was read), then the decisions that
 * still stand, oldest first, at most `max`; each badged with what holds it
 * (needs you, or how sure the agent was).
 */
export function graphOf(view: DecisionsView, max = 6): GraphStep[] {
  const sources = Object.entries(view.cites).filter(([, c]) => c.kind === 'source' || c.kind === 'material')
  const steps: GraphStep[] = []
  if (sources.length) {
    steps.push({
      stage: '01 · SOURCES',
      title: `${sources.length} source${sources.length === 1 ? '' : 's'} read`,
      detail: sources.slice(0, 5).map(([, c]) => c.title ?? c.label).join(', '),
      badge: { text: `${sources.length} read`, tone: 'verified' },
    })
  }
  const live = view.decisions.filter(b => !b.superseded).slice(0, max).reverse()
  for (const b of live) {
    const n = String(steps.length + 1).padStart(2, '0')
    const needs = b.attention.some(a => a.blocks_lock)
    const sure = sureWord(b.decision.reasoning?.certainty?.level)
    const t = mainTarget(b)
    steps.push({
      stage: `${n} · ${STAGE_OF(b)}`,
      title: `${b.decision.id ? `${b.decision.id} · ` : ''}${upper(didWhat(b, view))}`,
      detail: (b.decision.reasoning?.decided || b.decision.rationale || '').split(/\. Because/)[0] || (t?.label ?? ''),
      badge: needs ? { text: 'Needs you', tone: 'proposed' } : { text: sure ?? (b.who.kind === 'person' ? 'Yours' : 'Done'), tone: 'verified' },
      block: b,
    })
  }
  return steps
}

/** One By-time / By-part row: what was done, by whom and when, and where it is. */
export function rowOf(b: DecisionBlock, view: DecisionsView): { what: string; who: string; ref: string | null; path?: string; tech: string } {
  const w = whoOf(b)
  const t = mainTarget(b)
  const at = new Date(b.decision.timestamp)
  const when = Number.isNaN(at.getTime()) ? '' : at.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).replace(',', '')
  return {
    what: w.person ? `${w.name} ${didWhat(b, view)}` : upper(didWhat(b, view)),
    who: [w.name, when, b.decision.id].filter(Boolean).join(' · '),
    ref: t ? refOfAddress(t.address) : null,
    ...(t?.path ? { path: t.path } : {}),
    tech: [`${b.decision.kind ?? 'edit'} · ${b.decision.action}`, b.decision.handler && `handler=${b.decision.handler}`, b.decision.targets?.length && `targets=${b.decision.targets.join(',')}`].filter(Boolean).join(' · '),
  }
}

export interface LineRow { title: string; sub: string; path?: string; here?: boolean }

/** Where it came from: what it was made from and links, this one ("You are here"), then what was made from it. */
export function lineageOf(related: RelatedView | null, here: { title: string; noun: string }): LineRow[] {
  const how: Record<string, string> = { made_from: 'what it was made from', linked: 'linked into this', made_into: 'made from this', linked_in: 'this is linked into it' }
  const row = (d: RelatedView['upstream'][number]): LineRow => ({
    title: d.title || 'Untitled',
    sub: `${upper(d.noun ?? 'document')} · ${how[d.how] ?? d.how}${d.taken ? ` · v${d.taken} kept` : ''}${d.status === 'changed' ? ' · changed since' : ''}`,
    ...(d.path ? { path: d.path } : {}),
  })
  return [
    ...(related?.upstream ?? []).map(row),
    { title: here.title, sub: `${upper(here.noun)} · this document`, here: true },
    ...(related?.downstream ?? []).map(row),
  ]
}
