// Reading a contract-3 document the way today's three panels need it
// (features/contract-v3.clan: "the port of today's panels through selectors").
//
// Every list in the document is an id-keyed map; order is rank. A new project
// has one script, one storyboard and one video, the script driving the
// storyboard and the storyboard rendering the video (clan-store create()).
// Today's panels work on those three; the selectors find them through the
// links, never by position.

import type {
  Beat, DocAsset, DocJob, EdlItem, Frame, Id, KeyEntry, NamedRef, ProductionDocument, Render, Review, Scene, Script, Shot,
  StaleMark, Storyboard, Take, Video,
} from '../contracts/types'

type Doc = ProductionDocument

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const byRank = <T extends { rank: string; id: string }>(a: T, b: T) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : byId(a, b))
const values = <T>(m: Record<string, T> | undefined): T[] => Object.values(m ?? {})

/** The first created of a map (ids are ULIDs: they sort by time). */
function first<T extends { id: string }>(m: Record<string, T> | undefined): T | undefined {
  return values(m).sort(byId)[0]
}

/** The video today's panels work on: the first one. */
export function mainVideo(d: Doc): Video | undefined {
  return first(d.videos)
}

/** The storyboard that renders the main video (its `renders` link), else the first. */
export function mainStoryboard(d: Doc): Storyboard | undefined {
  const v = mainVideo(d)
  const link = v && values(d.links).find((l) => l.role === 'renders' && l.to.kind === 'video' && l.to.id === v.id)
  return (link && d.storyboards[link.from.id]) || first(d.storyboards)
}

/** The script that drives the main storyboard (its `drives` link), else the first. */
export function mainScript(d: Doc): Script | undefined {
  const sb = mainStoryboard(d)
  const link = sb && values(d.links).find((l) => l.role === 'drives' && l.to.kind === 'storyboard' && l.to.id === sb.id)
  return (link && d.scripts[link.from.id]) || first(d.scripts)
}

/** A storyboard's shots in rank order (the main storyboard's by default). */
export function shotsOf(d: Doc, storyboardId = mainStoryboard(d)?.id): Shot[] {
  return values(d.shots).filter((s) => s.storyboard_id === storyboardId).sort(byRank)
}

/** A shot's number on its storyboard, 1-based ("shot 2"), or 0 when it is not on one. */
export function shotNumber(d: Doc, shotId: Id | undefined): number {
  const s = shotId ? d.shots[shotId] : undefined
  return s ? shotsOf(d, s.storyboard_id).findIndex((x) => x.id === s.id) + 1 : 0
}

/** The words for a shot in a sentence: "shot 2", or "a shot". */
export function shotName(d: Doc, shotId: Id | undefined): string {
  const n = shotNumber(d, shotId)
  return n ? `shot ${n}` : 'a shot'
}

/** A script's scenes in rank order (the main script's by default). */
export function scenesOf(d: Doc, scriptId = mainScript(d)?.id): Scene[] {
  return values(d.scenes).filter((s) => s.script_id === scriptId).sort(byRank)
}

/** The script's words no shot owns yet (its scenes' unplanned text). */
export function unplannedText(d: Doc, scriptId = mainScript(d)?.id): string {
  return scenesOf(d, scriptId).map((s) => s.text ?? '').filter(Boolean).join('\n\n')
}

/** The whole script as words: each scene's unplanned text, then its planned shots' action. What Dex re-plans from. */
export function scriptText(d: Doc, scriptId = mainScript(d)?.id): string {
  const scenes = scenesOf(d, scriptId)
  const parts: string[] = []
  for (const sc of scenes) {
    if (sc.heading) parts.push(sc.heading)
    if (sc.text) parts.push(sc.text)
    for (const s of values(d.shots).filter((x) => x.scene_id === sc.id).sort(byRank)) if (s.action) parts.push(s.action)
  }
  return parts.join('\n')
}

/** A shot's beats by rank, then time. */
export function beatsOf(d: Doc, shotId: Id): Beat[] {
  return values(d.beats).filter((b) => b.shot_id === shotId).sort((a, b) => a.at_s - b.at_s || byRank(a, b))
}

/** A shot's frame versions, oldest first. */
export function framesOf(d: Doc, shotId: Id): Frame[] {
  return values(d.frames).filter((f) => f.shot_id === shotId).sort((a, b) => a.version - b.version || byId(a, b))
}

/** The frame in the shot now (its pick), if any. */
export function currentFrame(d: Doc, shot: Shot | Id | undefined): Frame | undefined {
  const s = typeof shot === 'string' ? d.shots[shot] : shot
  return s?.pick ? d.frames[s.pick.current] : undefined
}

