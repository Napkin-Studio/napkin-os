// The decision tree (ui-behaviour 3.20, artboard 15), rebuilt from the
// decision chain (/chain) and the data. It replaces today's string matching of
// ids in action and rationale text (ui/historyItems.ts).
//
// Each decision says what it changed (targets: <doc>#<map>[<id>]…) and what it
// rests on (cites); its verb (the first word of its action, contracts/collab.md
// §8) and its targets' entity give its Kind. A decision hangs under the latest
// earlier decision about the same thing, or about what that thing came from
// (a frame's parent version, a frame's or take's shot, a cited job's node), so
// the tree branches as versions do. History is never rewritten: a restore and a
// pin are new decisions; pinning is pin_decision / unpin_decision citing the
// decision.

import type { ChainEntry } from '../../../clan-store/src'
import type { ProductionDocument } from '../contracts/types'
import { takeNumber } from './selectors'

export type Kind = 'decision' | 'check' | 'ask' | 'pick'

export interface TreeNode {
  /** The decision's id (d_…). */
  id: string
  agent: string
  /** person, the crew, or something else (an older entry). */
  actor: 'person' | 'crew' | 'other'
  action: string
  verb: string
  kind: Kind
  rationale: string
  timestamp: string
  /** Entity addresses (<doc>#map[id]) this decision changed: the leaves' entities included. */
  entities: string[]
  targets: string[]
  cites: string[]
  pinned: boolean
  /** The decision it hangs under, if any. */
  parent: string | null
  children: string[]
  /** For a version's own decision: v1, v2… of the frame, take or render it made. */
  version?: string
}

export interface Lineage {
  /** Oldest first. */
  nodes: TreeNode[]
  byId: Map<string, TreeNode>
  roots: string[]
  counts: Record<Kind, number>
  /** Every decision about an entity (its address, <doc>#map[id]), oldest first. */
  about(address: string): TreeNode[]
}

