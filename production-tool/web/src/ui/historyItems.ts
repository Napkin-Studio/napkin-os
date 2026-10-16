// The History panel's logic (contract 3): which decisions are about an item
// ("why does this look like this?"). It reads the addresses each decision
// targets and cites (model/lineage.ts), never ids in the words.

import type { Cost, ProductionDocument } from '../contracts/types'
import { entityOf, kindOf as kindOfDecision, type Kind } from '../model/lineage'
import { CAST } from './agents/cast'
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
    // The ref, its key, and the Generate that made its picture (a generated node is named by its job).
    const made = r.node && doc.jobs[r.node] ? r.node : undefined
    items.push({ key: `ref:${r.id}`, label: `@${refName(r)}`, addresses: [...at('refs', r.id), ...at('keys', Object.values(doc.keys).find((k) => k.key === r.key)?.id), ...at('jobs', made)] })
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
  // Each Campaign board (features/campaign-formats.clan): its set, its sizes, and every job that made one
  // (a crop is free; an extend, a regenerate and a full-size upscale show their cost here, and only here).
  const sets = Object.values(doc.format_sets ?? {})
  for (const [i, set] of sets.entries()) {
    const sizes = Object.values(doc.sizes ?? {}).filter((s) => s.set_id === set.id)
    if (!sizes.length) continue
    items.push({ key: `fset:${set.id}`, label: `Campaign${sets.length > 1 ? ` ${i + 1}` : ''} · ${sizes.length} formats`, addresses: [...at('format_sets', set.id),
      ...sizes.flatMap((s) => [...at('sizes', s.id), ...at('jobs', s.job_id), ...at('jobs', s.full?.job_id)])] })
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


export function kindOf(agent: string): AgentKind {
  if (agent.startsWith('human:')) return 'person'
  if (agent in CAST) return 'crew'
  return 'other'
}

/** Who an entry names, in the panel's words: You, another person, or the crew member and their sign-off. */
export function who(agent: string, me: string | undefined): { label: string; detail?: string } {
  const kind = kindOf(agent)
  if (kind === 'person') return { label: me && agent === `human:${me}` ? 'You' : agent.slice('human:'.length) }
  if (kind === 'crew') { const c = CAST[agent as keyof typeof CAST]; return { label: c.given, detail: c.job } }
  return { label: agent }
}

/** A job's recorded cost, for History, the one place the tool shows money (owner, 2026-10-13): what
 *  the provider confirmed, else "about" the reservation. Nothing for a free job (the mock) or an
 *  unknown price. A failed attempt the provider billed shows its cost like any other, with no words. */
export function jobCost(cost: Cost | undefined): string | undefined {
  if (!cost) return undefined
  const fmt = (v: number) => `$${v < 0.1 ? v.toFixed(3) : v.toFixed(2)}`
  if (cost.confirmed != null) return cost.confirmed > 0 ? fmt(cost.confirmed) : undefined
  if (cost.unknown) return undefined
  return cost.estimate ? `about ${fmt(cost.estimate)}` : undefined
}

/** The job a decision is about: the first job it targets or cites. */
export function jobOf(entry: ChainLike): string | undefined {
  for (const a of [...(entry.targets ?? []), ...(entry.cites ?? [])]) {
    const m = /#jobs\[([^\]]+)\]/.exec(a)
    if (m) return m[1]
  }
  return undefined
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

const MAP_WORDS: Record<string, string> = {
  scenes: 'the script', scripts: 'the script', storyboards: 'the storyboard', videos: 'the video', jobs: 'a job', refs: 'a reference',
  keys: 'a character', reviews: 'a note', links: 'a link', asks: 'a question', checks: 'a check', suggestions: 'a suggestion',
  renders: 'the ad', stale: 'an out-of-date mark', assets: 'a file', project: 'the project', boards: 'a board', beats: 'a moment',
}
const FIELD_WORDS: Record<string, string> = {
  'pick.current': 'the version in use', 'pick.alternates': 'the versions kept', 'camera.size': 'framing', 'camera.movement': 'camera move',
  'camera.angle': 'angle', 'camera.lens_mm': 'lens', duration_s: 'length', rank: 'order', status: 'status', state: 'state',
  ratio: 'format', target_s: 'length', title: 'title', heading: 'heading', role: 'role', answers: 'the answer', hands_off: 'hands off',
}
const fieldWords = (f: string) => FIELD_WORDS[f] ?? f.replace(/[._]/g, ' ')

/** An entity, in words: "shot 2", "frame v3 of shot 2", "@maya_front", "the script". */
export function entityWords(doc: ProductionDocument, map: string, id: string): string {
  switch (map) {
    case 'shots': {
      const n = shotNumber(doc, id)
      return n ? `shot ${n}` : 'a shot'
    }
    case 'frames': {
      const f = doc.frames[id]
      return f ? `frame v${f.version}${f.shot_id ? ` of shot ${shotNumber(doc, f.shot_id)}` : ''}` : 'a frame'
    }
    case 'takes': {
      const t = doc.takes[id]
      return t ? `clip v${t.version} of shot ${shotNumber(doc, t.shot_id)}` : 'a clip'
    }
    case 'refs': {
      const r = doc.refs[id]
      return r ? `@${refName(r)}` : 'a reference'
    }
    default:
      return MAP_WORDS[map] ?? map.replace(/_/g, ' ')
  }
}

const PATH = /(?:[^#\s]+#)?([a-z_]+)\[([^\]\s]+)\]((?:\.[a-z_]+|\[[^\]\s]+\])*)/g

/** Words a person reads, from an action or an address that names entities by id (spec §10: no raw paths). */
export function plainWords(text: string, doc: ProductionDocument): string {
  const out = text.replace(PATH, (_m, map: string, id: string, rest: string) => {
    if (map === 'videos' && rest.startsWith('.edl[')) {
      const item = /^\.edl\[([^\]]+)\]/.exec(rest)?.[1]
      const shot = item ? doc.videos[id]?.edl[item]?.shot_id : undefined
      const field = rest.replace(/^\.edl\[[^\]]+\]\.?/, '')
      return `${shot ? `the cut's clip for shot ${shotNumber(doc, shot)}` : 'the cut'}${field ? `: ${fieldWords(field)}` : ''}`
    }
    const field = rest.replace(/^\./, '')
    return `${entityWords(doc, map, id)}${field ? `: ${fieldWords(field)}` : ''}`
  })
  return out.replace(/^write (the script|shot \d+|a note|a moment)$/, 'wrote $1')
}

/** Decisions from before the project began (the app template's own) are not the project's history. */
export function projectEntries<E extends ChainLike>(entries: E[]): E[] {
  const start = entries.findIndex((e) => e.action === 'start the project')
  return start < 0 ? entries.filter((e) => !e.agent.startsWith('clan-store')) : entries.slice(0, start + 1)
}
