// The Edit room's cut, as plain data the timeline edits (features/make-and-edit.clan, P2). A clip points at a
// take (a generation), never at a shot: its window of that take (in and out), where it sits (start), its
// speed, fades and the transition into it. V1 is magnetic: its clips abut, and a ripple edit moves everything
// after it. A dissolve or dip into a clip takes its overlap from the outgoing clip's footage after its out
// point (its last frame held when it has none), so the clips keep their places and the film its length
// (document.schema transitionIn). Text items sit on their own row. The end card is locked last on V1.
//
// Every function here is pure: it takes a cut and returns a new one. The rooms read and write the document
// through rooms/timeline.ts, which maps the contract's video.timeline to and from this shape.

export type TransitionKind = 'dissolve' | 'dip_black' | 'dip_white'
export interface Transition { kind: TransitionKind; s: number }
export type TextStyle = 'caption' | 'title' | 'super'

export interface CutClip {
  id: string
  /** The take (generation) the clip plays a window of. */
  genId: string
  /** The window of the take, in take seconds. */
  inS: number
  outS: number
  /** Where the clip starts on its track, in ad seconds. */
  startS: number
  /** At most MAX_SPEED. */
  speed: number
  /** The last frame held this long after the window (a swapped take a little shorter, at most HOLD_MAX_S). */
  holdS: number
  fadeInS: number
  fadeOutS: number
  /** The transition into this clip from the one before it on V1; absent is a cut. */
  transition?: Transition
  /** The box and shot this clip was cut from, so a new take of the box knows where it goes. */
  follows?: { boxId?: string; shotId?: string }
  /** V2 only. */
  opacity?: number
}

export interface CutText {
  id: string
  words: string
  style: TextStyle
  startS: number
  durS: number
  fadeInS: number
  fadeOutS: number
}

export interface CutEndCard {
  headline: string
  line: string
  cta?: string
  /** Its colour, #rrggbb. */
  bg: string
  logo?: string
  durS: number
  transition?: Transition
}

export interface Cut {
  v1: CutClip[]
  v2: CutClip[]
  text: CutText[]
  endCard?: CutEndCard
}

export const MAX_SPEED = 1.33
export const MIN_SPEED = 0.75
export const MAX_TRANSITION_S = 2
export const HOLD_MAX_S = 0.5
/** A clip is never trimmed shorter than this. */
export const MIN_CLIP_S = 0.2
export const EMPTY_CUT: Cut = { v1: [], v2: [], text: [] }

export const r3 = (x: number) => Math.round(x * 1000) / 1000
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

/** How long a clip plays on the timeline: its window at its speed, plus any held last frame. */
export function clipLen(c: Pick<CutClip, 'inS' | 'outS' | 'speed' | 'holdS'>): number {
  return r3((c.outS - c.inS) / (c.speed || 1) + (c.holdS || 0))
}

export const clipEnd = (c: CutClip) => r3(c.startS + clipLen(c))

/** V1 sorted by start. */
export function sortV1(v1: CutClip[]): CutClip[] {
  return [...v1].sort((a, b) => a.startS - b.startS || a.id.localeCompare(b.id))
}

/** V1 laid end to end from `from` (0 by default). */
export function pack(v1: CutClip[], from = 0): CutClip[] {
  let at = from
  return v1.map((c) => {
    const startS = r3(at)
    at = r3(startS + clipLen(c))
    return { ...c, startS }
  })
}

/** Where the end card starts: where the last V1 clip ends. */
export function endCardStart(cut: Cut): number {
  const last = sortV1(cut.v1).at(-1)
  return last ? clipEnd(last) : 0
}

/** The ad's length: the end of whatever ends last (V1, V2, text), with the end card after V1. */
export function cutLength(cut: Cut): number {
  const ends = [
    ...cut.v1.map(clipEnd), ...cut.v2.map(clipEnd), ...cut.text.map((t) => r3(t.startS + t.durS)),
    cut.endCard ? r3(endCardStart(cut) + cut.endCard.durS) : 0,
  ]
  return r3(Math.max(0, ...ends))
}

/** The fit badge: "Fits 10 s", "Over by 0.4 s" or "2 s short", against the film's target length. */
export function fitWords(lengthS: number, targetS: number | undefined): { words: string; ok: boolean } {
  const fmt = (s: number) => `${Math.round(s * 10) / 10} s`
  if (!targetS) return { words: fmt(lengthS), ok: true }
  const d = r3(lengthS - targetS)
  if (Math.abs(d) < 0.05) return { words: `Fits ${fmt(targetS)}`, ok: true }
  return d > 0 ? { words: `Over by ${fmt(d)}`, ok: false } : { words: `${fmt(lengthS)} · ${fmt(-d)} short`, ok: false }
}

