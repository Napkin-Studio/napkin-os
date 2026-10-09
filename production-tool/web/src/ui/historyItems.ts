// The History panel's logic: which chain entries are about an item ("why does
// this look like this?"). An item is known by its ids, the jobs that made it
// and every job before those (parent_ids), and the pictures those jobs took
// in; an entry is about it when its action or rationale names any of them.

import type { ProductionDocument } from '../contracts/types'

export interface ChainLike {
  agent: string
  action: string
  rationale?: string
  timestamp: string
  fields_changed?: string[]
  pinned?: boolean
}

export interface HistoryItem {
  key: string
  label: string
  /** Strings any related entry names. */
  tokens: string[]
}

/** The job ids, their ancestors, and every hash they took in or gave out. */
function lineage(doc: ProductionDocument, jobIds: string[], out: Set<string>) {
  const byId = new Map(doc.jobs.map((j) => [j.id, j]))
  const todo = [...jobIds]
  while (todo.length) {
    const id = todo.pop()!
    if (out.has(id)) continue
    out.add(id)
    const j = byId.get(id)
    if (!j) continue
    for (const h of j.input_hashes ?? []) out.add(h)
    for (const h of j.outputs ?? []) out.add(h)
    for (const p of j.parent_ids ?? []) todo.push(p)
  }
}

/** The items the panel can narrow to: each named ref, each shot's frame and clip, the ad. */
export function historyItems(doc: ProductionDocument): HistoryItem[] {
  const items: HistoryItem[] = []
  for (const r of doc.refs) {
    const name = `@${r.key}_${r.variant}`
    const t = new Set<string>([r.id, r.asset, name])
    // A generated image's node id is its job id: follow what it was made from.
    if (r.node && doc.jobs.some((j) => j.id === r.node)) lineage(doc, [r.node], t)
    items.push({ key: `ref:${r.id}`, label: name, tokens: [...t] })
  }
  for (const s of [...(doc.shots ?? [])].sort((a, b) => a.order - b.order)) {
    const frames = (doc.frames ?? []).filter((f) => f.shot_id === s.id)
    if (frames.length) {
      const t = new Set<string>([s.id])
      for (const f of frames) t.add(f.id)
      lineage(doc, frames.map((f) => f.job_id), t)
      items.push({ key: `frame:${s.id}`, label: `Shot ${s.order} frame`, tokens: [...t] })
    }
    const takes = (doc.takes ?? []).filter((x) => x.shot_id === s.id)
    if (takes.length) {
      const t = new Set<string>([s.id])
      for (const x of takes) t.add(x.id)
      lineage(doc, takes.map((x) => x.job_id), t)
      items.push({ key: `take:${s.id}`, label: `Shot ${s.order} clip`, tokens: [...t] })
    }
  }
  const ads = (doc.exports ?? []).filter((e) => e.kind === 'ad_mp4')
  if (ads.length) {
    const t = new Set<string>(ads.map((a) => a.id))
    lineage(doc, ads.map((a) => a.job_id).filter((x): x is string => !!x), t)
    items.push({ key: 'ad', label: 'The ad', tokens: [...t] })
  }
  return items
}

export function aboutItem(entry: ChainLike, item: HistoryItem | undefined): boolean {
  if (!item) return true
  const text = `${entry.action} ${entry.rationale ?? ''}`
  return item.tokens.some((t) => t && text.includes(t))
}

export type AgentKind = 'participant' | 'director' | 'provider'

export function kindOf(agent: string): AgentKind {
  if (agent === 'director' || agent.startsWith('director · ')) return 'director'
  if (agent.includes(' · ')) return 'provider'
  return 'participant'
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
