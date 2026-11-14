// The Edit room's writes (features/make-and-edit.clan): each is one edit of the cut through writeCut, so one
// History entry and one undo step, and never a paid job. The arithmetic is rooms/cut.ts's.

import type { ProductionDocument } from '../contracts/types'
import type { DocumentStore } from '../doc/types'
import { shotNumber } from '../model/selectors'
import {
  addText, applySwap, cutLength, moveV1, pack, planSwap, removeClip, removeText, setEndCard, setFades, setTransition, sortV1, split,
  trimHead, trimTail, updateText, type Cut, type CutClip, type CutEndCard, type CutText, type SwapChoice, type Transition,
} from './cut'
import { boxName, shotWindow, type Gen } from './model'
import type { RoomData } from './Rooms'
import { assemble, endCardFrom, newItemId, readCut, writeCut } from './timeline'

/** Clips for every shot of a take, at its cuts, in shot order: a box made together unpacks into one clip per shot. */
export function clipsOf(g: Gen, startS: number, boxId?: string): CutClip[] {
  const shots = g.segments.length ? g.segments.map((s) => s.shotId) : g.shotIds
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

/** Add to edit: the take's clips at the end of V1. */
export function appendTake(store: DocumentStore, d: ProductionDocument, data: RoomData, g: Gen) {
  const box = data.boxes.find((b) => b.key === g.boxKey)
  const boxId = d.generations[g.id]?.box_id
  return writeCut(store, data.videoId, `add ${box ? boxName(box).toLowerCase() : 'a take'} v${g.version} to the cut`, (cut) => {
    const end = cut.v1.length ? Math.max(...cut.v1.map((c) => c.startS + (c.outS - c.inS) / c.speed + c.holdS)) : 0
    return { ...cut, v1: sortV1([...cut.v1, ...clipsOf(g, end, boxId)]) }
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
