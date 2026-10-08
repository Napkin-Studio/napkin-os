// Clips and the ad, as requests. Shared by the Video stage, "Fix it in the shot"
// (jobs/fix.ts) and "Update what follows" (jobs/follow.ts).

import type { JobInput, ModelChoice, ProductionDocument, Shot, Take } from '../contracts/types'
import type { JobPurpose } from '../doc/ui'
import { assetRef } from './assets'
import type { FrameDeps } from './frames'
import { selectedFrame } from './frames'
import { jobShot, refsFor } from './select'

export { jobShot }

export function selectedTake(d: ProductionDocument, shotId: string): Take | undefined {
  return (d.takes ?? []).find((t) => t.shot_id === shotId && t.selected)
}

/** A clip for a shot from its selected storyboard frame, on `modelChoice` when the participant picked one. */
export async function makeClip(
  deps: FrameDeps,
  shotId: string,
  extra: { text?: string; reviewIds?: string[]; parentTake?: Take; purpose?: Partial<Extract<JobPurpose, { for: 'clip' }>>; modelChoice?: ModelChoice } = {},
): Promise<string> {
  const d = deps.doc.get()
  const shot = (d.shots ?? []).find((s) => s.id === shotId)
  if (!shot) throw new Error('That shot is gone.')
  const frame = selectedFrame(d, shot.id)
  const frameSha = frame?.asset ?? shot.storyboard_frame
  if (!frameSha) throw new Error('This shot has no frame yet.')
  const image = await assetRef(deps.relay, frameSha)
  const text = extra.text?.trim()
  const refs = await refsFor(deps.relay, d, shot, text)
  const input: JobInput = { shot: jobShot(shot), image, ...(refs.length ? { refs } : {}), ratio: deps.ui.get().ratio, ...(text ? { text: text.slice(0, 1000) } : {}) }
  const purpose: JobPurpose = {
    for: 'clip',
    shotId: shot.id,
    ...(extra.parentTake ? { parentTakeId: extra.parentTake.id } : {}),
    ...(extra.reviewIds?.length ? { reviewIds: extra.reviewIds } : {}),
    ...extra.purpose,
  }
  return deps.runner.submit('clip', input, [frame?.job_id, extra.parentTake?.job_id].filter(Boolean) as string[], purpose, undefined, extra.modelChoice)
}

/** The stitch request: every shot's selected clip in order, cut to the shot's length. */
export async function stitchInput(deps: Pick<FrameDeps, 'relay' | 'doc' | 'ui'>): Promise<{ input: JobInput; parents: string[] }> {
  const d = deps.doc.get()
  const clips: NonNullable<JobInput['clips']> = []
  const parents: string[] = []
  for (const s of d.shots ?? []) {
    const t = selectedTake(d, s.id)
    if (!t) throw new Error(`Shot ${s.order} has no clip yet.`)
    // Clips come back at the model's lengths (4, 6 or 8 s on veo3.1_fast), so each is
    // trimmed to its shot: the ad is the sum of the shots plus the 1 s end card.
    clips.push({ asset: await assetRef(deps.relay, t.asset), trimS: s.duration_s })
    parents.push(t.job_id)
  }
  return { input: { clips, ratio: deps.ui.get().ratio }, parents }
}

/** Render the ad from the selected clips. */
export async function renderAd(deps: FrameDeps, purpose: Partial<Extract<JobPurpose, { for: 'stitch' }>> = {}): Promise<string> {
  const { input, parents } = await stitchInput(deps)
  return deps.runner.submit('stitch', input, parents, { for: 'stitch', ...purpose })
}

/** The end card the stitch adds after the clips (stitch.py CARD_S). */
export const END_CARD_S = 1

/** How long the rendered ad is: the shots' lengths plus the end card. */
export function adLengthS(shots: Pick<Shot, 'duration_s'>[]): number {
  return shots.reduce((a, s) => a + s.duration_s, 0) + END_CARD_S
}