/** The asset of the frame in the shot now. */
export function shotFrameAsset(d: Doc, shot: Shot | Id | undefined): string | undefined {
  return currentFrame(d, shot)?.asset
}

/** A shot's takes, oldest first. */
export function takesOf(d: Doc, shotId: Id): Take[] {
  return values(d.takes).filter((t) => t.shot_id === shotId).sort((a, b) => a.version - b.version || byId(a, b))
}

/** The cut's items in rank order (the main video's by default). */
export function edlOf(d: Doc, videoId = mainVideo(d)?.id): (EdlItem & { id: Id })[] {
  const v = videoId ? d.videos[videoId] : undefined
  return Object.entries(v?.edl ?? {}).map(([id, item]) => ({ ...item, id })).sort(byRank)
}

/** The cut's item for a shot, if the shot is in it. */
export function edlItemFor(d: Doc, shotId: Id, videoId = mainVideo(d)?.id): (EdlItem & { id: Id }) | undefined {
  return edlOf(d, videoId).find((i) => i.kind === 'shot' && i.shot_id === shotId)
}

/** The take in the cut for a shot now (its item's pick), if any. */
export function currentTake(d: Doc, shotId: Id, videoId = mainVideo(d)?.id): Take | undefined {
  const item = edlItemFor(d, shotId, videoId)
  return item?.pick ? d.takes[item.pick.current] : undefined
}

/** A video's ad renders, oldest first, and the one picked. */
export function rendersOf(d: Doc, videoId = mainVideo(d)?.id): Render[] {
  return values(d.renders).filter((r) => r.video_id === videoId).sort((a, b) => a.version - b.version || byId(a, b))
}
export function currentRender(d: Doc, videoId = mainVideo(d)?.id): Render | undefined {
  const v = videoId ? d.videos[videoId] : undefined
  return v?.pick ? d.renders[v.pick.current] : rendersOf(d, videoId).at(-1)
}

/** Named references, in the order they were named. */
export function refsList(d: Doc): NamedRef[] {
  return values(d.refs).sort(byId)
}
export function keysList(d: Doc): KeyEntry[] {
  return values(d.keys).sort(byId)
}
/** The key entry for a key name. */
export function keyNamed(d: Doc, key: string): KeyEntry | undefined {
  return values(d.keys).find((k) => k.key === key)
}
/** The ref called key_variant. */
export function refNamed(d: Doc, name: string): NamedRef | undefined {
  return values(d.refs).find((r) => `${r.key}_${r.variant}` === name)
}
export const refName = (r: Pick<NamedRef, 'key' | 'variant'>) => `${r.key}_${r.variant}`

/** What a shot names, as @names: a key mention is the whole character (@maya), a ref one look (@maya_front). */
export function shotSubjects(d: Doc, shot: Shot): string[] {
  return (shot.refs ?? []).map((id) => {
    if (d.refs[id]) return refName(d.refs[id])
    if (d.keys[id]) return d.keys[id].key
    return null
  }).filter((x): x is string => !!x)
}

/** Jobs, oldest first. */
export function jobsList(d: Doc): DocJob[] {
  return values(d.jobs).sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : byId(a, b)))
}

export function assetsList(d: Doc): DocAsset[] {
  return values(d.assets)
}

export function reviewsList(d: Doc): Review[] {
  return values(d.reviews).sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : byId(a, b)))
}
/** The notes on one thing (a take, a frame, a ref). */
export function reviewsOn(d: Doc, kind: Review['target']['kind'], id: Id): Review[] {
  return reviewsList(d).filter((r) => r.target.kind === kind && r.target.id === id)
}

export function staleList(d: Doc): StaleMark[] {
  return values(d.stale).sort(byId)
}

/** Whether every shot is locked or waits for review: today's gate to the Video stage. */
export function storyboardReady(d: Doc): boolean {
  const shots = shotsOf(d)
  return shots.length > 0 && shots.every((s) => s.status === 'locked' || s.status === 'needs_review')
}

/** The total length of a storyboard's shots. */
export function storyboardSeconds(d: Doc, storyboardId = mainStoryboard(d)?.id): number {
  return shotsOf(d, storyboardId).reduce((a, s) => a + s.duration_s, 0)
}

/** Open asks, oldest first (ui-behaviour 3.17's questions pill). */
export function openAsks(d: Doc) {
  return values(d.asks).filter((a) => a.state === 'open').sort(byId)
}