const mapClip = (cut: Cut, id: string, fn: (c: CutClip) => CutClip): Cut => ({
  ...cut,
  v1: cut.v1.map((c) => (c.id === id ? fn(c) : c)),
  v2: cut.v2.map((c) => (c.id === id ? fn(c) : c)),
})

export function findClip(cut: Cut, id: string): { clip: CutClip; track: 'V1' | 'V2' } | undefined {
  const a = cut.v1.find((c) => c.id === id)
  if (a) return { clip: a, track: 'V1' }
  const b = cut.v2.find((c) => c.id === id)
  return b ? { clip: b, track: 'V2' } : undefined
}

/** Shift every V1 clip that starts at or after `fromS` (other than `except`) by `by` seconds. */
function rippleAfter(v1: CutClip[], fromS: number, by: number, except?: string): CutClip[] {
  if (!by) return v1
  return v1.map((c) => (c.id !== except && c.startS >= fromS - 1e-6 ? { ...c, startS: r3(Math.max(0, c.startS + by)) } : c))
}

/** What a trim may reach: the take's own length (`takeS`) bounds the out point. */
export interface TrimResult { cut: Cut; short?: boolean }

/**
 * Drag a clip's head to take time `inS`. With ripple (V1's default) the clip keeps its start and everything
 * after it moves; without, the clip's start moves and a gap opens (or closes) before it.
 */
export function trimHead(cut: Cut, id: string, inS: number, ripple: boolean): TrimResult {
  const f = findClip(cut, id)
  if (!f) return { cut }
  const c = f.clip
  const want = r3(clamp(inS, 0, c.outS - MIN_CLIP_S * c.speed))
  const short = inS < 0
  const lenBefore = clipLen(c)
  const next = { ...c, inS: want }
  const d = r3(clipLen(next) - lenBefore) // grows when the head moves left
  if (f.track === 'V1' && ripple) {
    const v1 = rippleAfter(cut.v1, clipEnd(c), d, c.id).map((x) => (x.id === c.id ? next : x))
    return { cut: { ...cut, v1 }, short }
  }
  // Without ripple a V1 clip may not run into the clip before it (V1 never overlaps).
  const floor = f.track === 'V1' ? neighbours(cut.v1, c).prevEnd : 0
  if (c.startS - d < floor - 1e-6) {
    const room = r3(c.startS - floor)
    return trimHead(cut, id, r3(c.inS - room * c.speed), false)
  }
  const moved = { ...next, startS: r3(Math.max(0, c.startS - d)) }
  return { cut: mapClip(cut, id, () => moved), short }
}

/** Where the clips either side of a V1 clip end and start. */
function neighbours(v1: CutClip[], c: CutClip): { prevEnd: number; nextStart: number } {
  const all = sortV1(v1)
  const i = all.findIndex((x) => x.id === c.id)
  return { prevEnd: i > 0 ? clipEnd(all[i - 1]) : 0, nextStart: i >= 0 && i < all.length - 1 ? all[i + 1].startS : Infinity }
}

/** Drag a clip's tail to take time `outS`, up to the take's length `takeS`. Past it: `short` (Make more?). */
export function trimTail(cut: Cut, id: string, outS: number, takeS: number, ripple: boolean): TrimResult {
  const f = findClip(cut, id)
  if (!f) return { cut }
  const c = f.clip
  const short = outS > takeS + 1e-6
  const want = r3(clamp(outS, c.inS + MIN_CLIP_S * c.speed, takeS))
  let next = { ...c, outS: want, holdS: 0 }
  const d = r3(clipLen(next) - clipLen(c))
  if (f.track === 'V1' && ripple) {
    const v1 = rippleAfter(cut.v1, clipEnd(c), d, c.id).map((x) => (x.id === c.id ? next : x))
    return { cut: { ...cut, v1 }, short }
  }
  // Without ripple a V1 clip may not run into the clip after it.
  const ceiling = f.track === 'V1' ? neighbours(cut.v1, c).nextStart : Infinity
  if (c.startS + clipLen(next) > ceiling + 1e-6) next = { ...next, outS: r3(c.inS + (ceiling - c.startS) * c.speed) }
  return { cut: mapClip(cut, id, () => next), short }
}

/** Split the clip under ad time `atS` into two (S). Fades stay on the outer ends; the second half is a cut. */
export function split(cut: Cut, id: string, atS: number, newId: string): Cut {
  const f = findClip(cut, id)
  if (!f) return cut
  const c = f.clip
  const into = r3(atS - c.startS)
  const body = r3((c.outS - c.inS) / c.speed)
  if (into < MIN_CLIP_S || into > body - MIN_CLIP_S) return cut
  const cutAt = r3(c.inS + into * c.speed)
  const a: CutClip = { ...c, outS: cutAt, holdS: 0, fadeOutS: 0 }
  const b: CutClip = { ...c, id: newId, inS: cutAt, startS: r3(c.startS + into), fadeInS: 0 }
  delete b.transition
  const track = f.track === 'V1' ? 'v1' : 'v2'
  const list = cut[track].flatMap((x) => (x.id === id ? [a, b] : [x]))
  return { ...cut, [track]: list }
}

