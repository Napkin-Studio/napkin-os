// The ad's target length, set from the Script editor (features/script-editor.clan, decision
// "target-length-lives-on-the-chain"; ui-behaviour 3.10's length meter). The target is one value
// along the chain a script drives: the script's own target_s, the storyboard it drives (what Dex
// plans to, jobs/plan.ts) and that storyboard's video (what the ad renders to). Setting it here
// writes all three in one draft, so one updateDoc is one undo step and every reader agrees.

import type { Id, ProductionDocument } from '../contracts/types'
import { videoOfStoryboard } from '../model/selectors'
import { TARGETS } from '../lib/shots'

type Doc = ProductionDocument

/** The contract's bounds on every target_s (document.schema.json: integer, 1–600). */
export const MIN_TARGET_S = 1
export const MAX_TARGET_S = 600

/** A typed length as the contract stores it: whole seconds, 1–600; null when it is not a number. */
export function cleanTarget(v: number | string): number | null {
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(/\s*s$/i, ''))
  if (!Number.isFinite(n)) return null
  return Math.min(MAX_TARGET_S, Math.max(MIN_TARGET_S, Math.round(n)))
}

/** The lengths offered: the common ad lengths, and the current one when it is not among them. */
export function lengthChoices(current: number): number[] {
  const all = new Set<number>([...TARGETS, current])
  return [...all].sort((a, b) => a - b)
}

/** Set the target on a script, the storyboard it shows (`storyboardId`) and that storyboard's video. */
export function setScriptTarget(d: Doc, scriptId: Id, storyboardId: Id | undefined, seconds: number) {
  const s = cleanTarget(seconds)
  if (s === null) return
  if (d.scripts[scriptId]) d.scripts[scriptId].target_s = s
  const sb = storyboardId ? d.storyboards[storyboardId] : undefined
  if (!sb) return
  sb.target_s = s
  const v = videoOfStoryboard(d, sb.id)
  if (v) d.videos[v.id].target_s = s
}
