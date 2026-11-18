// The Box tab's model choice (features/make-and-edit.clan): which models can make a box as it stands, why
// the others cannot, and the one it is made on. Kept apart from MakeRoom.tsx so it is tested on its own.

import { modelChoicesFor } from '../capabilities'
import type { Config, ModelChoice, ProductionDocument } from '../contracts/types'
import { lastWorkedModel } from '../jobs/follow'
import { selectedFrame } from '../jobs/frames'
import { modelEntry, TAKE_MAX_S, TAKE_MAX_SHOTS } from '../jobs/runs'
import type { Box } from './model'
import { shotRefLinks, startPicture } from './newBox'

export const entryOf = (m: ModelChoice) => modelEntry(m.provider as Parameters<typeof modelEntry>[0], m.model)

/** What the box sends decides which models can make it: from words alone, references with no frame, a
 *  first frame, several shots as one video. Why this model cannot, or undefined when it can. */
export function boxModelWhyNot(doc: ProductionDocument, box: Box, m: ModelChoice): string | undefined {
  const e = entryOf(m)
  const noFrame = !selectedFrame(doc, box.shotIds[0]) && !startPicture(doc, box.shotIds[0])
  const hasRefs = box.shotIds.some((id) => shotRefLinks(doc, id).length > 0 || /@[a-z]/.test(doc.shots[id]?.action ?? ''))
  const take = e?.video.take
  if (box.together && !take?.ok) return "Can't make several shots as one video"
  // The limits planRuns uses (jobs/runs.ts): past them it would quietly make the box on another model
  // (live test 2026-11-16: Omni Flash offered and picked for a 15 s box, then made on WAN 3).
  if (box.together && take?.ok && e) {
    const maxS = take.maxS ?? TAKE_MAX_S
    const maxShots = take.maxShots ?? TAKE_MAX_SHOTS
    if (box.lengthS > maxS + 1e-6) return `Longer than ${e.label} makes in one go (${maxS} s)`
    if (box.shotIds.length > maxShots) return `More shots than ${e.label} makes in one go (${maxShots})`
  }
  if (noFrame && e && !e.words) return 'Needs a start frame'
  if (noFrame && hasRefs && e && !e.video.refsWithoutFrame) return "Can't use references without a start frame"
  return undefined
}

/** With a start frame on a model that takes no references beside it, the frame carries the character: the
 *  relay keeps the frame and says the refs in words (relay/director/director.py _clip_frame_only). That is
 *  how every Veo clip from a storyboard is made, so it is a note, not a refusal. Refusing it left a box made
 *  together with no model at all (full test, 2026-11-04). */
export function boxModelNote(doc: ProductionDocument, box: Box, m: ModelChoice): string | undefined {
  const e = entryOf(m)
  const hasFrame = !!selectedFrame(doc, box.shotIds[0]) || !!startPicture(doc, box.shotIds[0])
  const hasRefs = box.shotIds.some((id) => shotRefLinks(doc, id).length > 0 || /@[a-z]/.test(doc.shots[id]?.action ?? ''))
  return hasFrame && hasRefs && e && !e.video.firstFrameWithRefs ? 'The character comes from the start frame' : undefined
}

/** The model a box is made on: the one picked for it, else the last that worked, unless that one cannot
 *  make this box (Veo for shots made together); then the first that can. */
export function boxModel(doc: ProductionDocument, box: Box, config: Config, picked?: ModelChoice): ModelChoice | undefined {
  const options = modelChoicesFor('clip', config)
  const wanted = picked ?? lastWorkedModel(doc, 'clip', config) ?? options[0]
  if (wanted && !boxModelWhyNot(doc, box, wanted)) return wanted
  return options.find((o) => !boxModelWhyNot(doc, box, o)) ?? wanted
}
