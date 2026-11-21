// The Edit room's writes (features/make-and-edit.clan): each is one edit of the cut through writeCut, so one
// History entry and one undo step, and never a paid job. The arithmetic is rooms/cut.ts's.

import type { ProductionDocument } from '../contracts/types'
import type { DocumentStore } from '../doc/types'
import { shotNumber } from '../model/selectors'
import {
  addText, applySwap, cutLength, moveV1, pack, planSwap, removeClip, removeText, setEndCard, setFades, setTransition, sortV1, split,
  trimHead, trimTail, updateText, type Cut, type CutClip, type CutEndCard, type CutText, type SwapChoice, type Transition,
} from './cut'
import { boxName, inBox, shotWindow, type Box, type Gen } from './model'
import type { RoomData } from './Rooms'
import { assemble, endCardFrom, newItemId, placedWords, placeTakeInCut, putCut, readCut, writeCut } from './timeline'
import { updateDoc } from '../doc/store'
import type { UiStore } from '../projects/uiStore'

/** Clips for every shot of a take, at its cuts, in shot order: a box made together unpacks into one clip per shot.
 *  `only`: just those shots' windows (a box made apart from the take adds its own shots, not the whole take). */
export function clipsOf(g: Gen, startS: number, boxId?: string, only?: readonly string[]): CutClip[] {
  const shots = (g.segments.length ? g.segments.map((s) => s.shotId) : g.shotIds).filter((id) => !only || only.includes(id))
  const out: CutClip[] = []
  let at = startS
  for (const shotId of shots) {
    const w = shotWindow(g, shotId)
    if (w.outS - w.inS <= 0.04) continue
    out.push({ id: newItemId(), genId: g.id, inS: w.inS, outS: w.outS, startS: at, speed: 1, holdS: 0, fadeInS: 0, fadeOutS: 0, follows: { ...(boxId ? { boxId } : {}), shotId } })
    at += w.outS - w.inS
  }
  return out
}

/** Add to edit: the take's clips at the end of V1; from a box that holds only some of its shots (made apart
 *  since), just that box's shots. */
export function appendTake(store: DocumentStore, d: ProductionDocument, data: RoomData, g: Gen, from?: Box) {
  const box = from && inBox(g, from.key) ? from : data.boxes.find((b) => b.key === g.boxKey)
  const only = box && box.key !== g.boxKey ? box.shotIds : undefined
  const boxId = d.generations[g.id]?.box_id
  return writeCut(store, data.videoId, `add ${box ? boxName(box).toLowerCase() : 'a take'} v${g.version} to the cut`, (cut) => {
    const end = cut.v1.length ? Math.max(...cut.v1.map((c) => c.startS + (c.outS - c.inS) / c.speed + c.holdS)) : 0
    return { ...cut, v1: sortV1([...cut.v1, ...clipsOf(g, end, boxId, only)]) }
  })
}

/** Assemble first cut: V1 from the boxes in storyboard order, each box's newest take, and the end card last. */
export function assembleFirstCut(store: DocumentStore, data: RoomData) {
  return writeCut(store, data.videoId, 'assemble the first cut', (_cut) => {
    const d = store.get()
    const next = assemble(d, data.videoId, data.boxes, data.gens)
    // The box a clip stands for is the run its take was made for, when there is one.
    for (const c of next.v1) {
      const boxId = d.generations[c.genId]?.box_id
      c.follows = { ...(boxId ? { boxId } : {}), ...(c.follows?.shotId ? { shotId: c.follows.shotId } : {}) }
    }
    return next
  })
}

const shotWords = (d: ProductionDocument, c: CutClip | undefined) => (c?.follows?.shotId ? `shot ${shotNumber(d, c.follows.shotId)}` : 'a clip')

