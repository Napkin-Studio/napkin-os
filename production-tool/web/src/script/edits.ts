// The Script editor's writes (features/script-editor.clan). Each is ONE undo step: the
// entities through PatchBus, their text through TextBus in the same step (joinStep), so
// a span of text is never in two places and ⌘Z takes the whole action back.

import {
  EMPTY_PROSE, hydrate, landPlan, moveShot as storeMoveShot, newUlidId, rankBetween, type Patch, type PMNode, type Prose, type ShotPlace,
} from '../../../clan-store/src'
import type { BeatKind, ProductionDocument, Scene, StaleMark } from '../contracts/types'
import { proseFromText } from '../model/diff'
import { currentTake, scenesOf, shotNumber } from '../model/selectors'
import type { ModelStore } from '../model/store'
import { checkSizes, droppedLine, sceneFlat, type FountainScript } from './fountain'

type Doc = ProductionDocument

const docOf = (store: ModelStore) => store.bus.doc() as unknown as Doc

/** A scene heading, typed: a field patch, last writer wins; consecutive keystrokes fold into one step. */
export function setHeading(store: ModelStore, sceneId: string, heading: string) {
  return store.change((d) => {
    if (d.scenes[sceneId]) d.scenes[sceneId].heading = heading.slice(0, 200)
  }, { action: `set scenes[${sceneId}] heading`, coalesce: `heading:${sceneId}` })
}

/** The rank after a scene, before the next one. */
function rankAfterScene(d: Doc, scene: Scene): string {
  const scenes = scenesOf(d, scene.script_id)
  const next = scenes[scenes.findIndex((s) => s.id === scene.id) + 1]
  return rankBetween(scene.rank, next?.rank ?? null)
}

/**
 * Typing INT., EXT., I/E, EST. or a forced '.' at the start of a line of a scene's unplanned
 * text: a new scene with that heading, and the lines after it move into its fragment, as one
 * undo step. On the first line of a scene with no heading yet, the line becomes its heading.
 * Resolves the scene the caret goes to.
 */
export async function splitScene(store: ModelStore, sceneId: string, blockIndex: number, heading: string): Promise<string> {
  await store.flush()
  const d = docOf(store)
  const scene = d.scenes[sceneId]
  if (!scene) throw new Error('That scene is gone.')
  const prose = store.text.prose('scene', sceneId)
  const blocks = prose.content ?? []
  const keep: Prose = { type: 'doc', content: blocks.slice(0, blockIndex) }
  const move: Prose = { type: 'doc', content: blocks.slice(blockIndex + 1) }
  if (blockIndex === 0 && !scene.heading.trim()) {
    const r = await store.bus.apply({ patches: [{ op: 'set', entity: 'scenes', id: sceneId, path: 'heading', value: heading, base_version: scene.v }], why: { action: `set scenes[${sceneId}] heading` } })
    if (!r.applied) throw new Error(r.refused.map((x) => x.message).join('; ') || 'That heading could not be kept.')
    await store.text.edit([{ kind: 'scene', id: sceneId }], store.clan.personClaim(), (frag) => hydrate(frag('scene', sceneId), move), { label: `set scenes[${sceneId}] heading`, joinStep: true })
    await store.flush()
    return sceneId
  }
  const id = newUlidId('scene')
  const r = await store.bus.apply({
    patches: [{ op: 'create', entity: 'scenes', id, value: { script_id: scene.script_id, rank: rankAfterScene(d, scene), heading }, base_version: 0 }],
    why: { action: `create scenes[${id}]`, rationale: `The line "${heading}" starts a scene.` },
  })
  if (!r.applied) throw new Error(r.refused.map((x) => x.message).join('; ') || 'That scene could not be made.')
  await store.text.edit([{ kind: 'scene', id: sceneId }, { kind: 'scene', id }], store.clan.personClaim(), (frag) => {
    hydrate(frag('scene', sceneId), keep)
    hydrate(frag('scene', id), move)
  }, { label: `create scenes[${id}]`, joinStep: true })
  await store.flush()
  return id
}

