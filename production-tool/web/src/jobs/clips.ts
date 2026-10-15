// Clips and the ad, as requests. Shared by the Video stage, "Fix it in the shot"
// (jobs/fix.ts) and "Update what follows" (jobs/follow.ts). The clip in a shot
// is its video's cut item for it (its edl pick: the video its storyboard renders,
// selectors videoOfShot); the ad is a render of a video (contract 3).

import type { ClipQuality, JobInput, ModelChoice, ProductionDocument, Shot, Take } from '../contracts/types'
import { DEFAULT_QUALITY, resolveQuality } from '../capabilities'
import type { JobPurpose } from '../model/purpose'
import { currentTake, mainVideo, shotsOf, storyboardOfVideo, videoOfShot } from '../model/selectors'
import { clipText } from '../lib/guard'
import { assetRef } from './assets'
import type { FrameDeps } from './frames'
import { selectedFrame } from './frames'
import { jobShot, mentionedPictures, namedInput, refsFor } from './select'
import { shotFromWords } from './clipMode'

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

/** The quality a video's clips are made at unless a send picks another (features/clip-quality.clan): the
 *  video's default, set in the Video editor's bar; standard when it has none. */
export function videoQuality(d: ProductionDocument, videoId: string | undefined): ClipQuality {
  return (videoId && d.videos[videoId]?.quality) || DEFAULT_QUALITY
}

/** The quality a shot's clips default to: its video's. */
export function shotQuality(d: ProductionDocument, shotId: string, videoId?: string): ClipQuality {
  return videoQuality(d, videoId ?? videoOfShot(d, shotId)?.id ?? mainVideo(d)?.id)
}

/** Where a shot's clip comes from: its picked frame, or (straight from the script, ui-behaviour 3.5) its words. */
export type ClipSource = 'frame' | 'words' | null

/** What a shot's clip would be made from now: its frame when it has one; its words when the video makes
 *  clips straight from the script and the shot has words; else nothing yet (null). */
export function clipSource(d: ProductionDocument, shotId: string, fromWords: boolean): ClipSource {
  const shot = d.shots[shotId]
  if (!shot) return null
  if (selectedFrame(d, shot.id)) return 'frame'
  return fromWords && (shot.action ?? '').trim() ? 'words' : null
}

/** The tray's one line, collapsed: "6 clips · 4 from frames, 2 from the script's words". */
export function traySummary(sources: ClipSource[]): string {
  const frames = sources.filter((s) => s === 'frame').length
  const words = sources.filter((s) => s === 'words').length
  const n = frames + words
  if (!n) return 'No clip can be made yet'
  const head = `${n} ${n === 1 ? 'clip' : 'clips'}`
  if (!words) return `${head} from ${frames === 1 ? 'its frame' : 'frames'}`
  if (!frames) return `${head} from the script's words, no frames`
  return `${head} · ${frames} from frames, ${words} from the script's words`
}

/**
 * A clip for a shot from its picked storyboard frame, on `modelChoice` when the participant picked one.
 * A shot with no frame yet in a video made straight from the script (ui-behaviour 3.5) is made from its
 * words alone (the model's text-to-video; the relay sends it to the sheet's textEndpoint). `fromWords`
 * overrides what the video says (absent: the video's clip mode, jobs/clipMode.ts).
 */
