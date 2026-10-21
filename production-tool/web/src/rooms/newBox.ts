// "+ New box" in the Make room (docs/production-tool/make-and-edit.md: "a dashed '+ New box' card ends the
// row"; owner 2026-10-21: make videos without a storyboard). A box is shots of the video's storyboard, so a
// new box is a new shot at the end of it: the storyboard that renders the video, else the video's own shot
// list (an implicit storyboard with video_id, no canvas node: prompt.ts ownShotList), made in the same step.
// The shot needs no frame. A start frame is a Bin picture linked in as the shot's frame (a ref→shot `frame`
// link, ui-behaviour 3.4); references are ref→shot links. With no frame, its Make sends a clip from its words and references (jobs/clips.ts
// makeClip fromWords, the relay's clip with refs and no frame). Each write here is one undo step, the person's.

import type { Id, Link, ProductionDocument, Shot } from '../contracts/types'
import { linkInput, unlinkInput } from '../canvas/nodes/nodes'
import { rankBetween } from '../../../clan-store/src'
import { updateDoc } from '../doc/store'
import type { DocumentStore } from '../doc/types'
import { writeJoins } from '../jobs/runView'
import { newId } from '../lib/ulid'
import { shotsOf, storyboardOfVideo } from '../model/selectors'
import { startPicture } from '../jobs/startFrame'

/** The length a new box's shot starts at. */
export const NEW_BOX_S = 5

function newShot(storyboardId: Id, rank: string): Shot {
  return { id: newId('shot'), v: 1, field_v: {}, storyboard_id: storyboardId, rank, kind: 'shot', duration_s: NEW_BOX_S, camera: { size: 'medium', movement: 'static' }, status: 'planned', action: '' }
}

/** The video's storyboard, made as its own shot list when it has none (inside the caller's write). */
function boardFor(x: ProductionDocument, videoId: Id): Id {
  const there = storyboardOfVideo(x, videoId)
  if (there) return there.id
  const v = x.videos[videoId]
  const id = newId('storyboard')
  x.storyboards[id] = { id, v: 1, field_v: {}, title: v.title || 'Video', ratio: v.ratio, target_s: v.target_s ?? 15, implicit: true, video_id: videoId }
  return id
}

/** + New box: one new shot after the others (before an end card), as its own box. Returns its id. */
export async function addBox(store: DocumentStore, videoId: Id): Promise<Id> {
  if (!store.get().videos[videoId]) throw new Error('This video is gone.')
  let made = ''
  await updateDoc(store, (x) => {
    const sb = boardFor(x, videoId)
    const shots = shotsOf(x, sb)
    const end = shots.findIndex((s) => s.kind === 'end_card')
    const before = end >= 0 ? shots[end - 1] : shots.at(-1)
    const after = end >= 0 ? shots[end] : undefined
    const s = newShot(sb, rankBetween(before?.rank ?? null, after?.rank ?? null))
    x.shots[s.id] = s
    made = s.id
  }, 'add a box')
  return made
}

/** "Several shots in one video": a shot after the box's last, made together with it (one box). Returns its id. */
export async function addShotToBox(store: DocumentStore, videoId: Id, boxShotIds: readonly Id[]): Promise<Id> {
  const d = store.get()
  const last = d.shots[boxShotIds.at(-1) ?? '']
  if (!last) throw new Error('That box is gone.')
  let made = ''
  await updateDoc(store, (x) => {
    const shots = shotsOf(x, last.storyboard_id)
    const next = shots[shots.findIndex((s) => s.id === last.id) + 1]
    const s = newShot(last.storyboard_id, rankBetween(last.rank, next?.rank ?? null))
    s.camera = { ...x.shots[last.id].camera }
    x.shots[s.id] = s
    made = s.id
    // One box: a continue into the new shot, a cut after it.
    writeJoins(x, videoId, [[s.id, 'continue'], ...(next ? [[next.id, 'cut'] as [Id, 'cut']] : [])])
  }, 'add a shot to the box')
  return made
}

/** The references chosen for a shot in its box: its own ref→shot links (3.4: a reference feeds a shot, many). */
export function shotRefLinks(d: ProductionDocument, shotId: Id): Link[] {
  return Object.values(d.links ?? {}).filter((l) => l.to.kind === 'shot' && l.to.id === shotId && (l.from.kind === 'ref' || l.from.kind === 'key') && !FRAME_ROLES.includes(l.role))
}

/** Add a reference to a shot (a ref→shot link with its role), within the model's limit. One undo step. */
export async function addShotRef(store: DocumentStore, shotId: Id, refId: Id, max: number): Promise<void> {
  const d = store.get()
  if (shotRefLinks(d, shotId).length >= max) throw new Error(`Up to ${max} references for this model.`)
  const r = await linkInput(store, d, { kind: 'ref', id: refId }, { kind: 'shot', id: shotId })
  if (!r.ok) throw new Error(r.reason)
}

/** Take a reference off a shot. One undo step. */
export const removeShotRef = (store: DocumentStore, linkId: Id) => unlinkInput(store, linkId)

const FRAME_ROLES: readonly string[] = ['frame', 'layout']

export { startPicture }

/** A start frame from a Bin picture (a named reference), or none: the shot's one `frame` link. One undo step. */
export async function setStartFrame(store: DocumentStore, shotId: Id, refId: Id | null) {
  await updateDoc(store, (x) => {
    if (!x.shots[shotId]) return
    for (const [id, l] of Object.entries(x.links)) if (l.to.kind === 'shot' && l.to.id === shotId && l.role === 'frame') delete x.links[id]
    if (!refId || !x.refs[refId]?.asset) return
    const link: Link = { id: newId('link'), v: 1, field_v: {}, from: { kind: 'ref', id: refId }, to: { kind: 'shot', id: shotId }, role: 'frame' }
    x.links[link.id] = link
  }, refId ? 'set the start frame' : 'clear the start frame')
}
