// The Edit room's timeline arithmetic (features/make-and-edit.clan), pure and shared:
//
//   adTimeToSource   a moment of the ad (ad time) as the clip under it and the moment of its footage
//                    (source time): what 'Change this part…' maps a mark through. Twin: relay
//                    time_rules.ad_time_to_source; both pass contracts/examples/timeline.json.
//   compileTimeline  a video's timeline as the one plan the preview plays and stitch renders
//                    (relay-api TimelinePlan, with each clip's footage as its sha256 for the web to
//                    turn into an assetRef).
//
// A clip lasts (out_s - in_s) / speed + hold_s (integrity.ts itemLength). V1 is the film; V2 plays over
// it; text lies over both.

import { itemLength, type TimelineItemLike } from './integrity'

const r3 = (x: number) => Math.round(x * 1000) / 1000
const EPS = 1e-9

export interface TimelineItem extends TimelineItemLike {
  follows?: { box_id?: string; shot_id?: string }
  fade_in_s?: number
  fade_out_s?: number
  transition_in?: { kind: 'cut' | 'dissolve' | 'dip_black' | 'dip_white'; s?: number }
  opacity?: number
  words?: string
  style?: 'caption' | 'title' | 'super'
}
export interface EndCard { headline?: string; line: string; cta?: string; bg: string; logo_asset?: string; s: number; transition_in?: TimelineItem['transition_in'] }
export interface TimelineVideo { timeline: Record<string, TimelineItem>; end_card?: EndCard }

export interface SourceMoment {
  item_id: string
  track: 'V1' | 'V2'
  generation_id?: string
  asset?: string
  /** The moment of the clip's footage, in its generation's own time. */
  source_s: number
  /** True while the clip holds its last frame (hold_s): source_s is then its out_s. */
  held: boolean
  shot_id?: string
  box_id?: string
}

/**
 * The clip seen at ad time `adS` and the moment of its footage there: V2 over V1 (the one that starts
 * last, when two overlap), and at a cut the incoming clip (a clip's start is inside it, its end is not).
 * source_s = in_s + (adS - start_s) * speed, and out_s while the last frame is held. null over a gap, the
 * end card or past the end.
 */
export function adTimeToSource(timeline: Record<string, TimelineItem>, adS: number): SourceMoment | null {
  const under = (track: 'V1' | 'V2') => Object.entries(timeline)
    .filter(([, i]) => i.track === track && i.source && i.start_s !== undefined)
    .filter(([, i]) => adS >= i.start_s! - EPS && adS < i.start_s! + itemLength(i) - EPS)
    .sort(([ak, a], [bk, b]) => b.start_s! - a.start_s! || (ak < bk ? 1 : -1))[0]
  const hit = under('V2') ?? under('V1')
  if (!hit) return null
  const [id, item] = hit
  const src = item.source!
  const into = Math.max(0, adS - item.start_s!) * (item.speed ?? 1)
  const held = src.in_s + into > src.out_s + EPS
  return {
    item_id: id,
    track: item.track as 'V1' | 'V2',
    ...(src.generation_id ? { generation_id: src.generation_id } : {}),
    ...(src.asset ? { asset: src.asset } : {}),
    source_s: r3(held ? src.out_s : src.in_s + into),
    held,
    ...(item.follows?.shot_id ? { shot_id: item.follows.shot_id } : {}),
    ...(item.follows?.box_id ? { box_id: item.follows.box_id } : {}),
  }
}

/** One clip of a compiled plan: TimelinePlan.clips with its footage as a sha256 (and where it came from). */
export interface PlanClip {
  item_id: string
  generation_id?: string
  sha256: string
  startS: number
  inS: number
  outS: number
  speed?: number
  holdS?: number
  fadeInS?: number
  fadeOutS?: number
  transitionIn?: { kind: 'dissolve' | 'dip_black' | 'dip_white'; s: number }
}
export interface PlanText { item_id: string; words: string; style: 'caption' | 'title' | 'super'; fromS: number; toS: number; fadeInS?: number; fadeOutS?: number }
export interface PlanEndCard { headline?: string; line: string; cta?: string; bg: string; logo_sha256?: string; s: number; transitionIn?: PlanClip['transitionIn'] }
export interface CompiledTimeline {
  clips: PlanClip[]
  texts: PlanText[]
  endCard?: PlanEndCard
  /** The film before the studio's roll-up card: the last V1 clip's end plus the end card. */
  lengthS: number
  /** V1 clips left out because their generation has no footage yet (making, failed or gone). */
  missing: string[]
}