export async function makeClip(
  deps: FrameDeps,
  shotId: string,
  extra: { text?: string; reviewIds?: string[]; parentTake?: Take; followRun?: string; modelChoice?: ModelChoice; videoId?: string; fromWords?: boolean; quality?: ClipQuality } = {},
): Promise<string> {
  const d = deps.doc.get()
  const shot = d.shots[shotId]
  if (!shot) throw new Error('That shot is gone.')
  const frame = selectedFrame(d, shot.id)
  const fromWords = extra.fromWords ?? shotFromWords(d, shot.id, extra.videoId)
  const source = clipSource(d, shot.id, fromWords)
  if (!source) throw new Error(fromWords ? 'This shot has no frame and no words yet.' : 'This shot has no frame yet.')
  const image = frame ? await assetRef(deps.relay, frame.asset) : undefined
  const text = extra.text?.trim()
  const refs = await refsFor(deps.relay, d, shot, text, { offer: true, declined: deps.ui.get().declinedAdds?.[shot.id] })
  const ratio = ratioOf(d, videoOfShot(d, shot.id, extra.videoId)?.id, shot.storyboard_id)
  const input: JobInput = { shot: jobShot(d, shot), ...(image ? { image } : {}), ...(refs.length ? { refs } : {}), ...(ratio ? { ratio } : {}), ...(text ? { text: clipText(text, 1000) } : {}) }
  const purpose: JobPurpose = {
    for: 'clip',
    shotId: shot.id,
    ...(extra.parentTake ? { parentTakeId: extra.parentTake.id } : {}),
    ...(extra.reviewIds?.length ? { reviewIds: extra.reviewIds } : {}),
  }
  const parents = [frame?.job_id, extra.parentTake?.job_id].filter(Boolean) as string[]
  const quality = extra.quality ?? shotQuality(d, shot.id, extra.videoId)
  return deps.runner.submit('clip', input, parents, purpose, undefined, extra.modelChoice, { quality, ...(extra.followRun ? { local: { followRun: extra.followRun } } : {}) })
}

/**
 * Change the feel of a whole clip (clip_edit), on `modelChoice` when the participant picked one. The pictures
 * its words name go too (features/runway-video-models.clan): a model that edits with pictures (Kling O3,
 * Omni Flash 1.1, Seedance 2.5) puts them into the clip; Aleph 2 takes none and reads their names as words.
 */
export async function changeFeel(
  deps: Pick<FrameDeps, 'relay' | 'doc' | 'runner'>,
  shotId: string,
  take: Take,
  text: string,
  feel: JobInput['feel'],
  modelChoice?: ModelChoice,
  quality?: ClipQuality,
): Promise<string> {
  const d = deps.doc.get()
  const video = await assetRef(deps.relay, take.asset, d)
  const pictures = mentionedPictures(d, text).filter((r) => r.asset).slice(0, 14)
  const refs = await Promise.all(pictures.map((r) => namedInput(deps.relay, d, r)))
  // The clip's shape, so an edit that takes a size (Omni Flash 1.1) keeps it (features/clip-quality.clan).
  const ratio = ratioOf(d, videoOfShot(d, shotId)?.id, d.shots[shotId]?.storyboard_id)
  const input: JobInput = { video, text, ...(feel ? { feel } : {}), ...(refs.length ? { refs } : {}), ...(ratio ? { ratio } : {}) }
  return deps.runner.submit('clip_edit', input, [take.job_id], { for: 'clip', shotId, parentTakeId: take.id }, undefined, modelChoice,
    { quality: quality ?? shotQuality(d, shotId) })
}

/** An edit's level on the model shown (`shown`, the menu's pick or its first): the asked one, except on a
 *  model that keeps the clip's own size, where it is the clip's, so the relay prices it at the source's size. */
export function editQuality(take: Pick<Take, 'quality'>, shown: ModelChoice | undefined, asked: ClipQuality): ClipQuality {
  if (!shown) return asked
  const sized = resolveQuality('clip_edit', shown.provider, shown.model, asked)
  return sized.keepsSize || !sized.level ? (take.quality ?? DEFAULT_QUALITY) : asked
}

/** Remake as Final (features/clip-quality.clan): the draft take made again at Final with its own words,
 *  pictures and length, on the same model (its family's Final member). The relay reuses the draft's
 *  request; a Seedance 2.5 draft is made final by Runway itself. It lands as a new take of the draft. */
export async function remakeAsFinal(deps: Pick<FrameDeps, 'doc' | 'ui' | 'runner'>, take: Take): Promise<string> {
  const d = deps.doc.get()
  const op = d.jobs[take.job_id]?.op === 'clip_edit' ? 'clip_edit' : 'clip'
  const held = deps.ui.get().jobs[take.job_id]?.request
  return deps.runner.submit(op, held?.input ?? {}, [take.job_id], { for: 'clip', shotId: take.shot_id, parentTakeId: take.id }, undefined,
    held?.modelChoice, { quality: 'final', promoteFrom: take.job_id })
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