/** A new empty scene after `afterSceneId` (or at the end). Resolves its id. */
export async function addScene(store: ModelStore, scriptId: string, afterSceneId?: string, heading = ''): Promise<string> {
  await store.flush()
  const d = docOf(store)
  const scenes = scenesOf(d, scriptId)
  const after = afterSceneId ? d.scenes[afterSceneId] : scenes.at(-1)
  const rank = after ? rankAfterScene(d, after) : rankBetween(null, null)
  const id = newUlidId('scene')
  const r = await store.bus.apply({ patches: [{ op: 'create', entity: 'scenes', id, value: { script_id: scriptId, rank, heading }, base_version: 0 }], why: { action: `create scenes[${id}]` } })
  if (!r.applied) throw new Error(r.refused.map((x) => x.message).join('; ') || 'That scene could not be made.')
  await store.flush()
  return id
}

/** The fields of a new shot on a storyboard (no text: text is its fragment's). */
function newShotValue(storyboardId: string, rank: string, sceneId?: string) {
  return { storyboard_id: storyboardId, rank, kind: 'shot', duration_s: 3, camera: { size: 'medium', movement: 'static' }, status: 'planned', ...(sceneId ? { scene_id: sceneId } : {}) }
}

/**
 * The Shot element. In a scene's unplanned text: a new shot in that scene, after its last shot,
 * whose action is the caret's line (moved out of the scene). In a shot: a new empty shot after it.
 * One undo step. Resolves the new shot's id.
 */
export async function insertShot(store: ModelStore, at: { sceneId: string; blockIndex: number; storyboardId: string } | { afterShotId: string }): Promise<string> {
  await store.flush()
  const d = docOf(store)
  const id = newUlidId('shot')
  const person = store.clan.personClaim()
  if ('afterShotId' in at) {
    const s = d.shots[at.afterShotId]
    if (!s) throw new Error('That shot is gone.')
    const after = Object.values(d.shots).filter((x) => x.storyboard_id === s.storyboard_id && x.rank > s.rank).map((x) => x.rank).sort()[0] ?? null
    const r = await landPlan(store.bus, store.text, { shots: [{ id, value: newShotValue(s.storyboard_id, rankBetween(s.rank, after), s.scene_id), prose: EMPTY_PROSE }] }, { action: `create shots[${id}]`, agent: person })
    if (!r.applied) throw new Error(r.refused.map((x) => x.message).join('; ') || 'That shot could not be made.')
    await store.flush()
    return id
  }
  const scene = d.scenes[at.sceneId]
  if (!scene) throw new Error('That scene is gone.')
  const prose = store.text.prose('scene', at.sceneId)
  const blocks = prose.content ?? []
  const line = blocks[at.blockIndex]
  const remainder: Prose = { type: 'doc', content: blocks.filter((_, i) => i !== at.blockIndex) }
  const words: Prose = { type: 'doc', content: line?.content?.length ? [{ type: 'action', content: line.content }] : [] }
  const inScene = Object.values(d.shots).filter((x) => x.storyboard_id === at.storyboardId && x.scene_id === at.sceneId).sort((a, b) => (a.rank < b.rank ? -1 : 1))
  const low = inScene.at(-1)?.rank ?? prevShotRank(d, at.storyboardId, scene)
  const high = Object.values(d.shots).filter((x) => x.storyboard_id === at.storyboardId && (low === null || x.rank > low)).map((x) => x.rank).sort()[0] ?? null
  const rank = rankBetween(low, high)
  const r = await landPlan(store.bus, store.text, {
    scenes: [{ id: at.sceneId, remainder }],
    shots: [{ id, value: newShotValue(at.storyboardId, rank, at.sceneId), prose: words }],
  }, { action: `create shots[${id}]`, agent: person })
  if (!r.applied) throw new Error(r.refused.map((x) => x.message).join('; ') || 'That shot could not be made.')
  await store.flush()
  return id
}

/** The rank of the last shot in the scenes before `scene` (its shots go after them), or null. */
function prevShotRank(d: Doc, storyboardId: string, scene: Scene): string | null {
  const scenes = scenesOf(d, scene.script_id)
  const before = new Set(scenes.slice(0, scenes.findIndex((s) => s.id === scene.id)).map((s) => s.id))
  return Object.values(d.shots).filter((x) => x.storyboard_id === storyboardId && x.scene_id && before.has(x.scene_id)).map((x) => x.rank).sort().at(-1) ?? null
}

