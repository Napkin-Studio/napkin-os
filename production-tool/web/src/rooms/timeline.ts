// The cut in the document (video.timeline, features/make-and-edit.clan P2) and its one compiled plan. The Edit
// room reads the cut as rooms/cut.ts's plain shape and writes it back whole, one History entry and one undo
// step per edit. compileTimeline is the single plan both the preview (rooms/preview.ts) and Render ad read,
// so what plays is what renders. Edit never spends: nothing here starts a paid job.

import { newUlidId } from '../../../clan-store/src'
import { compileTimeline, type PlanClip as StorePlanClip, type PlanEndCard as StorePlanEndCard, type PlanText as StorePlanText, type TimelineItem as StoreTimelineItem } from '../../../clan-store/src'
import type { AssetRef, EndCard, Id, ProductionDocument, TimelineItem, TimelinePlan, TransitionIn } from '../contracts/types'
import { updateDoc } from '../doc/store'
import type { DocumentStore } from '../doc/types'
import { shotsOf, storyboardOfVideo } from '../model/selectors'
import {
  clipEnd, EMPTY_CUT, pack, r3, sortV1,
  type Cut, type CutClip, type CutEndCard, type CutText, type Transition,
} from './cut'
import { shotWindow, type Box, type Gen } from './model'

// ── The document's cut ↔ the plain cut ────────────────────────────────────────────────────────────────

function transitionOf(t: TransitionIn | undefined): Transition | undefined {
  return t && t.kind !== 'cut' ? { kind: t.kind, s: t.s ?? 0.5 } : undefined
}

/** The video's cut, as the timeline edits it. A video with no timeline yet has an empty cut. */
export function readCut(d: ProductionDocument, videoId: Id | undefined): Cut {
  const v = videoId ? d.videos[videoId] : undefined
  if (!v) return EMPTY_CUT
  const v1: CutClip[] = []
  const v2: CutClip[] = []
  const text: CutText[] = []
  for (const [id, it] of Object.entries(v.timeline ?? {})) {
    if (it.track === 'text') {
      const from = it.from_s ?? 0
      text.push({
        id, words: it.words ?? '', style: it.style ?? 'caption', startS: from, durS: r3(Math.max(0.3, (it.to_s ?? from + 2) - from)),
        fadeInS: it.fade_in_s ?? 0, fadeOutS: it.fade_out_s ?? 0,
      })
      continue
    }
    if (!it.source?.generation_id) continue
    const tr = transitionOf(it.transition_in)
    const c: CutClip = {
      id, genId: it.source.generation_id, inS: it.source.in_s, outS: it.source.out_s, startS: it.start_s ?? 0,
      speed: it.speed ?? 1, holdS: it.hold_s ?? 0, fadeInS: it.fade_in_s ?? 0, fadeOutS: it.fade_out_s ?? 0,
      ...(tr ? { transition: tr } : {}),
      ...(it.follows ? { follows: { ...(it.follows.box_id ? { boxId: it.follows.box_id } : {}), ...(it.follows.shot_id ? { shotId: it.follows.shot_id } : {}) } } : {}),
      ...(it.opacity !== undefined ? { opacity: it.opacity } : {}),
    }
    ;(it.track === 'V2' ? v2 : v1).push(c)
  }
  const card = v.end_card
  const ctr = transitionOf(card?.transition_in)
  const endCard: CutEndCard | undefined = card ? {
    headline: card.headline ?? '', line: card.line, ...(card.cta ? { cta: card.cta } : {}), bg: card.bg,
    ...(card.logo_asset ? { logo: card.logo_asset } : {}), durS: card.s, ...(ctr ? { transition: ctr } : {}),
  } : undefined
  return { v1: sortV1(v1), v2: sortV1(v2), text: text.sort((a, b) => a.startS - b.startS), ...(endCard ? { endCard } : {}) }
}

const omitZero = <K extends string>(k: K, v: number | undefined): Partial<Record<K, number>> => (v ? { [k]: r3(v) } as Record<K, number> : {})