export const editCut = {
  trimHead: (store: DocumentStore, videoId: string, c: CutClip, inS: number, ripple: boolean) =>
    writeCut(store, videoId, `trim the head of ${shotWords(store.get(), c)}`, (cut) => trimHead(cut, c.id, inS, ripple).cut),
  trimTail: (store: DocumentStore, videoId: string, c: CutClip, outS: number, takeS: number, ripple: boolean) =>
    writeCut(store, videoId, `trim the tail of ${shotWords(store.get(), c)}`, (cut) => trimTail(cut, c.id, outS, takeS, ripple).cut),
  split: (store: DocumentStore, videoId: string, c: CutClip, atS: number) =>
    writeCut(store, videoId, `split ${shotWords(store.get(), c)}`, (cut) => split(cut, c.id, atS, newItemId())),
  remove: (store: DocumentStore, videoId: string, c: CutClip, ripple: boolean) =>
    writeCut(store, videoId, `remove ${shotWords(store.get(), c)} from the cut${ripple ? '' : ', leaving a gap'}`, (cut) => removeClip(cut, c.id, ripple)),
  move: (store: DocumentStore, videoId: string, c: CutClip, to: number) =>
    writeCut(store, videoId, `move ${shotWords(store.get(), c)}`, (cut) => moveV1(cut, c.id, to)),
  fades: (store: DocumentStore, videoId: string, c: CutClip, f: { inS?: number; outS?: number }) =>
    writeCut(store, videoId, `fade ${shotWords(store.get(), c)}`, (cut) => setFades(cut, c.id, f)),
  transition: (store: DocumentStore, videoId: string, c: CutClip, t: Transition | undefined) =>
    writeCut(store, videoId, `${t ? (t.kind === 'dissolve' ? 'dissolve' : 'dip') : 'cut'} into ${shotWords(store.get(), c)}`, (cut) => setTransition(cut, c.id, t)),
  speed: (store: DocumentStore, videoId: string, c: CutClip, speed: number) =>
    writeCut(store, videoId, `set the speed of ${shotWords(store.get(), c)}`, (cut) => ({ ...cut, v1: cut.v1.map((x) => (x.id === c.id ? { ...x, speed: Math.min(1.33, Math.max(0.75, speed)) } : x)) })),
  addText: (store: DocumentStore, videoId: string, t: Omit<CutText, 'id'>) => {
    const id = newItemId()
    return writeCut(store, videoId, 'add text', (cut) => addText(cut, { ...t, id })).then(() => id)
  },
  text: (store: DocumentStore, videoId: string, id: string, patch: Partial<Omit<CutText, 'id'>>) =>
    writeCut(store, videoId, 'edit text', (cut) => updateText(cut, id, patch)),
  removeText: (store: DocumentStore, videoId: string, id: string) => writeCut(store, videoId, 'remove text', (cut) => removeText(cut, id)),
  endCard: (store: DocumentStore, videoId: string, patch: Partial<CutEndCard>) =>
    writeCut(store, videoId, 'edit the end card', (cut) => (cut.endCard ? setEndCard(cut, patch) : { ...cut, endCard: { ...(endCardFrom(store.get(), videoId) ?? { headline: '', line: 'Your brand', bg: '#14161B', durS: 1.5 }), ...patch } })),
  removeEndCard: (store: DocumentStore, videoId: string) => writeCut(store, videoId, 'remove the end card', (cut) => {
    const next = { ...cut }
    delete next.endCard
    return next
  }),
  /** Use this take: the clips of the old take in this box (or just `clipIds`) now play `g`, keeping their places,
   *  trims, fades and transitions; a shorter window is fitted by `choice`. */
  swap: (store: DocumentStore, videoId: string, g: Gen, oldGen: Gen, clipIds: string[], choice: SwapChoice) =>
    writeCut(store, videoId, `use take v${g.version} in the cut`, (cut) => applySwap(cut, g.id, swapPlanFor(cut, g, oldGen, clipIds), choice)),
}

/** The swap plan for the clips `clipIds` of `oldGen` in the cut, mapped through each one's shot into `g`. */
export function swapPlanFor(cut: Cut, g: Gen, oldGen: Gen, clipIds: string[]) {
  const clips = [...cut.v1, ...cut.v2].filter((c) => clipIds.includes(c.id) && c.genId === oldGen.id)
  return planSwap(clips.map((c) => ({ clip: c, oldSeg: shotWindow(oldGen, c.follows?.shotId), newSeg: shotWindow(g, c.follows?.shotId) })))
}

/** The film's length now. */
export const cutLengthOf = (d: ProductionDocument, videoId: string) => cutLength(readCut(d, videoId))

export { pack }

/** The V1 items of a video as the document keeps them, by id. */
const v1Items = (d: ProductionDocument, videoId: string) =>
  Object.fromEntries(Object.entries(d.videos[videoId]?.timeline ?? {}).filter(([, it]) => it.track === 'V1'))