/** Delete a clip. On V1 with ripple (Delete) the gap closes; without (Shift+Delete) it stays. */
export function removeClip(cut: Cut, id: string, ripple: boolean): Cut {
  const f = findClip(cut, id)
  if (!f) return cut
  if (f.track === 'V2') return { ...cut, v2: cut.v2.filter((c) => c.id !== id) }
  const c = f.clip
  const rest = cut.v1.filter((x) => x.id !== id)
  if (!ripple) return { ...cut, v1: rest }
  return { ...cut, v1: rippleAfter(rest, clipEnd(c), -clipLen(c)) }
}

/** Move a V1 clip to position `to` in V1's order; V1 closes up behind it (magnetic). */
export function moveV1(cut: Cut, id: string, to: number): Cut {
  const v1 = sortV1(cut.v1)
  const from = v1.findIndex((c) => c.id === id)
  if (from < 0) return cut
  const [c] = v1.splice(from, 1)
  v1.splice(clamp(to, 0, v1.length), 0, c)
  return { ...cut, v1: pack(v1, sortV1(cut.v1)[0]?.startS ?? 0) }
}

/** Fades, clamped to the clip's own length (and never past each other). */
export function setFades(cut: Cut, id: string, fades: { inS?: number; outS?: number }): Cut {
  return mapClip(cut, id, (c) => {
    const len = clipLen(c)
    const fadeInS = fades.inS === undefined ? c.fadeInS : r3(clamp(fades.inS, 0, len))
    const fadeOutS = fades.outS === undefined ? c.fadeOutS : r3(clamp(fades.outS, 0, len - fadeInS))
    return { ...c, fadeInS, fadeOutS }
  })
}

/** Why a transition into clip `id` cannot be `s` long: there is no clip before it, or the clip is shorter. */
export function transitionBlock(cut: Cut, id: string, s: number): string | undefined {
  const v1 = sortV1(cut.v1)
  const i = v1.findIndex((c) => c.id === id)
  if (i <= 0) return 'The first clip has nothing before it to dissolve from.'
  if (clipLen(v1[i]) < s) return `This clip is shorter than ${s} s. Choose a shorter transition.`
  return undefined
}

/** How much footage the clip before `id` lacks after its out point for the transition into `id` (its last
 *  frame is held for that long). `takeS`: the outgoing take's length. 0 when it has enough. */
export function handleShort(cut: Cut, id: string, takeS: (genId: string) => number): number {
  const v1 = sortV1(cut.v1)
  const i = v1.findIndex((c) => c.id === id)
  const t = v1[i]?.transition
  if (i <= 0 || !t) return 0
  const prev = v1[i - 1]
  const handle = Math.max(0, takeS(prev.genId) - prev.outS) / prev.speed
  return r3(Math.max(0, t.s - handle))
}

/** The transition into a V1 clip: a cut (undefined), a dissolve or a dip, up to 2 s. Nothing moves: the
 *  overlap comes from the clip before's footage after its out point. */
export function setTransition(cut: Cut, id: string, t: Transition | undefined): Cut {
  const c = cut.v1.find((x) => x.id === id)
  if (!c) return cut
  const next: Transition | undefined = t ? { kind: t.kind, s: r3(clamp(t.s, 0.1, MAX_TRANSITION_S)) } : undefined
  if (next && transitionBlock(cut, id, next.s)) return cut
  return mapClip(cut, id, (x) => {
    const n = { ...x }
    if (next) n.transition = next
    else delete n.transition
    return n
  })
}

/** The end card's transition (from the last clip). */
export function setEndCard(cut: Cut, patch: Partial<CutEndCard>): Cut {
  if (!cut.endCard) return cut
  return { ...cut, endCard: { ...cut.endCard, ...patch } }
}

export function addText(cut: Cut, t: CutText): Cut {
  return { ...cut, text: [...cut.text, t].sort((a, b) => a.startS - b.startS) }
}

export function updateText(cut: Cut, id: string, patch: Partial<Omit<CutText, 'id'>>): Cut {
  return {
    ...cut,
    text: cut.text.map((t) => {
      if (t.id !== id) return t
      const n = { ...t, ...patch }
      n.startS = r3(Math.max(0, n.startS))
      n.durS = r3(Math.max(0.3, n.durS))
      n.fadeInS = r3(clamp(n.fadeInS, 0, n.durS / 2))
      n.fadeOutS = r3(clamp(n.fadeOutS, 0, n.durS / 2))
      return n
    }).sort((a, b) => a.startS - b.startS),
  }
}

