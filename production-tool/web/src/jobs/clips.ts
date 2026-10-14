// Clips and the ad, as requests. Shared by the Video stage, "Fix it in the shot"
// (jobs/fix.ts) and "Update what follows" (jobs/follow.ts). The clip in a shot
// is its video's cut item for it (its edl pick: the video its storyboard renders,
// selectors videoOfShot); the ad is a render of a video (contract 3).

import type { JobInput, ModelChoice, ProductionDocument, Shot, Take } from '../contracts/types'
import type { JobPurpose } from '../model/purpose'
import { currentTake, mainVideo, shotsOf, storyboardOfVideo, videoOfShot } from '../model/selectors'
import { clipText } from '../lib/guard'
import { assetRef } from './assets'
import type { FrameDeps } from './frames'
import { selectedFrame } from './frames'
import { jobShot, refsFor } from './select'

export { jobShot }

/** The take in the cut for a shot now (its edl item's pick, in `videoId`, else its own video). */
export function selectedTake(d: ProductionDocument, shotId: string, videoId?: string): Take | undefined {
  return currentTake(d, shotId, videoId ?? videoOfShot(d, shotId)?.id ?? mainVideo(d)?.id)
}

/** The ratio a clip or the ad is made at: the video's, else its storyboard's. */
function ratioOf(d: ProductionDocument, videoId: string | undefined, storyboardId?: string) {
  const v = videoId ? d.videos[videoId] : undefined
  return v?.ratio ?? (storyboardId ? d.storyboards[storyboardId]?.ratio : undefined) ?? storyboardOfVideo(d, v?.id)?.ratio
}

/** A clip for a shot from its picked storyboard frame, on `modelChoice` when the participant picked one. */
export async function makeClip(
  deps: FrameDeps,
  shotId: string,
  extra: { text?: string; reviewIds?: string[]; parentTake?: Take; followRun?: string; modelChoice?: ModelChoice; videoId?: string } = {},
): Promise<string> {
  const d = deps.doc.get()
  const shot = d.shots[shotId]
  if (!shot) throw new Error('That shot is gone.')
  const frame = selectedFrame(d, shot.id)
  if (!frame) throw new Error('This shot has no frame yet.')
  const image = await assetRef(deps.relay, frame.asset)
  const text = extra.text?.trim()
  const refs = await refsFor(deps.relay, d, shot, text)
  const ratio = ratioOf(d, videoOfShot(d, shot.id, extra.videoId)?.id, shot.storyboard_id)
  const input: JobInput = { shot: jobShot(d, shot), image, ...(refs.length ? { refs } : {}), ...(ratio ? { ratio } : {}), ...(text ? { text: clipText(text, 1000) } : {}) }
  const purpose: JobPurpose = {
    for: 'clip',
    shotId: shot.id,
    ...(extra.parentTake ? { parentTakeId: extra.parentTake.id } : {}),
    ...(extra.reviewIds?.length ? { reviewIds: extra.reviewIds } : {}),
  }
  const parents = [frame.job_id, extra.parentTake?.job_id].filter(Boolean) as string[]
  return deps.runner.submit('clip', input, parents, purpose, undefined, extra.modelChoice, extra.followRun ? { local: { followRun: extra.followRun } } : {})
}

/** The stitch request: every shot's clip in the cut, in shot order, cut to the shot's length. An end
 *  card shot's clip is marked endCard (the stitch adds its own card instead); one with no clip is left out. */
export async function stitchInput(deps: Pick<FrameDeps, 'relay' | 'doc'>, videoId?: string): Promise<{ input: JobInput; parents: string[] }> {
  const d = deps.doc.get()
  const video = (videoId && d.videos[videoId]) || mainVideo(d)
  const clips: NonNullable<JobInput['clips']> = []
  const parents: string[] = []
  const sb = storyboardOfVideo(d, video?.id)
  for (const [i, s] of (sb ? shotsOf(d, sb.id) : []).entries()) {
    const t = selectedTake(d, s.id, video?.id)
    if (!t && s.kind === 'end_card') continue
    if (!t) throw new Error(`Shot ${i + 1} has no clip yet.`)
    // Clips come back at the model's lengths (4, 6 or 8 s on veo3.1_fast), so each is
    // trimmed to its shot: the ad is the sum of the shots plus the end card (END_CARD_S).
    clips.push({ asset: await assetRef(deps.relay, t.asset, d), trimS: s.duration_s, ...(s.kind === 'end_card' ? { endCard: true } : {}) })
    parents.push(t.job_id)
  }
  const ratio = ratioOf(d, video?.id)
  return { input: { clips, ...(ratio ? { ratio } : {}) }, parents }
}

/** Render the ad of a video (absent: the main one) from the clips in its cut. */
export async function renderAd(deps: FrameDeps, opts: { followRun?: string; videoId?: string } = {}): Promise<string> {
  const { input, parents } = await stitchInput(deps, opts.videoId)
  const d = deps.doc.get()
  const other = opts.videoId && d.videos[opts.videoId] && opts.videoId !== mainVideo(d)?.id
  return deps.runner.submit('stitch', input, parents, other ? { for: 'stitch', videoId: opts.videoId } : { for: 'stitch' }, undefined, undefined, opts.followRun ? { local: { followRun: opts.followRun } } : {})
}

/** The end card the stitch adds after the clips: the 2.5 s roll-up card (stitch.py CARD_S). */
export const END_CARD_S = 2.5

/** How long the rendered ad is: the shots' lengths plus the end card. */
export function adLengthS(shots: Pick<Shot, 'duration_s'>[]): number {
  return shots.reduce((a, s) => a + s.duration_s, 0) + END_CARD_S
}