/** A beat on a shot (Character in a planned shot makes a line). One undo step. Resolves its id. */
export async function addBeat(store: ModelStore, shotId: string, kind: BeatKind, opts: { at_s?: number; speaker?: string; text?: string } = {}): Promise<string> {
  await store.flush()
  const d = docOf(store)
  const shot = d.shots[shotId]
  if (!shot) throw new Error('That shot is gone.')
  const beats = Object.values(d.beats).filter((b) => b.shot_id === shotId)
  const last = beats.map((b) => b.rank).sort().at(-1) ?? null
  const id = newUlidId('beat')
  const at = Math.min(Math.round((opts.at_s ?? 0) * 2) / 2, Math.floor(shot.duration_s * 2) / 2)
  const value = { shot_id: shotId, rank: rankBetween(last, null), at_s: at, kind, ...(opts.speaker ? { speaker: opts.speaker } : {}) }
  const prose: Prose = opts.text ? proseFromText(d, [{ type: kind === 'line' ? 'dialogue' : 'action', text: opts.text }]) : { type: 'doc', content: [{ type: kind === 'line' ? 'dialogue' : 'action' }] }
  const r = await landPlan(store.bus, store.text, { shots: [], beats: [{ id, value, prose }] }, { action: `create beats[${id}]`, agent: store.clan.personClaim() })
  if (!r.applied) throw new Error(r.refused.map((x) => x.message).join('; ') || 'That beat could not be made.')
  await store.flush()
  return id
}

/** The clips the move puts next to other clips: they get a 'to check' mark in the same step. */
export function orderMarks(d: Doc, shotId: string, neighbours: (string | null | undefined)[], now = new Date().toISOString()): StaleMark[] {
  const n = shotNumber(d, shotId)
  const out: StaleMark[] = []
  for (const id of [shotId, ...neighbours]) {
    if (!id) continue
    const take = currentTake(d, id)
    if (!take) continue
    const had = Object.values(d.stale).some((m) => m.target.kind === 'take' && m.target.id === take.id && m.caused_by.kind === 'shot' && m.caused_by.id === shotId)
    if (had) continue
    out.push({ id: newUlidId('stale'), v: 1, field_v: {}, target: { kind: 'take', id: take.id }, caused_by: { kind: 'shot', id: shotId }, reason: `Shot ${n || ''}'s order changed`.replace('Shot \'s', 'A shot\'s'), marked_at: now })
  }
  return out
}

/** Drag a shot (outline or table): one rank write, plus its scene when it crosses scenes, and the clips' marks: one step. */
export async function moveShotTo(store: ModelStore, shotId: string, place: ShotPlace) {
  await store.flush()
  const d = docOf(store)
  const marks = orderMarks(d, shotId, [place.beforeId, place.afterId])
  const extra: Patch[] = marks.map((m) => ({ op: 'create', entity: 'stale', id: m.id, value: m, base_version: 0 }))
  const r = await storeMoveShot(store.bus, shotId, place, { extra })
  if (!r.applied) throw new Error(r.refused.map((x) => x.message).join('; ') || 'That shot could not move.')
  await store.flush()
  return r
}

/**
 * A reference added to a shot from its chips (the Storyboard card's '+ ref'): a mention at the
 * end of its action, typed into the live text as the person, one undo step. Replaces the old
 * flat withMention, which rewrote the whole action as words.
 */
export async function insertMention(store: ModelStore, shotId: string, target: { id: string; label: string }) {
  await store.flush()
  const prose = store.text.prose('shot', shotId)
  const blocks = [...(prose.content ?? [])]
  let i = blocks.map((b) => b.type).lastIndexOf('action')
  if (i < 0) {
    blocks.unshift({ type: 'action', content: [] })
    i = 0
  }
  const inline = [...(blocks[i].content ?? [])]
  const lastText = inline.at(-1)
  if (lastText && !(lastText.type === 'text' && /\s$/.test(lastText.text ?? ''))) inline.push({ type: 'text', text: ' ' })
  inline.push({ type: 'mention', attrs: { id: target.id, label: target.label } })
  blocks[i] = { ...blocks[i], content: inline }
  await store.text.replace('shot', shotId, { type: 'doc', content: blocks }, store.clan.personClaim(), { label: `name @${target.label} in shots[${shotId}]` })
  await store.flush()
}