export function removeText(cut: Cut, id: string): Cut {
  return { ...cut, text: cut.text.filter((t) => t.id !== id) }
}

/** The clip under ad time `atS` on a track (the later one inside a transition). */
export function clipAt(clips: CutClip[], atS: number): CutClip | undefined {
  return sortV1(clips).filter((c) => atS >= c.startS - 1e-6 && atS < clipEnd(c) - 1e-6).at(-1)
}

// ── The swap rule (New take ready → Use this take) ─────────────────────────────────────────────────────

/** A take's window for one shot: where that shot sits in the take (the whole take for a lone shot). */
export interface ShotWindow { inS: number; outS: number }

export type SwapChoice = 'hold' | 'fit' | 'shorten'

export interface SwapPlan {
  /** Clip id → its new window and how it is fitted. */
  clips: { id: string; inS: number; outS: number; holdS: number; speed: number; shortBy: number }[]
  /** How much shorter the new window is than the old, at the most (0: as long or longer). */
  shortBy: number
  /** True when a choice must be asked for (shorter by more than HOLD_MAX_S). */
  ask: boolean
  /** The speed that would fit the longest gap, when Fit the speed can (at most MAX_SPEED). */
  fitSpeed?: number
}

/**
 * Map a clip's window through its shot's segment from the old take to the new one: the same offset into the
 * shot, the same length where the new take has it. `oldSeg` and `newSeg` are the shot's windows in each take.
 */
export function mapWindow(c: Pick<CutClip, 'inS' | 'outS'>, oldSeg: ShotWindow, newSeg: ShotWindow): { inS: number; outS: number; shortBy: number } {
  const offIn = Math.max(0, c.inS - oldSeg.inS)
  const want = c.outS - c.inS
  const inS = r3(Math.min(newSeg.inS + offIn, Math.max(newSeg.inS, newSeg.outS - MIN_CLIP_S)))
  const outS = r3(Math.min(inS + want, newSeg.outS))
  return { inS, outS, shortBy: r3(Math.max(0, want - (outS - inS))) }
}

/** What Use this take would do to `clips`, each with its shot's old and new windows. */
export function planSwap(clips: { clip: CutClip; oldSeg: ShotWindow; newSeg: ShotWindow }[]): SwapPlan {
  const out = clips.map(({ clip, oldSeg, newSeg }) => {
    const m = mapWindow(clip, oldSeg, newSeg)
    return { id: clip.id, inS: m.inS, outS: m.outS, holdS: 0, speed: clip.speed, shortBy: m.shortBy }
  })
  const shortBy = r3(Math.max(0, ...out.map((c) => c.shortBy)))
  const fit = out.filter((c) => c.shortBy > 0).map((c) => {
    const old = clips.find((x) => x.clip.id === c.id)!.clip
    const oldLen = clipLen(old) - old.holdS
    return (c.outS - c.inS) / Math.max(0.01, oldLen)
  })
  // Fit the speed slows the clip down to fill its slot, never below MIN_SPEED.
  const slow = fit.length ? Math.min(...fit) : 1
  return { clips: out, shortBy, ask: shortBy > HOLD_MAX_S + 1e-6, ...(fit.length && slow >= MIN_SPEED ? { fitSpeed: r3(slow) } : {}) }
}

/**
 * Use this take: every clip in `plan` now plays `genId`, at the same start, with the same fades and
 * transitions. A shorter window is fitted by `choice`: hold the last frame (the default up to 0.5 s), fit
 * the speed, or shorten the slot (which ripples V1, and is only ever chosen by the person).
 */
export function applySwap(cut: Cut, genId: string, plan: SwapPlan, choice: SwapChoice = 'hold'): Cut {
  let next = cut
  for (const p of plan.clips) {
    const f = findClip(next, p.id)
    if (!f) continue
    const c = f.clip
    const oldLen = clipLen(c)
    let upd: CutClip = { ...c, genId, inS: p.inS, outS: p.outS, holdS: 0 }
    if (p.shortBy > 0) {
      if (choice === 'hold') upd = { ...upd, holdS: r3(oldLen - (p.outS - p.inS) / c.speed) }
      else if (choice === 'fit') upd = { ...upd, speed: r3(Math.max(MIN_SPEED, (p.outS - p.inS) / Math.max(0.01, oldLen))) }
    }
    const d = r3(clipLen(upd) - oldLen)
    if (f.track === 'V1' && d !== 0 && choice === 'shorten') {
      next = { ...next, v1: rippleAfter(next.v1, clipEnd(c), d, c.id).map((x) => (x.id === c.id ? upd : x)) }
    } else {
      next = mapClip(next, c.id, () => upd)
    }
  }
  return next
}