/** The plain cut's items as the document keeps them (video.timeline). */
export function toTimeline(cut: Cut): Record<Id, TimelineItem> {
  const items: Record<Id, TimelineItem> = {}
  const clip = (c: CutClip, track: 'V1' | 'V2'): TimelineItem => ({
    track, start_s: r3(c.startS),
    source: { generation_id: c.genId, in_s: r3(c.inS), out_s: r3(c.outS) },
    ...(c.follows && (c.follows.boxId || c.follows.shotId) ? { follows: { ...(c.follows.boxId ? { box_id: c.follows.boxId } : {}), ...(c.follows.shotId ? { shot_id: c.follows.shotId } : {}) } } : {}),
    ...omitZero('fade_in_s', c.fadeInS), ...omitZero('fade_out_s', c.fadeOutS), ...omitZero('hold_s', c.holdS),
    ...(c.speed !== 1 ? { speed: r3(c.speed) } : {}),
    ...(c.transition ? { transition_in: { kind: c.transition.kind, s: r3(c.transition.s) } } : {}),
    ...(track === 'V2' && c.opacity !== undefined && c.opacity !== 1 ? { opacity: c.opacity } : {}),
  })
  for (const c of cut.v1) items[c.id] = clip(c, 'V1')
  for (const c of cut.v2) items[c.id] = clip(c, 'V2')
  for (const t of cut.text) {
    items[t.id] = {
      track: 'text', words: t.words.trim() || 'Text', style: t.style, from_s: r3(t.startS), to_s: r3(t.startS + t.durS),
      ...omitZero('fade_in_s', t.fadeInS), ...omitZero('fade_out_s', t.fadeOutS),
    }
  }
  return items
}

/** The plain end card as the document keeps it (video.end_card). */
export function toEndCard(e: CutEndCard): EndCard {
  return {
    ...(e.headline ? { headline: e.headline } : {}), line: e.line.trim() || e.headline || 'Your brand', ...(e.cta ? { cta: e.cta } : {}), bg: e.bg,
    ...(e.logo ? { logo_asset: e.logo } : {}), s: r3(Math.min(10, Math.max(0.5, e.durS))),
    ...(e.transition ? { transition_in: { kind: e.transition.kind, s: r3(e.transition.s) } } : {}),
  }
}

/** Write a cut into its video, item by item: unchanged items are left as they are (so two people's edits of
 *  different clips never meet), changed ones replaced, gone ones deleted. */
export function putCut(x: ProductionDocument, videoId: Id, cut: Cut) {
  const v = x.videos[videoId]
  if (!v) return
  const next = toTimeline(cut)
  const tl = (v.timeline ??= {})
  for (const id of Object.keys(tl)) if (!next[id]) delete tl[id]
  for (const [id, it] of Object.entries(next)) if (JSON.stringify(tl[id]) !== JSON.stringify(it)) tl[id] = it
  if (cut.endCard) {
    const e = toEndCard(cut.endCard)
    if (JSON.stringify(v.end_card) !== JSON.stringify(e)) v.end_card = e
  } else if (v.end_card) delete v.end_card
}

/** One edit of the cut: one History entry ("trim shot 2"), one undo step. */
export function writeCut(store: DocumentStore, videoId: Id, why: string, edit: (cut: Cut) => Cut) {
  return updateDoc(store, (x) => putCut(x, videoId, edit(readCut(x, videoId))), why)
}

export const newItemId = () => newUlidId('item')

// ── Assemble first cut ───────────────────────────────────────────────────────────────────────────────

/** The take a box puts in the first cut: its newest ready take. */
export function topTake(gens: Gen[], boxKey: string): Gen | undefined {
  return gens.find((g) => g.boxKey === boxKey && g.state === 'ready' && !!g.asset)
}

/**
 * The first cut: V1 from the boxes in storyboard order, each box's top take unpacked into one clip per shot at
 * its cuts (a box made together is several clips of the same take, joined by a bracket), and the end card
 * last. A box with no take yet is left out. Text items already on the cut stay.
 */
export function assemble(d: ProductionDocument, videoId: Id, boxes: Box[], gens: Gen[], ids: () => string = newItemId): Cut {
  const v1: CutClip[] = []
  for (const b of boxes) {
    if (b.endCard) continue
    const g = topTake(gens, b.key)
    if (!g) continue
    for (const shotId of b.shotIds) {
      const w = shotWindow(g, shotId)
      if (w.outS - w.inS <= 0) continue
      v1.push({ id: ids(), genId: g.id, inS: w.inS, outS: w.outS, startS: 0, speed: 1, holdS: 0, fadeInS: 0, fadeOutS: 0, follows: { boxId: b.key, shotId } })
    }
  }
  const before = readCut(d, videoId)
  return { v1: pack(v1), v2: [], text: before.text, endCard: before.endCard ?? endCardFrom(d, videoId) }
}

/** The end card from the storyboard's end card shot: its words as the headline, its length. */
export function endCardFrom(d: ProductionDocument, videoId: Id): CutEndCard | undefined {
  const sb = storyboardOfVideo(d, videoId)
  const shot = (sb ? shotsOf(d, sb.id) : []).find((s) => s.kind === 'end_card')
  if (!shot) return undefined
  // "SuperSamurai. Clean in one sweep.": the first sentence is the headline, the rest the line.
  const [head, ...rest] = (shot.action ?? '').trim().split(/(?<=[.!?])\s+/)
  const headline = (head ?? '').replace(/[.!?]$/, '').trim()
  const line = rest.join(' ').trim() || headline
  const named = d.project.title && !/^untitled/i.test(d.project.title) ? d.project.title : 'Your brand'
  return { headline: headline || named, line: line || named, bg: '#14161B', durS: shot.duration_s || 1.5 }
}