/** The default length of a dissolve or dip whose length is not set (stitch TRANSITION_S). */
export const TRANSITION_S = 0.5

function transitionOf(t: TimelineItem['transition_in']): PlanClip['transitionIn'] | undefined {
  if (!t || t.kind === 'cut') return undefined
  const s = t.s ?? TRANSITION_S
  return s > 0 ? { kind: t.kind, s } : undefined
}

/**
 * A video's timeline as one plan: V1's clips in start order with their footage, the texts in time order,
 * the end card after the last clip, and the film's length. The preview plays this plan and stitch renders
 * it (relay-api TimelinePlan: the web turns each sha256 into an assetRef), so they never drift. V2 joins in
 * P3. A clip whose generation has no footage is left out and named in `missing`.
 */
export function compileTimeline(
  video: TimelineVideo,
  generations: Record<string, { asset?: string; state?: string }>,
): CompiledTimeline {
  const clips: PlanClip[] = []
  const missing: string[] = []
  const v1 = Object.entries(video.timeline ?? {})
    .filter(([, i]) => i.track === 'V1' && i.source && i.start_s !== undefined)
    .sort(([ak, a], [bk, b]) => a.start_s! - b.start_s! || (ak < bk ? -1 : 1))
  let end = 0
  for (const [id, i] of v1) {
    const src = i.source!
    const g = src.generation_id ? generations[src.generation_id] : undefined
    const sha = src.asset ?? (g?.state === 'ready' || (g && g.state === undefined) ? g.asset : undefined)
    if (!sha) {
      missing.push(id)
      continue
    }
    const transition = transitionOf(i.transition_in)
    clips.push({
      item_id: id,
      ...(src.generation_id ? { generation_id: src.generation_id } : {}),
      sha256: sha,
      startS: r3(i.start_s!),
      inS: src.in_s,
      outS: src.out_s,
      ...(i.speed !== undefined && i.speed !== 1 ? { speed: i.speed } : {}),
      ...(i.hold_s ? { holdS: i.hold_s } : {}),
      ...(i.fade_in_s ? { fadeInS: i.fade_in_s } : {}),
      ...(i.fade_out_s ? { fadeOutS: i.fade_out_s } : {}),
      ...(transition && clips.length ? { transitionIn: transition } : {}),
    })
    end = Math.max(end, i.start_s! + itemLength(i))
  }
  const texts: PlanText[] = Object.entries(video.timeline ?? {})
    .filter(([, i]) => i.track === 'text' && i.words && i.style && i.from_s !== undefined && i.to_s !== undefined)
    .sort(([ak, a], [bk, b]) => a.from_s! - b.from_s! || (ak < bk ? -1 : 1))
    .map(([id, i]) => ({
      item_id: id, words: i.words!, style: i.style!, fromS: i.from_s!, toS: i.to_s!,
      ...(i.fade_in_s ? { fadeInS: i.fade_in_s } : {}),
      ...(i.fade_out_s ? { fadeOutS: i.fade_out_s } : {}),
    }))
  const card = video.end_card
  let endCard: PlanEndCard | undefined
  if (card) {
    const transition = transitionOf(card.transition_in)
    endCard = {
      ...(card.headline ? { headline: card.headline } : {}),
      line: card.line,
      ...(card.cta ? { cta: card.cta } : {}),
      bg: card.bg,
      ...(card.logo_asset ? { logo_sha256: card.logo_asset } : {}),
      s: card.s,
      ...(transition && clips.length ? { transitionIn: transition } : {}),
    }
  }
  return { clips, texts, ...(endCard ? { endCard } : {}), lengthS: r3(end + (card?.s ?? 0)), missing }
}
