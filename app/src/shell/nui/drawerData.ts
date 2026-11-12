// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What the Decisions drawer says, from the host's decision view (gaps.md §4):
// a call's question and where it is, the Graph's steps (sources, then each
// decision that shaped the document, oldest first), and the Lineage chain
// from /related, /upstream and the manifest. All derived in the shell; no route of its own.

import type { AttentionItem, DecisionBlock, DecisionsView, RelatedView, UpstreamEntry } from '../../host'
import { didWhat, mainTarget, refOfAddress, sureWord, upper, whoOf, withCountry } from '../decisions/words'
import { verdictWords, type Need } from '../decisions/needs'

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
  const kind = item.code === 'bad_verdict' ? verdictWords((item as Need).by) : TITLE[item.code] ?? 'Needs your call'
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

export interface LineRow {
  title: string
  sub: string
  /** Opens that document, as the bar's lineage chips do. */
  path?: string
  here?: boolean
  /** A quiet tooltip (the app's id): never in the visible text. */
  tip?: string
}

export interface LineSection {
  key: 'app' | 'from' | 'here' | 'into' | 'linked'
  title: string
  rows: LineRow[]
  /** What it says when there is nothing in it. */
  empty?: string
}

/** One technical id, folded under "Technical details" with a copy button. */
export interface LineTech { label: string; value: string }

/** The bits of the manifest the chain reads: the app it was made in, and its last change. */
export interface LineManifest {
  id?: string
  document_type?: string
  app?: { name: string; app_id: string; version: string } | null
  lineage?: { parent_id: string; parent_sha256?: string; delta: string } | null
}

const IDS = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\b(?:sha256:)?[0-9a-f]{24,}\b/gi

/**
 * A document's last change (its manifest's lineage delta), in words. A
 * middleware run reads as the run that wrote it: "middleware change from
 * start_campaign@1.0" in the Research Tool is "Written by the research run
 * (start campaign)". No ids, no hashes.
 */
export function changeWords(delta: string, appName?: string | null): string {
  const d = delta.trim()
  const mw = /^middleware change from ([\w.-]+?)(?:@[\w.-]+)?$/i.exec(d)
  if (mw) {
    const run = (appName ?? '').replace(/\s+(tool|maker|app)$/i, '').trim().toLowerCase()
    return `Written by the ${run ? `${run} ` : 'agent '}run (${mw[1].replace(/[_-]+/g, ' ').trim()})`
  }
  const asset = /^added asset (.+)$/i.exec(d)
  if (asset) return `A file was added (${asset[1]})`
  const fields = /^updated fields?: (.+)$/i.exec(d)
  if (fields) {
    const parts = fields[1].split(/,\s*/).map(f => f.replace(/[_-]+/g, ' ').trim()).filter(Boolean)
    const named = parts.slice(0, 3).join(', ')
    return `${parts.length} part${parts.length === 1 ? '' : 's'} edited (${named}${parts.length > 3 ? ` and ${parts.length - 3} more` : ''})`
  }
  const mark = /^mark_(\w+)$/i.exec(d)
  if (mark) return `Marked ${mark[1].replace(/_/g, ' ')}`
  const words = d.replace(IDS, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim()
  return words ? upper(words) : 'Changed'
}

/**
 * The Lineage tab's whole chain, top to bottom: the app it was made in, where
 * it came from (what it was made from, and the run that last wrote it), this
 * document ("You are here"), what was made from it, and the documents linked
 * with it. Human words only; the ids go in `tech`.
 */
export function lineageOf(related: RelatedView | null, here: { title: string; noun: string; manifest?: LineManifest | null }, upstream?: UpstreamEntry[] | null): { sections: LineSection[]; tech: LineTech[] } {
  const m = here.manifest ?? null
  const how: Record<string, string> = { carried: 'further back', made_from: 'made from it', linked: 'linked into this', made_into: 'made from this', linked_in: 'this is linked into it' }
  const row = (d: Pick<RelatedView['upstream'][number], 'title' | 'noun' | 'how' | 'path' | 'taken' | 'status'> | Pick<UpstreamEntry, 'title' | 'noun' | 'how' | 'path' | 'taken' | 'status'>): LineRow => ({
    title: d.title || 'Untitled',
    sub: `${upper(d.noun ?? 'document')} · ${how[d.how ?? ''] ?? (d.how ?? '').replace(/_/g, ' ')}${d.taken ? ` · v${d.taken} kept` : ''}${d.status === 'changed' ? ' · changed since' : ''}`,
    ...(d.path ? { path: d.path } : {}),
  })
  const up = related?.upstream ?? []
  const down = related?.downstream ?? []
  const sections: LineSection[] = []
  if (m?.app) {
    sections.push({ key: 'app', title: 'The app', rows: [{ title: `${m.app.name} · v${m.app.version}`, sub: 'What it was made in', tip: m.app.app_id }] })
  }
  // Further back first (what its parent was made from), then its parent.
  const further = (upstream ?? []).filter(d => d.how === 'carried' && !up.some(u => u.document_id === d.document_id))
  const from = [...further.map(row), ...up.filter(d => d.how === 'made_from').map(row)]
  // A spin-off's last change only repeats the parent above it.
  if (m?.lineage?.delta && !(from.length && /^spun off from /i.test(m.lineage.delta))) from.push({ title: changeWords(m.lineage.delta, m.app?.name), sub: 'Its last change' })
  sections.push({ key: 'from', title: 'Where it came from', rows: from, empty: 'Started here, from nothing before it.' })
  sections.push({ key: 'here', title: 'This document', rows: [{ title: here.title, sub: upper(here.noun), here: true }] })
  sections.push({ key: 'into', title: 'What was made from it', rows: down.filter(d => d.how === 'made_into').map(row), empty: 'Nothing yet.' })
  sections.push({ key: 'linked', title: 'Linked documents', rows: [...up.filter(d => d.how === 'linked'), ...down.filter(d => d.how === 'linked_in')].map(row), empty: 'None.' })

  const tech: LineTech[] = []
  if (m?.app) tech.push({ label: 'App id', value: m.app.app_id })
  if (m?.id) tech.push({ label: 'Document id', value: m.id })
  if (m?.document_type) tech.push({ label: 'Document type', value: m.document_type })
  if (m?.lineage) {
    tech.push({ label: 'Last change', value: m.lineage.delta })
    tech.push({ label: 'Previous version id', value: m.lineage.parent_id })
    if (m.lineage.parent_sha256) tech.push({ label: 'Previous version sha256', value: m.lineage.parent_sha256 })
  }
  for (const d of [...further, ...up, ...down]) tech.push({ label: `${d.title || 'Untitled'} · id`, value: d.document_id })
  return { sections, tech }
}

/** What still stands between the document and its lock, in words (under the call card). */
export function lockWords(view: DecisionsView | null): string | null {
  if (!view || view.problem) return null
  const n = view.attention.filter(a => a.blocks_lock).length
  if (view.lock.locked && !view.lock.reopened?.length) return 'It is locked. A change from here makes a new version.'
  if (view.lock.can_lock) return 'Nothing stops you locking it.'
  return `You can lock it once ${n === 1 ? 'this is' : 'these are'} settled.`
}