// ── New take ready ────────────────────────────────────────────────────────────────────────────────────

/** The ready takes of each box in the cut that are newer than the take its clips play: "New take ready". */
export function readyTakes(cut: Cut, gens: Gen[], dismissed: ReadonlySet<string> = NOT_NOW): Set<string> {
  const out = new Set<string>()
  for (const c of [...cut.v1, ...cut.v2]) {
    const n = newerTake(c, gens)
    if (n && !dismissed.has(`${c.genId}>${n.id}`)) out.add(n.id)
  }
  return out
}

/** The newest ready take of a clip's box that is newer than the one the clip plays. */
export function newerTake(c: CutClip, gens: Gen[]): Gen | undefined {
  const own = gens.find((g) => g.id === c.genId)
  if (!own) return undefined
  const newer = gens.filter((g) => g.boxKey === own.boxKey && g.state === 'ready' && g.id !== own.id && (g.createdAt ?? '') > (own.createdAt ?? ''))
  return newer[0]
}

/** "Not now", for this browser's session: the badge stays away until a newer take lands. */
const NOT_NOW = new Set<string>()
export function notNow(c: CutClip, take: Gen) { NOT_NOW.add(`${c.genId}>${take.id}`) }
export const dismissedTakes = (): ReadonlySet<string> => NOT_NOW

// ── compileTimeline: one plan for the preview and the render ─────────────────────────────────────────

/** A clip of the plan (clan-store compileTimeline's, the one plan the preview plays and stitch renders) with what
 *  the preview needs beside it: how long it lasts and how long its take is. */
export interface PlanClip extends StorePlanClip {
  durS: number
  /** The take's whole length: a transition out of this clip plays its footage after outS, up to here. */
  takeS: number
}
export interface PlanText extends StorePlanText { fadeInS?: number; fadeOutS?: number }
export interface PlanEndCard extends StorePlanEndCard { startS: number }
export interface Plan {
  clips: PlanClip[]
  texts: PlanText[]
  endCard?: PlanEndCard
  /** The film before the studio's roll-up: the last clip's end plus the end card. */
  lengthS: number
  /** Clips whose take has no footage yet: left out, and said. */
  missing: Id[]
}

/**
 * The one compiled plan of a video's timeline (clan-store compileTimeline): every V1 clip, text and the end card
 * at its ad time. The preview plays exactly this, and Render ad sends it as stitch's timeline (renderPlan).
 */
export function compileFor(d: ProductionDocument, videoId: Id): Plan {
  const v = d.videos[videoId]
  if (!v) return { clips: [], texts: [], lengthS: 0, missing: [] }
  const plan = compileTimeline({ timeline: v.timeline as Record<string, StoreTimelineItem>, ...(v.end_card ? { end_card: v.end_card } : {}) }, d.generations)
  const clips = plan.clips.map((c) => {
    const g = c.generation_id ? d.generations[c.generation_id] : undefined
    const speed = c.speed ?? 1
    return { ...c, durS: r3((c.outS - c.inS) / speed + (c.holdS ?? 0)), takeS: g?.duration_s ?? d.assets[c.sha256]?.duration_s ?? c.outS }
  })
  const last = clips.at(-1)
  const endCard = plan.endCard ? { ...plan.endCard, startS: last ? r3(last.startS + last.durS) : 0 } : undefined
  return { clips, texts: plan.texts, ...(endCard ? { endCard } : {}), lengthS: plan.lengthS, missing: plan.missing }
}