/** A reference taken off a shot: every mention of it leaves the text, one undo step. */
export async function removeMention(store: ModelStore, shotId: string, targetId: string) {
  await store.flush()
  const prose = store.text.prose('shot', shotId)
  const strip = (nodes: PMNode[] | undefined): PMNode[] => {
    const out: PMNode[] = []
    for (const n of nodes ?? []) {
      if (n.type === 'mention' && n.attrs?.id === targetId) continue
      const prev = out.at(-1)
      // Two spaces where the mention was become one.
      if (n.type === 'text' && prev?.type === 'text') prev.text = `${prev.text ?? ''}${n.text ?? ''}`.replace(/ {2,}/g, ' ')
      else out.push({ ...n })
    }
    const removed = (nodes ?? []).some((n) => n.type === 'mention' && n.attrs?.id === targetId)
    const last = out.at(-1)
    if (removed && last?.type === 'text') last.text = (last.text ?? '').trimEnd()
    const first = out[0]
    if (removed && first?.type === 'text') first.text = (first.text ?? '').trimStart()
    return out.filter((n) => n.type !== 'text' || n.text)
  }
  const next: Prose = { type: 'doc', content: (prose.content ?? []).map((b) => (b.content ? { ...b, content: strip(b.content) } : b)) }
  for (const b of next.content ?? []) if (b.content && !b.content.length) delete b.content
  await store.text.replace('shot', shotId, next, store.clan.personClaim(), { label: `unlink a reference from shots[${shotId}]` })
  await store.flush()
}

/** Prose blocks from Fountain blocks: @words that name a ref become mentions (model/diff.ts). */
export function fountainProse(d: Doc, blocks: { type: string; text: string }[]): Prose {
  const content: PMNode[] = []
  for (const b of blocks) {
    const p = proseFromText(d, [{ type: b.type, text: b.text }])
    content.push(...(p.content ?? []))
  }
  return { type: 'doc', content }
}

/**
 * A Fountain file into the script, as ONE undo step: its title becomes the script's, and each
 * scene a scene entity after the ones there (an empty first scene is used, not left behind).
 * Refused, naming the scene, when a scene is too big. Resolves the line that counts what was left out.
 */
export async function importFountain(store: ModelStore, scriptId: string, parsed: FountainScript): Promise<{ scenes: number; dropped: string }> {
  await store.flush()
  const d = docOf(store)
  const script = d.scripts[scriptId]
  if (!script) throw new Error('This script is gone.')
  checkSizes(parsed, (sc) => JSON.stringify(fountainProse(d, sc.blocks)).length)
  if (!parsed.scenes.length) throw new Error('That file has no script in it.')
  const existing = scenesOf(d, scriptId)
  const reuse = existing.length === 1 && !existing[0].heading.trim() && !store.text.prose('scene', existing[0].id).content?.length ? existing[0] : undefined
  const last = reuse ? null : existing.at(-1)?.rank ?? null
  const ranks: string[] = []
  let prev = last
  for (let i = 0; i < parsed.scenes.length - (reuse ? 1 : 0); i++) {
    prev = rankBetween(prev, null)
    ranks.push(prev)
  }
  const patches: Patch[] = []
  const ids: string[] = []
  parsed.scenes.forEach((sc, i) => {
    if (reuse && i === 0) {
      ids.push(reuse.id)
      if (sc.heading) patches.push({ op: 'set', entity: 'scenes', id: reuse.id, path: 'heading', value: sc.heading.slice(0, 200), base_version: reuse.v })
      return
    }
    const id = newUlidId('scene')
    ids.push(id)
    patches.push({ op: 'create', entity: 'scenes', id, value: { script_id: scriptId, rank: ranks[reuse ? i - 1 : i], heading: sc.heading.slice(0, 200) }, base_version: 0 })
  })
  if (parsed.title) patches.push({ op: 'set', entity: 'scripts', id: scriptId, path: 'title', value: parsed.title.slice(0, 200), base_version: script.v })
  const why = { action: `create ${parsed.scenes.length} scenes from a Fountain file`, rationale: [`${parsed.scenes.length} scenes, ${parsed.scenes.reduce((n, s) => n + sceneFlat(s.blocks).length, 0).toLocaleString('en')} characters.`, droppedLine(parsed.dropped)].filter(Boolean).join(' ') }
  const r = await store.bus.apply({ patches, why })
  if (!r.applied) throw new Error(r.refused.map((x) => x.message).join('; ') || 'That file could not be imported.')
  await store.text.edit(ids.map((id) => ({ kind: 'scene' as const, id })), store.clan.personClaim(), (frag) => {
    parsed.scenes.forEach((sc, i) => hydrate(frag('scene', ids[i]), fountainProse(d, sc.blocks)))
  }, { label: why.action, joinStep: true })
  await store.flush()
  return { scenes: parsed.scenes.length, dropped: droppedLine(parsed.dropped) }
}
