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
  return boxModelCant(doc, box, m) ?? boxModelLimit(box, m)
}

/** Why a model cannot make this box at all (not one of its limits): several shots on a model with no takes,
 *  no frame on a model that needs one, references with no frame on a model that drops them. */
export function boxModelCant(doc: ProductionDocument, box: Box, m: ModelChoice): string | undefined {
  const e = entryOf(m)
  const noFrame = !selectedFrame(doc, box.shotIds[0]) && !startPicture(doc, box.shotIds[0])
  const hasRefs = box.shotIds.some((id) => shotRefLinks(doc, id).length > 0 || /@[a-z]/.test(doc.shots[id]?.action ?? ''))
  if (box.together && !e?.video.take?.ok) return "Can't make several shots as one video"
  if (box.together) {
    // A box made together pins no frame (take_refs): its frames and named pictures all go as references.
    const guides = hasRefs || box.shotIds.some((id) => !!selectedFrame(doc, id) || !!startPicture(doc, id))
    if (guides && e && !e.video.refsWithoutFrame) return "Can't use references without a start frame"
    if (!guides && e && !e.words) return 'Needs a start frame'
    return undefined
  }
  if (noFrame && e && !e.words) return 'Needs a start frame'
  if (noFrame && hasRefs && e && !e.video.refsWithoutFrame) return "Can't use references without a start frame"
  return undefined
}

/** How long and how many shots a model makes as one video (the limits planRuns uses, jobs/runs.ts). */
export function takeLimits(m: ModelChoice): { maxS: number; maxShots: number } | undefined {
  const take = entryOf(m)?.video.take
  return take?.ok ? { maxS: take.maxS ?? TAKE_MAX_S, maxShots: take.maxShots ?? TAKE_MAX_SHOTS } : undefined
}

/** Why a box made together is past what the model makes in one go, or undefined. Past them planRuns would
 *  once quietly make the box on another model (live test 2026-11-16: Omni Flash picked for a 15 s box, then
 *  made on WAN 3); now the box says so and Make waits (features/join-or-cut-shots.clan). */
export function boxModelLimit(box: Box, m: ModelChoice): string | undefined {
  const lim = box.together ? takeLimits(m) : undefined
  const e = entryOf(m)
  if (!lim || !e) return undefined
  if (box.lengthS > lim.maxS + 1e-6) return `Longer than ${e.label} makes in one go (${lim.maxS} s)`
  if (box.shotIds.length > lim.maxShots) return `More shots than ${e.label} makes in one go (${lim.maxShots})`
  return undefined
}

/** With a start frame on a model that takes no references beside it, the frame carries the character: the
 *  relay keeps the frame and says the refs in words (relay/director/director.py _clip_frame_only). That is
 *  how every Veo clip from a storyboard is made, so it is a note, not a refusal. Refusing it left a box made
 *  together with no model at all (full test, 2026-11-04). */
export function boxModelNote(doc: ProductionDocument, box: Box, m: ModelChoice): string | undefined {
  if (box.together) return undefined // no frame is pinned: the pictures go as references
  const e = entryOf(m)
  const hasFrame = !!selectedFrame(doc, box.shotIds[0]) || !!startPicture(doc, box.shotIds[0])
  const hasRefs = box.shotIds.some((id) => shotRefLinks(doc, id).length > 0 || /@[a-z]/.test(doc.shots[id]?.action ?? ''))
  return hasFrame && hasRefs && e && !e.video.firstFrameWithRefs ? 'The character comes from the start frame' : undefined
}

/** The model a box is made on: the one picked for it, kept even past its limits (the box then says so and
 *  Make waits: a joined box keeps the earlier box's model, features/join-or-cut-shots.clan); else the last
 *  that worked, unless that one cannot make this box (Veo for shots made together); then the first that can. */
/** When the box is made on another model than the one the film makes clips with (the person's pick, else the
 *  last that worked, else the first), which one and why, for the box to say (UAT 2026-11-21: a joined box went to
 *  Gemini Omni Flash 1.1 with Veo greyed and nothing said why). */
export function boxModelSwitch(doc: ProductionDocument, box: Box, config: Config, picked?: ModelChoice): { to: string; from: string; why: string } | undefined {
  if (picked) return undefined
  const wanted = lastWorkedModel(doc, 'clip', config) ?? modelChoicesFor('clip', config)[0]
  const why = wanted ? boxModelWhyNot(doc, box, wanted) : undefined
  const got = boxModel(doc, box, config)
  if (!wanted || !why || !got || (got.model === wanted.model && got.provider === wanted.provider)) return undefined
  const label = (m: ModelChoice) => entryOf(m)?.label ?? m.model
  return { to: label(got), from: label(wanted), why: why.replace(/^Can't/, "can't").replace(/^Needs/, 'needs') }
}

export function boxModel(doc: ProductionDocument, box: Box, config: Config, picked?: ModelChoice): ModelChoice | undefined {
  if (picked && !boxModelCant(doc, box, picked)) return picked
  const options = modelChoicesFor('clip', config)
  const wanted = picked ?? lastWorkedModel(doc, 'clip', config) ?? options[0]
  if (wanted && !boxModelWhyNot(doc, box, wanted)) return wanted
  return options.find((o) => !boxModelWhyNot(doc, box, o)) ?? wanted
}
