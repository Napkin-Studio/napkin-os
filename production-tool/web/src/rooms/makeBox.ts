// Make on a box of the Film room's Make room (features/make-and-edit.clan): one generation of its shots, on the
// model the box shows. Kept apart from MakeRoom.tsx so the one rule (shown model === the model in the request,
// UAT rounds 2-4, F3 / R4-F1) is tested on the path the button takes (rooms/shownModel.test.ts).

import type { Config, Id, ModelChoice, ProductionDocument, Shot } from '../contracts/types'
import { makeClip, videoQuality } from '../jobs/clips'
import { drawFrame, selectedFrame, type FrameDeps } from '../jobs/frames'
import { makeRuns } from '../jobs/runs'
import { videoJoin } from '../jobs/runView'
import { shotRefSet } from '../jobs/select'
import { shotsOf } from '../model/selectors'
import { roomBoxModel } from './joinCut'
import type { Box } from './model'
import { startPicture } from './newBox'

/** A shot that names a character (its own refs, or offered through the script). */
export function shotHasCharacter(doc: ProductionDocument, shot: Shot | undefined): boolean {
  try { return !!shot && shotRefSet(doc, shot).some((x) => x.ref.role === 'character') } catch { return false }
}

export interface MadeBox {
  /** The model the box showed and sent, by name. */
  sent?: ModelChoice
  /** "Shot 3: …" for each run that could not be sent. */
  failed: string[]
  /** What happened when it is not plain (the frame drawn first). */
  notice?: string
}

/** Make on a box: its shots as one generation, on the model the box shows (`models`: the room's picks). */
export async function makeBox(deps: FrameDeps, opts: { videoId: Id; box: Box; config: Config; models: Record<Id, ModelChoice>; busy: (shotId: Id) => boolean }): Promise<MadeBox> {
  const doc = deps.doc.get()
  const { box: b, videoId, config } = opts
  // The model the box shows is the one sent, always by name: the relay's own default once made a box that said
  // Omni Flash on Veo 3.1 with sound (UAT 2026-11-21, F3), and makeRuns once put a spoken line on Veo 3.1 though the
  // box showed WAN 3 (round 4, R4-F1).
  const shown = roomBoxModel(doc, b, config, opts.models)
  const choice: ModelChoice | undefined = shown ? { provider: shown.provider, model: shown.model } : undefined
  const shotId = b.shotIds[0]
  const shot = doc.shots[shotId]
  const hasFrame = !!selectedFrame(doc, shotId) || !!startPicture(doc, shotId)
  // A box of one shot with no frame is made from its words (+ New box, a shot planned straight from the script), in a
  // film too: makeRuns fell back to the video's clip mode, which a storyboard film says is frames, and the box failed
  // with 'This shot has no frame yet' (UAT 2026-11-21, B1).
  const lone = b.shotIds.length === 1
  const fromWordsHere = lone && !hasFrame && !!shot?.action?.trim()
  if (videoJoin(doc, videoId, config) === 'film' && !(lone && !hasFrame && shotHasCharacter(doc, shot))) {
    const failed = await makeRuns(deps, { videoId, shotIds: [shotId], config, again: true, busy: opts.busy, ...(choice ? { modelChoice: choice } : {}), quality: videoQuality(doc, videoId), ...(fromWordsHere ? { fromWords: true } : {}) })
    return { ...(choice ? { sent: choice } : {}), failed }
  }
  // A character can only reach a clip through a frame (a clip from words is text-to-video, which drops every
  // reference). So a character shot with no frame makes the FRAME first (image generation uses the @on views), and
  // the clip is made from it on the box's model when it lands (jobs/wire clipAfterFrame; UAT 2026-11-21, F7).
  const idx = shot ? shotsOf(doc, shot.storyboard_id).findIndex((s) => s.id === shotId) : -1
  if (shot && !hasFrame && shotHasCharacter(doc, shot) && idx >= 0) {
    await drawFrame(deps, idx, 'first', { storyboardId: shot.storyboard_id, clipAfter: { videoId, ...(choice ? { modelChoice: choice } : {}) } })
    return { ...(choice ? { sent: choice } : {}), failed: [], notice: 'Drawing the frame of your character first, then the clip from it: a clip can only show @names through a frame.' }
  }
  // No frame and no character: the clip is made from the shot's words (a new box, or straight from the script).
  const fromWords = !hasFrame && !!shot?.action?.trim()
  await makeClip(deps, shotId, { videoId, ...(choice ? { modelChoice: choice } : {}), ...(fromWords ? { fromWords } : {}) })
  return { ...(choice ? { sent: choice } : {}), failed: [] }
}
