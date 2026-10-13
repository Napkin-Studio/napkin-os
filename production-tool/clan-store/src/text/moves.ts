// The writes that move live text between owners (contracts/collab.md §5-6):
// Dex's plan landing, and keeping or dropping Skye's suggestions.
import type { LocalPatchBus } from '../bus/local'
import type { LocalTextBus } from '../bus/text'
import type { Patch, PatchResult, PatchWhy } from '../bus/types'
import type { Entity } from '../types'
import { rankBetween } from '../rank'
import { hydrate, proseHash, type Prose } from './checkpoint'
import type { FragmentKind } from './extensions'

export interface PlannedEntity { id: string; value: Record<string, unknown>; prose: Prose }

export interface PlanLanding {
  /** Scenes whose unplanned text the plan used, and what stays in each (often nothing). */
  scenes?: { id: string; remainder: Prose }[]
  /** New shots: their fields (no text) and their text. */
  shots: PlannedEntity[]
  beats?: PlannedEntity[]
  /** Other field writes in the same step: a storyboard's target, a shot re-planned. */
  patches?: Patch[]
}

/**
 * Land Dex's plan as ONE undo step: the entities are created (one decision, agent
 * dex, citing the job), then the text moves out of the scenes into the shots and
 * beats in ONE Y transaction, so a span is never in two places.
 */
export async function landPlan(bus: LocalPatchBus, text: LocalTextBus, landing: PlanLanding, why: PatchWhy): Promise<PatchResult> {
  const patches: Patch[] = [
    ...landing.shots.map((s): Patch => ({ op: 'create', entity: 'shots', id: s.id, value: s.value, base_version: 0 })),
    ...(landing.beats ?? []).map((b): Patch => ({ op: 'create', entity: 'beats', id: b.id, value: b.value, base_version: 0 })),
    ...(landing.patches ?? []),
  ]
  const r = await bus.apply({ patches, why })
  if (!r.applied) return r
  const frags: { kind: FragmentKind; id: string }[] = [
    ...(landing.scenes ?? []).map((s) => ({ kind: 'scene' as const, id: s.id })),
    ...landing.shots.map((s) => ({ kind: 'shot' as const, id: s.id })),
    ...(landing.beats ?? []).map((b) => ({ kind: 'beat' as const, id: b.id })),
  ]
  await text.edit(frags, why.agent ?? 'dex', (frag) => {
    for (const s of landing.scenes ?? []) hydrate(frag('scene', s.id), s.remainder)
    for (const s of landing.shots) hydrate(frag('shot', s.id), s.prose)
    for (const b of landing.beats ?? []) hydrate(frag('beat', b.id), b.prose)
  }, { label: why.action, joinStep: true })
  return r
}

const SUG_KIND: Record<string, FragmentKind> = { scene: 'scene', shot: 'shot', beat: 'beat' }

/** Keep: the suggestion's words replace the target's, and it is marked kept, as one undo step. */
export async function keepSuggestion(bus: LocalPatchBus, text: LocalTextBus, sugId: string): Promise<PatchResult> {
  const sug = bus.doc().suggestions[sugId]
  if (!sug) throw new Error(`no suggestion ${sugId}`)
  if (sug.state !== 'open') throw new Error(`the suggestion is ${String(sug.state)}`)
  const target = sug.target as { kind: string; id: string }
  const kind = SUG_KIND[target.kind]
  if ((await proseHash(text.prose(kind, target.id))) !== sug.base_hash) {
    await markStale(bus, [sugId])
    throw new StaleSuggestion()
  }
  const person = bus.store.personClaim()
  const r = await bus.apply({
    patches: [
      { op: 'set', entity: 'suggestions', id: sugId, path: 'state', value: 'kept', base_version: sug.v },
      { op: 'set', entity: 'suggestions', id: sugId, path: 'decided_by', value: person, base_version: sug.v },
    ],
    why: { action: `keep_suggestion ${target.kind}s[${target.id}]`, cites: [`${bus.store.documentId()}#suggestions[${sugId}]`] },
  })
  if (!r.applied) return r
  const proposed = sug.proposed as { prose: Prose }
  await text.replace(kind, target.id, proposed.prose, person, { label: 'keep Skye\'s draft', joinStep: true })
  return r
}

export class StaleSuggestion extends Error {
  constructor() {
    super('The text changed since Skye wrote this, so it no longer fits. Ask her again.')
    this.name = 'StaleSuggestion'
  }
}