/** Render ad's request: the plan with each file named for the relay (relay-api TimelinePlan). */
export async function renderPlan(plan: Plan, ref: (sha: string) => Promise<AssetRef>): Promise<TimelinePlan> {
  const clips = []
  for (const c of plan.clips) {
    clips.push({
      asset: await ref(c.sha256), startS: c.startS, inS: c.inS, outS: c.outS,
      ...(c.speed !== undefined ? { speed: c.speed } : {}), ...(c.holdS ? { holdS: c.holdS } : {}),
      ...(c.fadeInS ? { fadeInS: c.fadeInS } : {}), ...(c.fadeOutS ? { fadeOutS: c.fadeOutS } : {}),
      ...(c.transitionIn ? { transitionIn: c.transitionIn } : {}),
    })
  }
  const texts = plan.texts.map((t) => ({ words: t.words, style: t.style, fromS: t.fromS, toS: t.toS, ...(t.fadeInS ? { fadeInS: t.fadeInS } : {}), ...(t.fadeOutS ? { fadeOutS: t.fadeOutS } : {}) }))
  const e = plan.endCard
  const endCard = e ? {
    ...(e.headline ? { headline: e.headline } : {}), line: e.line, ...(e.cta ? { cta: e.cta } : {}), bg: e.bg,
    ...(e.logo_sha256 ? { logo: await ref(e.logo_sha256) } : {}), s: e.s, ...(e.transitionIn ? { transitionIn: e.transitionIn } : {}),
  } : undefined
  return { clips, ...(texts.length ? { texts } : {}), ...(endCard ? { endCard } : {}), lengthS: plan.lengthS }
}

/** What shows at ad time `t`: the clip layers bottom to top (two inside a transition: the outgoing clip's
 *  footage after its out point under the incoming one), the text on screen, the end card, and a colour wash
 *  (a dip's darkest point is 1). The preview draws exactly this. */
export interface Frame {
  layers: { clip: PlanClip; srcS: number; alpha: number }[]
  text: { t: PlanText; alpha: number }[]
  endCard?: { card: PlanEndCard; alpha: number }
  wash: { colour: 'black' | 'white'; alpha: number }
}

/** Where in its take a clip is at ad time t (its last frame held after its window). */
export function sourceTime(c: Pick<PlanClip, 'startS' | 'inS' | 'outS' | 'speed'>, t: number): number {
  const into = Math.max(0, t - c.startS)
  return r3(Math.min(c.outS, c.inS + into * (c.speed ?? 1)))
}

const fadeAlpha = (into: number, len: number, fin: number, fout: number) => {
  let a = 1
  if (fin > 0 && into < fin) a = Math.min(a, into / fin)
  if (fout > 0 && into > len - fout) a = Math.min(a, Math.max(0, (len - into) / fout))
  return Math.max(0, Math.min(1, a))
}

export function frameAt(plan: Plan, t: number): Frame {
  const layers: Frame['layers'] = []
  let wash: Frame['wash'] = { colour: 'black', alpha: 0 }
  const cur = [...plan.clips].reverse().find((c) => t >= c.startS - 1e-6 && t < c.startS + c.durS - 1e-6)
  if (cur) {
    const into = t - cur.startS
    let alpha = fadeAlpha(into, cur.durS, cur.fadeInS ?? 0, cur.fadeOutS ?? 0)
    const tr = cur.transitionIn
    const i = plan.clips.indexOf(cur)
    const prev = i > 0 ? plan.clips[i - 1] : undefined
    if (tr && tr.s > 0 && into < tr.s && prev) {
      const k = into / tr.s
      // The outgoing clip carries on into its footage after its out point (its last frame when it has none).
      const handle = r3(Math.min(prev.takeS, prev.outS + into * (prev.speed ?? 1)))
      if (tr.kind === 'dissolve') {
        layers.push({ clip: prev, srcS: handle, alpha: 1 })
        alpha *= k
      } else {
        const colour = tr.kind === 'dip_white' ? 'white' : 'black'
        if (k < 0.5) { layers.push({ clip: prev, srcS: handle, alpha: 1 }); alpha = 0; wash = { colour, alpha: k * 2 } }
        else wash = { colour, alpha: (1 - k) * 2 }
      }
    }
    layers.push({ clip: cur, srcS: sourceTime(cur, t), alpha })
  }
  const text = plan.texts.filter((x) => t >= x.fromS && t < x.toS).map((x) => ({ t: x, alpha: fadeAlpha(t - x.fromS, x.toS - x.fromS, x.fadeInS ?? 0, x.fadeOutS ?? 0) }))
  const e = plan.endCard
  const endCard = e && t >= e.startS - 1e-6 && t < e.startS + e.s ? { card: e, alpha: e.transitionIn && e.transitionIn.s > 0 && t - e.startS < e.transitionIn.s ? (t - e.startS) / e.transitionIn.s : 1 } : undefined
  return { layers, text, ...(endCard ? { endCard } : {}), wash }
}

/** The clip under the playhead in words, for the transport: "Box 1 at 0:01.0". */
export function whereWords(plan: Plan, t: number, nameOf: (genId: Id) => string): string {
  const c = [...plan.clips].reverse().find((x) => t >= x.startS && t < x.startS + x.durS)
  if (!c) return plan.endCard && t >= plan.endCard.startS ? 'End card' : ''
  const s = sourceTime(c, t)
  return `${nameOf(c.generation_id ?? '')} at ${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`
}

export { clipEnd }
