// Change this… (features/make-and-edit.clan): remakeWith(parent, delta), a new take of a parent with one thing
// changed. The relay keeps the parent's whole request (held server-side with its job), changes only the delta,
// keeps the seed where the model repeats one, and answers Job.remake with what each changed thing was. Remake
// as Final (clips.ts remakeAsFinal) is the template: the request carries no input of its own. The new take
// lands beside its parent (handlers.ts applyRemake), never over it and never in the cut.

import type { ClipQuality, Id, ModelChoice, Op, RemakeDelta } from '../contracts/types'
import type { FrameDeps } from './frames'

export type { RemakeDelta }

/** The op a delta runs on: a moment is a patch of the parent (clip_patch), the whole feel a restyle
 *  (clip_edit); a camera move or words make the parent's clip again (clip). */
export function remakeOp(delta: RemakeDelta[]): Op {
  if (delta.some((x) => x.field === 'moment')) return 'clip_patch'
  if (delta.some((x) => x.field === 'feel')) return 'clip_edit'
  return 'clip'
}

/** Why a delta cannot be sent as one remake, in words; undefined when it can. */
export function remakeProblem(delta: RemakeDelta[]): string | undefined {
  if (!delta.length) return 'Choose what changes first.'
  if (delta.length > 4) return 'Change at most four things at once.'
  const alone = delta.filter((x) => x.field === 'moment' || x.field === 'feel')
  if (alone.length && delta.length > 1) return 'A moment or the whole feel is changed on its own.'
  return undefined
}

/**
 * Send a remake of generation `parentId` with `delta`. Its job's purpose is `remake <parent>` on the video, so any
 * browser lands it. Returns the job id.
 */
export async function remakeWith(
  deps: Pick<FrameDeps, 'doc' | 'runner'>,
  opts: { videoId: Id; parentId: Id; delta: RemakeDelta[]; modelChoice?: ModelChoice; quality?: ClipQuality; label?: string },
): Promise<string> {
  const d = deps.doc.get()
  const parent = d.generations[opts.parentId]
  if (!parent || parent.state !== 'ready' || !parent.job_id) throw new Error('That take is not ready to change yet.')
  const why = remakeProblem(opts.delta)
  if (why) throw new Error(why)
  const op = remakeOp(opts.delta)
  return deps.runner.submit(op, {}, [parent.job_id], { for: 'remake', videoId: opts.videoId, parentId: parent.id }, undefined, opts.modelChoice, {
    ...(opts.quality && op !== 'clip_patch' ? { quality: opts.quality } : {}),
    remakeWith: { parentJobId: parent.job_id, parentId: parent.id, delta: opts.delta },
  })
}