/** JSON with its keys in order, so the same cut reads the same after a save or a redo put its keys in another order
 *  (UAT round 3, F12 leftover: the note's Undo said "The cut has changed since" when nothing had). */
export function sameJson(x: unknown): string {
  return JSON.stringify(x, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v))
}

/**
 * A take has landed in the rooms (jobs/wire.ts): a joined take goes into the cut in place of its shots' clips, and a
 * box's first take, when a cut exists and none of its shots is in it, at its storyboard place (UAT round 3, R3-F4)
 * (timeline.placeTakeInCut). One History entry and one undo step by Edie, and the rooms say so with Undo
 * (ui.joinedInCut). Nothing when the cut already plays a take of those shots: a new take of a box in the cut is
 * offered as New take ready.
 */
export async function placeJoinedTake(store: DocumentStore, ui: UiStore, videoId: string, jobId: string): Promise<boolean> {
  const d = store.get()
  const g = Object.values(d.generations ?? {}).find((x) => x.job_id === jobId)
  if (!g) return false
  const next = placeTakeInCut(d, videoId, g.id)
  if (!next) return false
  const before = v1Items(d, videoId)
  const text = placedWords(d, g.id)
  const joined = (g.segments?.length ?? 0) > 1
  await store.change((x) => putCut(x, videoId, next), {
    action: `put ${text.replace(/ is in the cut\.$/, '').replace(/^Joined/, 'the joined').replace(/^Shot/, 'shot').replace(/^The/, 'the')} into the cut`, agent: 'edie', undo: true,
    rationale: joined ? 'The joined take replaces the separate clips of its shots, in the same place; the rest of the cut is as it was.'
      : 'The box had no clip in the cut: its first take goes in at its place in the storyboard, and the clips after it move later.',
  })
  const after = sameJson(v1Items(store.get(), videoId))
  ui.update((u) => { u.joinedInCut = { videoId, genId: g.id, text, before, after } }, 'take in the cut')
  return true
}

/** Undo on the note: the V1 clips put back as they were, while the cut is still as Edie left it. False when the
 *  cut changed since (the bar's Undo steps back through those changes first). */
export async function undoJoinedTake(store: DocumentStore, ui: UiStore): Promise<boolean> {
  const j = ui.get().joinedInCut
  if (!j) return false
  await store.flush()
  if (sameJson(v1Items(store.get(), j.videoId)) !== j.after && JSON.stringify(v1Items(store.get(), j.videoId)) !== j.after) return false
  // The placement is the person's last undo step: take it back through the store's undo, so the bar's Redo puts it
  // in again (UAT 2026-11-21, F12: the note's Undo wrote a new change, and Redo said "Nothing to redo").
  const label = store.undoLabels?.().undo
  if (store.undo && label && /^put .+ into the cut$/i.test(label)) {
    await store.undo()
    ui.update((u) => { delete u.joinedInCut }, 'joined take note')
    return true
  }
  await updateDoc(store, (x) => {
    const tl = x.videos[j.videoId]?.timeline
    if (!tl) return
    for (const [id, it] of Object.entries(tl)) if (it.track === 'V1') delete tl[id]
    for (const [id, it] of Object.entries(j.before)) tl[id] = structuredClone(it)
  }, 'take the placed take out of the cut again')
  ui.update((u) => { delete u.joinedInCut }, 'joined take note')
  return true
}

/** How many V1 clips carry an edit Assemble first cut again would lose: a trim (a window that is not its shot's
 *  window of its take), a fade, a transition, a speed or a hold, or a clip that stands for no shot (added by
 *  hand). UAT 2026-11-21: Assemble again dropped the person's trims without a word. */
export function assembleLoses(cut: Cut, gens: Gen[]): number {
  let n = 0
  for (const c of cut.v1) {
    const g = gens.find((x) => x.id === c.genId)
    const shotId = c.follows?.shotId
    const w = g && shotId ? shotWindow(g, shotId) : undefined
    const trimmed = !w || Math.abs(w.inS - c.inS) > 0.01 || Math.abs(w.outS - c.outS) > 0.01
    if (trimmed || c.fadeInS > 0 || c.fadeOutS > 0 || !!c.transition || c.speed !== 1 || c.holdS > 0) n++
  }
  return n
}
