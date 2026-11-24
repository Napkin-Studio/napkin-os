// Reading a contract-3 document the way today's three panels need it
// (features/contract-v3.clan: "the port of today's panels through selectors").
//
// Every list in the document is an id-keyed map; order is rank. A new project
// has one script, one storyboard and one video, the script driving the
// storyboard and the storyboard rendering the video (clan-store create()).
// Today's panels work on those three; the selectors find them through the
// links, never by position.

import type {
  Beat, DocAsset, DocJob, Frame, Generation, GenerationSegment, Id, KeyEntry, NamedRef, ProductionDocument, Render, Review, Scene, Script, Shot,
  StaleMark, Storyboard, TimelineItem, Video,
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

/** The storyboard that renders the main video (its `renders` link), else the first one on the canvas. */
export function mainStoryboard(d: Doc): Storyboard | undefined {
  const v = mainVideo(d)
  const link = v && values(d.links).find((l) => l.role === 'renders' && l.to.kind === 'video' && l.to.id === v.id)
  return (link && d.storyboards[link.from.id]) || values(d.storyboards).filter((x) => !x.implicit).sort(byId)[0] || first(d.storyboards)
}

/**
 * A video's own shot list (ui-behaviour 3.5, decided 2026-10-15): a storyboard with `implicit` set holds the
 * shots of a video made straight from the script. It has no canvas node and renders exactly that video;
 * the Film editor shows and edits its shots. Make a storyboard from these shots clears the flag.
 */
export function isImplicit(sb: Pick<Storyboard, 'implicit'> | undefined): boolean {
  return !!sb?.implicit
}

/** The video a storyboard renders: a video's own shot list's video, else its first `renders` link's. */
export function videoOfStoryboard(d: Doc, storyboardId: Id | undefined): Video | undefined {
  if (!storyboardId) return undefined
  const own = d.storyboards[storyboardId]?.video_id
  if (own && d.videos[own]) return d.videos[own]
  return values(d.links).filter((l) => l.role === 'renders' && l.from.kind === 'storyboard' && l.from.id === storyboardId && l.to.kind === 'video')
    .map((l) => d.videos[l.to.id]).filter((v): v is Video => !!v).sort(byId)[0]
}

/** A video's own shot list, as a storyboard with no node (isImplicit), if it has one. */
export function ownShotsOf(d: Doc, videoId: Id | undefined): Storyboard | undefined {
  if (!videoId) return undefined
  return values(d.storyboards).filter((x) => x.implicit && x.video_id === videoId).sort(byId)[0]
}

/** The script behind a video's own shot list: the one that drives its video. */
function scriptOfImplicit(d: Doc, sb: Storyboard): Script | undefined {
  const v = videoOfStoryboard(d, sb.id)
  const link = v && values(d.links).find((l) => l.role === 'drives' && l.from.kind === 'script' && l.to.kind === 'video' && l.to.id === v.id)
  return link ? d.scripts[link.from.id] : undefined
}

/** The script that drives the main storyboard (its `drives` link), else the first. */
export function mainScript(d: Doc): Script | undefined {
  const sb = mainStoryboard(d)
  const link = sb && values(d.links).find((l) => l.role === 'drives' && l.to.kind === 'storyboard' && l.to.id === sb.id)
  return (link && d.scripts[link.from.id]) || (sb?.implicit ? scriptOfImplicit(d, sb) : undefined) || first(d.scripts)
}

/** The storyboard the Storyboard panel shows: the node opened on the canvas, else the main one. */
export function openStoryboard(d: Doc, open?: { storyboard?: Id }): Storyboard | undefined {
  return (open?.storyboard && d.storyboards[open.storyboard]) || mainStoryboard(d)
}

/** The video the Film panel shows: the node opened on the canvas, else the main one. */
export function openVideo(d: Doc, open?: { video?: Id }): Video | undefined {
  return (open?.video && d.videos[open.video]) || mainVideo(d)
}

/** The storyboard that renders a video (its `renders` link); the main video falls back to the main storyboard. */
export function storyboardOfVideo(d: Doc, videoId: Id | undefined): Storyboard | undefined {
  if (!videoId) return undefined
  const own = ownShotsOf(d, videoId)
  if (own) return own
  const link = values(d.links).find((l) => l.role === 'renders' && l.to.kind === 'video' && l.to.id === videoId)
  if (link) return d.storyboards[link.from.id]
  return videoId === mainVideo(d)?.id ? mainStoryboard(d) : undefined
}

/** The script that drives a storyboard (its `drives` link); the main storyboard falls back to the main script. */
export function scriptOfStoryboard(d: Doc, storyboardId: Id | undefined): Script | undefined {
  if (!storyboardId) return undefined
  const link = values(d.links).find((l) => l.role === 'drives' && l.to.kind === 'storyboard' && l.to.id === storyboardId && l.from.kind === 'script')
  if (link) return d.scripts[link.from.id]
  const sb = d.storyboards[storyboardId]
  if (sb?.implicit) return scriptOfImplicit(d, sb)
  return storyboardId === mainStoryboard(d)?.id ? mainScript(d) : undefined
}

/** The storyboard a script drives (its `drives` link); the main script falls back to the main storyboard. */
export function storyboardOfScript(d: Doc, scriptId: Id | undefined): Storyboard | undefined {
  if (!scriptId) return undefined
  // A video's own shot list is never a script's storyboard: Plan shots on the script makes one on the canvas.
  const link = values(d.links).find((l) => l.role === 'drives' && l.from.kind === 'script' && l.from.id === scriptId && l.to.kind === 'storyboard' && !d.storyboards[l.to.id]?.implicit)
  if (link) return d.storyboards[link.to.id]
  const main = scriptId === mainScript(d)?.id ? mainStoryboard(d) : undefined
  return main?.implicit ? undefined : main
}

/**
 * The video a shot's clips land in: `prefer` when that video is rendered from the shot's storyboard,
 * else the first video its storyboard renders, else (the main storyboard's shots) the main video.
 */
export function videoOfShot(d: Doc, shotId: Id, prefer?: Id): Video | undefined {
  const sb = d.shots[shotId]?.storyboard_id
  if (!sb) return undefined
  const own = d.storyboards[sb]?.implicit ? d.storyboards[sb]?.video_id : undefined
  if (own && d.videos[own]) return d.videos[own]
  const rendered = values(d.links).filter((l) => l.role === 'renders' && l.from.kind === 'storyboard' && l.from.id === sb && l.to.kind === 'video')
    .map((l) => d.videos[l.to.id]).filter((v): v is Video => !!v).sort(byId)
  const mainV = mainVideo(d)
  const ok = (v: Video | undefined) => !!v && (rendered.some((r) => r.id === v.id) || (v.id === mainV?.id && sb === mainStoryboard(d)?.id))
  if (prefer && ok(d.videos[prefer])) return d.videos[prefer]
  return rendered[0] ?? (sb === mainStoryboard(d)?.id ? mainV : undefined)
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

/** The words for a shot in a sentence: "shot 2", "the end card", or "a shot". The end card is never "shot 7": a box
 *  added before it took the number it had been called by (UAT round 3, R3-F13). */
export function shotName(d: Doc, shotId: Id | undefined): string {
  if (shotId && d.shots[shotId]?.kind === 'end_card') return 'the end card'
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

/** A canvas picture's versions (features/edit-canvas-pictures.clan), v1 first; none until its first edit. */
export function pictureVersions(d: Doc, nodeId: string): Frame[] {
  return values(d.frames).filter((f) => f.node === nodeId).sort((a, b) => a.version - b.version || byId(a, b))
}

/** The version a canvas picture shows: the latest picked (ties: the higher version); undefined before its first edit. */
export function currentPictureFrame(d: Doc, nodeId: string): Frame | undefined {
  let best: Frame | undefined
  for (const f of pictureVersions(d, nodeId)) {
    if (!best || (f.picked_at ?? '') >= (best.picked_at ?? '')) best = f
  }
  return best
}

/** The asset of the frame in the shot now. */
export function shotFrameAsset(d: Doc, shot: Shot | Id | undefined): string | undefined {
  return currentFrame(d, shot)?.asset
}

/** When a generation was made, for ordering: its created_at, then its id (ULIDs sort by time). */
const byMade = (a: Generation, b: Generation) => a.created_at.localeCompare(b.created_at) || byId(a, b)

/** A shot's takes: the ready generations that show it, oldest first (features/make-and-edit.clan). */
export function takesOf(d: Doc, shotId: Id): Generation[] {
  return values(d.generations).filter((g) => g.state === 'ready' && g.shot_ids.includes(shotId)).sort(byMade)
}

/** A take's number ("v2"), 1-based: its one version number (takeVersion), the Bin's; 0 when it does not show the shot. */
export function takeNumber(d: Doc, genId: Id | undefined, shotId: Id): number {
  return genId && takesOf(d, shotId).some((g) => g.id === genId) ? takeVersion(d, genId) : 0
}

/** The generations the Bin numbers as takes (rooms/model roomGens): not renders, uploads or combines. */
const NOT_TAKES = new Set<string>(['render', 'upload', 'combine'])
/** Oldest first, a take still being made last: the Bin's order (rooms/model newestFirst, reversed). */
const oldestTake = (a: Generation, b: Generation) =>
  (a.state === 'making') !== (b.state === 'making') ? (a.state === 'making' ? 1 : -1)
    : (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id)

/** The shots a take was made of, as one key: its box's run's shots (box_id), else its own (rooms/model boxKeyOf). */
export function madeKeyOf(d: Doc, g: Pick<Generation, 'shot_ids' | 'box_id'>): string {
  if (g.box_id) {
    for (const v of values(d.videos)) {
      const run = v.runs?.[g.box_id]
      if (run) return run.shot_ids.join(',')
    }
  }
  return g.shot_ids.join(',')
}

/** A take's one version number, everywhere (UAT round 3, F15 leftover: the Bin said "Box 1 · v1", the agent's note
 *  "take v2" and the zip "shot1-clip-v2" for the same take): v1…vn among the takes made of the same shots, oldest
 *  first. It is the Bin's (rooms/model numberAndLabel); the Bin, the notes, the sheet, History and the zip read it.
 *  0: not a take. */
export function takeVersion(d: Doc, genId: Id | undefined): number {
  const g = genId ? d.generations[genId] : undefined
  if (!g || NOT_TAKES.has(g.kind)) return 0
  const key = madeKeyOf(d, g)
  return values(d.generations).filter((x) => !NOT_TAKES.has(x.kind) && madeKeyOf(d, x) === key).sort(oldestTake).findIndex((x) => x.id === g.id) + 1
}

/** The version the next take made of these shots gets (a landing's note, before it lands). */
export function nextTakeVersion(d: Doc, like: Pick<Generation, 'shot_ids' | 'box_id'>): number {
  const key = madeKeyOf(d, like)
  return values(d.generations).filter((x) => !NOT_TAKES.has(x.kind) && madeKeyOf(d, x) === key).length + 1
}

/** Where a shot is in a generation made with other shots (a box made together); undefined for a lone shot. */
export function shotSegment(g: Pick<Generation, 'segments'> | undefined, shotId: Id | undefined): GenerationSegment | undefined {
  return shotId ? g?.segments?.find((s) => s.shot_id === shotId) : undefined
}

/** The model a generation was made on (its inputs' summary), '' when not known. */
export const genModel = (g: Pick<Generation, 'inputs'> | undefined) => g?.inputs?.model ?? ''

export type CutItem = TimelineItem & { id: Id }

/** A video's V1 clips (the main video's by default), in start order. */
export function cutOf(d: Doc, videoId = mainVideo(d)?.id): CutItem[] {
  const v = videoId ? d.videos[videoId] : undefined
  return Object.entries(v?.timeline ?? {}).filter(([, i]) => i.track === 'V1' && i.source)
    .map(([id, item]) => ({ ...item, id })).sort((a, b) => (a.start_s ?? 0) - (b.start_s ?? 0) || (a.id < b.id ? -1 : 1))
}

/** The V1 clip that stands for a shot in a video's cut, if the shot is in it. */
export function cutItemFor(d: Doc, shotId: Id, videoId = mainVideo(d)?.id): CutItem | undefined {
  return cutOf(d, videoId).find((i) => i.follows?.shot_id === shotId)
}

/** The take in the cut for a shot now: the generation its V1 clip plays, if any. */
export function currentTake(d: Doc, shotId: Id, videoId = mainVideo(d)?.id): Generation | undefined {
  const id = cutItemFor(d, shotId, videoId)?.source?.generation_id
  return id ? d.generations[id] : undefined
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

/** Whether every shot is locked or waits for review: today's gate to the Film stage. */
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
  return values(d.asks).filter((a) => a.state === 'open' && !supersededAsk(d, a)).sort(byId)
}

/** A plan's question that a later plan of the same node, now done, has answered by itself (UAT round 4 L4: "The script is
 *  empty…" stayed open after the storyboard was planned). */
export function supersededAsk(d: Doc, a: Doc['asks'][string]): boolean {
  const j = a.job_id ? d.jobs[a.job_id] : undefined
  if (!j || j.op !== 'shot_list') return false
  const later = values(d.jobs).filter((o) => o.id !== j.id && o.op === 'shot_list' && o.state === 'completed' && o.created_at > j.created_at)
  return later.some((o) => o.node?.id === j.node?.id) || answeredElsewhere(d, j.node?.id, later.map((o) => o.node?.id))
}

/** A storyboard no script drives (planned before there was a script: "The script is empty…") is answered once a storyboard
 *  a script drives has been planned since (UAT round 4 L4, local run: the question stayed on the first, empty Film). */
export function answeredElsewhere(d: Doc, sbId: string | undefined, plannedSince: readonly (string | undefined)[]): boolean {
  const driven = (id: string | undefined) => !!id && values(d.links).some((l) => l.role === 'drives' && l.to.kind === 'storyboard' && l.to.id === id)
  return !!sbId && !driven(sbId) && plannedSince.some((id) => id !== sbId && driven(id))
}
