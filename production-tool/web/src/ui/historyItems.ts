// The History panel's logic (contract 3): which decisions are about an item
// ("why does this look like this?"). It reads the addresses each decision
// targets and cites (model/lineage.ts), never ids in the words.

import type { ProductionDocument } from '../contracts/types'
import { entityOf, kindOf as kindOfDecision, type Kind } from '../model/lineage'
import { currentRender, framesOf, refName, refsList, rendersOf, shotNumber, shotsOf, takesOf } from '../model/selectors'

export interface ChainLike {
  id?: string
  agent: string
  action: string
  rationale?: string
  timestamp: string
  fields_changed?: string[]
  pinned?: boolean
  targets?: string[]
  cites?: string[]
}

export interface HistoryItem {
  key: string
  label: string
  /** Entity addresses (<doc>#map[id]) any related decision targets or cites. */
  addresses: string[]
}

/** The items the panel can narrow to: each named ref, each shot's frame and clip, the ad. */
export function historyItems(doc: ProductionDocument, docId: string): HistoryItem[] {
  const at = (map: string, id: string | undefined) => (id ? [`${docId}#${map}[${id}]`] : [])
  const items: HistoryItem[] = []
  for (const r of refsList(doc)) {
    items.push({ key: `ref:${r.id}`, label: `@${refName(r)}`, addresses: [...at('refs', r.id), ...at('keys', Object.values(doc.keys).find((k) => k.key === r.key)?.id)] })
  }
  for (const s of shotsOf(doc)) {
    const n = shotNumber(doc, s.id)
    const frames = framesOf(doc, s.id)
    if (frames.length) {
      items.push({ key: `frame:${s.id}`, label: `Shot ${n} frame`,
        addresses: [...at('shots', s.id), ...frames.flatMap((f) => [...at('frames', f.id), ...at('jobs', f.job_id)])] })
    }
    const takes = takesOf(doc, s.id)
    if (takes.length) {
      items.push({ key: `take:${s.id}`, label: `Shot ${n} clip`, addresses: takes.flatMap((t) => [...at('takes', t.id), ...at('jobs', t.job_id)]) })
    }
  }
  const renders = rendersOf(doc)
  if (renders.length) {
    const video = currentRender(doc)?.video_id
    items.push({ key: 'ad', label: 'The ad', addresses: [...at('videos', video), ...renders.flatMap((r) => [...at('renders', r.id), ...at('jobs', r.job_id)])] })
  }
  return items
}

/** Whether a decision is about the item: it targets or cites one of the item's entities. */
export function aboutItem(entry: ChainLike, item: HistoryItem | undefined): boolean {
  if (!item) return true
  const own = new Set([...(entry.targets ?? []), ...(entry.cites ?? [])].map((a) => entityOf(a)).filter(Boolean))
  return item.addresses.some((a) => own.has(a))
}

/** The Kind of a decision (Decisions, Checks, Asks, Picks: ui-behaviour 3.20). */
export function entryKind(entry: ChainLike): Kind {
  const entities = (entry.targets ?? []).map((a) => entityOf(a)).filter((x): x is string => !!x)
  return kindOfDecision(entry.action.split(' ')[0], entities)
}

export type AgentKind = 'person' | 'crew' | 'other'

const CREW: Record<string, string> = { dex: 'directs', skye: 'scripts', wren: 'renders', rhea: 'retouches', edie: 'edits', ellis: 'reads', jude: 'checks' }

export function kindOf(agent: string): AgentKind {
  if (agent.startsWith('human:')) return 'person'
  if (agent in CREW) return 'crew'
  return 'other'
}

/** Who an entry names, in the panel's words: You, another person, or the crew member and their sign-off. */
export function who(agent: string, me: string | undefined): { label: string; detail?: string } {
  const kind = kindOf(agent)
  if (kind === 'person') return { label: me && agent === `human:${me}` ? 'You' : agent.slice('human:'.length) }
  if (kind === 'crew') return { label: agent[0].toUpperCase() + agent.slice(1), detail: CREW[agent] }
  return { label: agent }
}

/** Long hashes and ids, shortened for reading (the full text stays in the title). */
export function readable(s: string): string {
  return s.replace(/sha256:([0-9a-f]{8})[0-9a-f]{56}/g, 'sha256:$1…').replace(/\b([a-z]+_)([0-9A-HJKMNP-TV-Z]{20})([0-9A-HJKMNP-TV-Z]{6})\b/g, '$1…$3')
}

export function timeOf(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
