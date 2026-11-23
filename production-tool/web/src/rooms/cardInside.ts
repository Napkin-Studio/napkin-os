// The studio card sits inside the length (UAT 2026-11-22: a "15 s" ad rendered 17.3 s, 15 s of film and the 2.5 s card
// stitch adds). When a film was cut to its target, Render ad speeds the clips so the film, the person's own end card and
// the studio card together last the target. Nothing else is touched: a film cut well away from its target (its fit badge
// says so) renders as it is cut, and so does one with no target.

import { r3 } from './cut'
import type { Plan } from './timeline'

/** The studio card stitch adds after the film (stitch.py CARD_S, jobs/clips.ts END_CARD_S). */
export const END_CARD_S = 2.5
/** A film counts as "cut to its target" within this many seconds of it. */
export const NEAR_TARGET_S = 0.5
/** The relay accepts a clip speed of 0.75 to 1.33 (relay-api TimelinePlan). */
export const MAX_SPEED = 1.33

export interface CardInside {
  plan: Plan
  /** The length the render will have (the studio card included). */
  renderS: number
  /** The factor the film's time was scaled by (below 1: sped up). */
  scale: number
  /** The clips could only be sped as far as the relay allows: the render is still longer than the target by this. */
  shortOfS: number
}

/** The plan to send, with the studio card inside `targetS`; undefined when the plan renders as it is. */
export function fitCardInside(plan: Plan, targetS: number | undefined): CardInside | undefined {
  if (!targetS || !plan.clips.length || plan.lengthS <= 0) return undefined
  if (Math.abs(plan.lengthS - targetS) > NEAR_TARGET_S) return undefined
  const own = plan.endCard?.s ?? 0
  const body = plan.lengthS - own
  if (body <= 0) return undefined
  const want = (targetS - END_CARD_S - own) / body
  if (!(want > 0) || want >= 1 - 1e-9) return undefined
  const floor = Math.max(...plan.clips.map((c) => c.speed ?? 1)) / MAX_SPEED
  const k = Math.max(want, floor)
  const scale = (t: number) => r3(t * k)
  const clips = plan.clips.map((c) => ({
    ...c,
    startS: scale(c.startS),
    speed: Math.round(((c.speed ?? 1) / k) * 1e6) / 1e6,
    ...(c.holdS ? { holdS: scale(c.holdS) } : {}),
    ...(c.fadeInS ? { fadeInS: scale(c.fadeInS) } : {}),
    ...(c.fadeOutS ? { fadeOutS: scale(c.fadeOutS) } : {}),
    ...(c.transitionIn ? { transitionIn: { ...c.transitionIn, s: scale(c.transitionIn.s) } } : {}),
    durS: scale(c.durS),
  }))
  const texts = plan.texts.map((t) => ({
    ...t, fromS: scale(t.fromS), toS: scale(t.toS),
    ...(t.fadeInS ? { fadeInS: scale(t.fadeInS) } : {}), ...(t.fadeOutS ? { fadeOutS: scale(t.fadeOutS) } : {}),
  }))
  const last = clips.at(-1)
  const lengthS = r3(Math.max(...clips.map((c) => c.startS + c.durS)) + own)
  const endCard = plan.endCard ? { ...plan.endCard, startS: last ? r3(last.startS + last.durS) : 0 } : undefined
  const renderS = r3(lengthS + END_CARD_S)
  return { plan: { ...plan, clips, texts, ...(endCard ? { endCard } : {}), lengthS }, renderS, scale: k, shortOfS: r3(Math.max(0, renderS - targetS)) }
}

/** The first-pass render (shots in order, each cut to its slot): the factor to scale every slot by so the shots and the studio
 *  card last `targetS`, or undefined when the shots are not within NEAR_TARGET_S of it or already leave room. */
export function trimScaleInside(slots: number[], targetS: number | undefined): number | undefined {
  const total = slots.reduce((a, b) => a + b, 0)
  if (!targetS || total <= 0 || Math.abs(total - targetS) > NEAR_TARGET_S) return undefined
  const k = (targetS - END_CARD_S) / total
  return k > 0 && k < 1 - 1e-9 ? k : undefined
}