const CREW = new Set(['dex', 'skye', 'wren', 'rhea', 'edie', 'ellis', 'jude'])
const PICK_VERBS = new Set(['pick', 'keep_both', 'restore'])
const ASK_VERBS = new Set(['ask', 'answer', 'change_answer'])
const ENTITY = /^([^#]+)#([a-z_]+)\[([^\]]+)\]/

/** The entity an address is about: <doc>#map[id] from <doc>#map[id].field.part. */
export function entityOf(address: string): string | null {
  const m = ENTITY.exec(address)
  if (m) return `${m[1]}#${m[2]}[${m[3]}]`
  const p = /^([^#]+)#project(\.|$)/.exec(address)
  return p ? `${p[1]}#project` : null
}

function mapOf(entityAddress: string): string {
  return ENTITY.exec(entityAddress)?.[2] ?? ''
}

/** A decision's Kind: from its verb, and the entity it targets. */
export function kindOf(verb: string, entities: string[]): Kind {
  if (verb === 'check' || entities.some((e) => mapOf(e) === 'checks')) return 'check'
  if (ASK_VERBS.has(verb) || (entities.length > 0 && entities.every((e) => mapOf(e) === 'asks'))) return 'ask'
  if (PICK_VERBS.has(verb)) return 'pick'
  return 'decision'
}

/** What an entity came from, for the tree: a version's parent, a frame's or take's shot, a beat's shot. */
function upstreamOf(doc: ProductionDocument, docId: string, entity: string): string[] {
  const m = ENTITY.exec(entity)
  if (!m) return []
  const [, , map, id] = m
  const at = (mp: string, i?: string) => (i ? [`${docId}#${mp}[${i}]`] : [])
  switch (map) {
    case 'frames': {
      const f = doc.frames[id]
      return f ? [...at('frames', f.parent_id), ...at('shots', f.shot_id), ...at('sketches', f.sketch_id)] : []
    }
    case 'generations': {
      const g = doc.generations[id]
      return g ? [...at('generations', g.parent_id), ...g.shot_ids.flatMap((s) => at('shots', s))] : []
    }
    case 'renders': {
      const r = doc.renders[id]
      return r ? [...at('renders', r.parent_id), ...at('videos', r.video_id)] : []
    }
    case 'beats':
      return at('shots', doc.beats[id]?.shot_id)
    case 'shots': {
      // A shot comes from its scene's words, on its storyboard.
      const s = doc.shots[id]
      return s ? [...at('scenes', s.scene_id), ...at('storyboards', s.storyboard_id)] : []
    }
    case 'checks': {
      const c = doc.checks[id]
      return c ? at(`${c.target.kind}s`, c.target.id) : []
    }
    case 'asks': {
      const a = doc.asks[id]
      return a ? at(`${a.node.kind}s`, a.node.id) : []
    }
    case 'suggestions': {
      const s = doc.suggestions[id]
      return s ? at(`${s.target.kind}s`, s.target.id) : []
    }
    default:
      return []
  }
}

/**
 * The tree. `chain` is newest first, as /chain gives it; `doc` is the data now (for versions and what
 * each entity came from); `docId` is the document id addresses start with.
 */
export function lineage(chain: ChainEntry[], doc: ProductionDocument, docId: string): Lineage {
  const nodes: TreeNode[] = []
  const byId = new Map<string, TreeNode>()
  const lastAbout = new Map<string, string>() // entity → latest decision id about it
  const pins = new Map<string, boolean>()
  const oldestFirst = [...chain].reverse()
  for (const e of oldestFirst) {
    if (!e.id) continue
    const verb = e.action.split(' ')[0]
    if (verb === 'pin_decision' || verb === 'unpin_decision') {
      for (const c of e.cites ?? []) pins.set(c, verb === 'pin_decision')
    }
  }
  for (const e of oldestFirst) {
    if (!e.id) continue
    const verb = e.action.split(' ')[0]
    const targets = e.targets ?? []
    const cites = e.cites ?? []
    const entities = [...new Set(targets.map(entityOf).filter((x): x is string => !!x))]
    // The parent: the latest decision about one of its entities, else about what they came from, else a cited one.
    let parent: string | null = null
    const consider = (entity: string) => {
      const p = lastAbout.get(entity)
      if (p && (!parent || nodeIndex(byId, p) > nodeIndex(byId, parent))) parent = p
    }
    for (const ent of entities) consider(ent)
    if (!parent) for (const ent of entities) for (const up of upstreamOf(doc, docId, ent)) consider(up)
    if (!parent) {
      for (const c of cites) {
        if (byId.has(c)) parent = c
        const ent = entityOf(c)
        if (ent) consider(ent)
        // A cited job: the decision hangs under the latest one about the job's node.
        const job = ent && ENTITY.exec(ent)?.[2] === 'jobs' ? doc.jobs[ENTITY.exec(ent)![3]] : undefined
        if (job) consider(`${docId}#${job.node.kind}s[${job.node.id}]`)
      }
    }
    const kind = kindOf(verb, entities)
    const versionOf = entities.map((ent) => {
      const m = ENTITY.exec(ent)
      const g = m && m[2] === 'generations' ? doc.generations[m[3]] : undefined
      const rec = m && (m[2] === 'frames' ? doc.frames[m[3]] : m[2] === 'renders' ? doc.renders[m[3]] : undefined)
      const version = rec?.version ?? (g?.shot_ids[0] ? takeNumber(doc, g.id, g.shot_ids[0]) : undefined)
      return version && verb !== 'pick' && verb !== 'keep_both' && verb !== 'restore' ? `v${version}` : undefined
    }).find(Boolean)
    const node: TreeNode = {
      id: e.id,
      agent: e.agent,
      actor: e.agent.startsWith('human:') ? 'person' : CREW.has(e.agent) ? 'crew' : 'other',
      action: e.action,
      verb,
      kind,
      rationale: e.rationale ?? '',
      timestamp: e.timestamp,
      entities,
      targets,
      cites,
      pinned: !!e.pinned || pins.get(e.id) === true,
      parent,
      children: [],
      ...(versionOf ? { version: versionOf } : {}),
    }
    if (verb === 'pin_decision' || verb === 'unpin_decision') node.kind = 'decision'
    nodes.push(node)
    byId.set(node.id, node)
    if (parent) byId.get(parent)!.children.push(node.id)
    for (const ent of entities) lastAbout.set(ent, node.id)
  }
  const counts: Record<Kind, number> = { decision: 0, check: 0, ask: 0, pick: 0 }
  for (const n of nodes) counts[n.kind]++
  return {
    nodes,
    byId,
    roots: nodes.filter((n) => !n.parent).map((n) => n.id),
    counts,
    about: (address: string) => {
      const ent = entityOf(address) ?? address
      return nodes.filter((n) => n.entities.includes(ent))
    },
  }
}

function nodeIndex(byId: Map<string, TreeNode>, id: string): number {
  let i = 0
  for (const k of byId.keys()) {
    if (k === id) return i
    i++
  }
  return -1
}