/** Keep mine: the suggestion is dropped and Skye leaves the target alone (hands_off). */
export async function keepMine(bus: LocalPatchBus, sugId: string): Promise<PatchResult> {
  const doc = bus.doc()
  const sug = doc.suggestions[sugId]
  if (!sug) throw new Error(`no suggestion ${sugId}`)
  const target = sug.target as { kind: string; id: string }
  const map = `${target.kind}s` as 'scenes' | 'shots' | 'beats'
  const ent = doc[map][target.id] as Entity | undefined
  const handsOff = [...new Set([...(((ent?.hands_off as string[]) ?? [])), 'skye'])]
  return bus.apply({
    patches: [
      { op: 'set', entity: 'suggestions', id: sugId, path: 'state', value: 'dropped', base_version: sug.v },
      { op: 'set', entity: 'suggestions', id: sugId, path: 'decided_by', value: bus.store.personClaim(), base_version: sug.v },
      ...(ent ? [{ op: 'set' as const, entity: map, id: target.id, path: 'hands_off', value: handsOff, base_version: ent.v }] : []),
    ],
    why: { action: `keep_mine ${map}[${target.id}]`, cites: [`${bus.store.documentId()}#suggestions[${sugId}]`] },
  })
}

export interface ShotPlace {
  /** The shot that will sit right before it (null: first). */
  beforeId?: string | null
  /** The shot that will sit right after it (null: last). */
  afterId?: string | null
  /** Its scene after the move: an id, null for no scene, undefined to keep the one it has. */
  sceneId?: string | null
}

/**
 * Move a shot (features/script-editor.clan, item 3): ONE batch, so one undo
 * step and one decision: its rank between its new neighbours, and its scene
 * when the move crosses scenes. Its id, frames, takes and picks stay. `extra`
 * rides in the same batch (the drift marks on the clips on both sides).
 * When the neighbours' ranks do not bracket a place (they were given out of
 * order), the shot goes right after `beforeId`.
 */
export async function moveShot(bus: LocalPatchBus, shotId: string, place: ShotPlace, opts: { extra?: Patch[]; agent?: string } = {}): Promise<PatchResult> {
  const doc = bus.doc()
  const shot = doc.shots[shotId] as (Entity & { rank: string; scene_id?: string; storyboard_id: string }) | undefined
  if (!shot) throw new Error(`no shot ${shotId}`)
  const rankOf = (id?: string | null) => (id ? ((doc.shots[id] as { rank?: string } | undefined)?.rank ?? null) : null)
  const a = rankOf(place.beforeId)
  let b = rankOf(place.afterId)
  if (a !== null && b !== null && a >= b) {
    // Out of order: right after `beforeId`, before whatever follows it on the storyboard.
    b = Object.values(doc.shots as unknown as Record<string, { id: string; rank: string; storyboard_id: string }>)
      .filter((s) => s.storyboard_id === shot.storyboard_id && s.id !== shotId && s.rank > a)
      .map((s) => s.rank).sort()[0] ?? null
  }
  const rank = rankBetween(a, b)
  const patches: Patch[] = [{ op: 'set', entity: 'shots', id: shotId, path: 'rank', value: rank, base_version: shot.v }]
  if (place.sceneId !== undefined && (place.sceneId ?? undefined) !== shot.scene_id) {
    if (place.sceneId && !doc.scenes[place.sceneId]) throw new Error(`no scene ${place.sceneId}`)
    patches.push({ op: 'set', entity: 'shots', id: shotId, path: 'scene_id', value: place.sceneId, base_version: shot.v })
  }
  patches.push(...(opts.extra ?? []))
  return bus.apply({
    patches,
    why: { action: `move shots[${shotId}]`, ...(opts.agent ? { agent: opts.agent } : {}) },
  })
}

/** Mark open suggestions whose target's text changed since they were written as stale (quiet). */
export async function markStale(bus: LocalPatchBus, ids?: string[], text?: LocalTextBus): Promise<string[]> {
  const doc = bus.doc()
  const stale: string[] = []
  for (const [id, s] of Object.entries(doc.suggestions)) {
    if (s.state !== 'open' || (ids && !ids.includes(id))) continue
    if (text && !ids) {
      const t = s.target as { kind: string; id: string }
      if ((await proseHash(text.prose(SUG_KIND[t.kind], t.id))) === s.base_hash) continue
    }
    stale.push(id)
  }
  if (stale.length) {
    await bus.apply({ patches: stale.map((id) => ({ op: 'set', entity: 'suggestions', id, path: 'state', value: 'stale', base_version: doc.suggestions[id].v })), why: { action: 'set suggestions stale', quiet: true } }, { undo: false })
  }
  return stale
}
