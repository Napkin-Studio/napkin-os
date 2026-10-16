// What a job is for, kept in the document (contract 3: jobs[id].purpose, node
// and inputs), so its result lands in the right place after a reload, in
// another browser, or (later) on the server. It was ProjectUi.jobCtx.
//
//   purpose  the kind and how, in words: "frame next", "clip", "stitch"
//   node     where it runs: the shot (frame, clip), the storyboard (shot_list),
//            the video (stitch), the sketch area (sketch); a canvas Generate
//            names its own canvas node
//   inputs   what it builds on: the frame or take it is a new version of, the
//            notes it fixes

import type { DocJob, Id, JobInputRow, LinkEndpoint, ProductionDocument } from '../contracts/types'
import { mainScript, mainStoryboard, mainVideo } from './selectors'

export type FrameHow = 'first' | 'next' | 'rest' | 'chain' | 'again' | 'update'

/** What the Image editor works on (features/edit-canvas-pictures.clan): a shot's frame, or a picture on the
 *  canvas (its pic or gen node id). */
export type EditTarget = { kind: 'shot'; shotId: Id } | { kind: 'picture'; nodeId: string }

export type JobPurpose =
  | { for: 'canvas' }
  /** storyboardId: the storyboard it plans (absent: the main one; features/canvas-nodes.clan, more than one storyboard). */
  | { for: 'shot_list'; storyboardId?: Id }
  /** how: first (frame 1), next (Next frame →), rest (Draw the rest), chain (Draw the rest moving on),
   *  again (Regenerate or a region edit), update (Update what follows). fixReviewIds: a "Fix it in the
   *  shot" edit; when it lands, a clip is made from it for these notes (jobs/fix.ts). */
  | { for: 'frame'; shotId: Id; parentFrameId?: Id; how?: FrameHow; fixReviewIds?: Id[] }
  | { for: 'clip'; shotId: Id; parentTakeId?: Id; reviewIds?: Id[] }
  /** videoId: the video it renders (absent: the main one). */
  | { for: 'stitch'; videoId?: Id }
  /** A Generate on a sketch area (features/frame-aspect.clan): it lands as a frame made from the sketch. */
  | { for: 'sketch'; sketchId: Id }
  /** Change this frame (features/frame-change-edit.clan): a proposal on the shot's frame `parentFrameId`,
   *  landed unpicked until Apply or Keep both (jobs/frameEdit.ts). */
  | { for: 'frame_edit'; shotId: Id; parentFrameId?: Id }
  /** An Image editor action (features/image-editor.clan) on a shot's frame or a canvas picture
   *  (features/edit-canvas-pictures.clan), from its version `parentFrameId` when it has one: Fill area,
   *  Change whole frame or Upscale. Its result lands nowhere: the
   *  editor shows it as a layer, and only Apply as new version makes a frame. The job's node is the shot,
   *  or the canvas node (a group endpoint, as a canvas Generate's). */
  | { for: 'image_edit'; target: EditTarget; parentFrameId?: Id }
  /** Skye drafts or rewrites one item of a script (features/script-editor.clan). */
  | { for: 'write'; scriptId?: Id }
  /** One size of a format set (features/campaign-formats.clan): it lands as the size's picture. */
  | { for: 'size'; setId: Id; sizeId: Id }

export type Purpose = JobPurpose['for']

const HOWS: readonly string[] = ['first', 'next', 'rest', 'chain', 'again', 'update']

/** The words a purpose is kept as. */
export function purposeWords(p: JobPurpose): string {
  if (p.for === 'size') return `size ${p.sizeId}`
  return p.for === 'frame' && p.how ? `frame ${p.how}` : p.for
}

/** The node a job runs for. */
export function purposeNode(d: ProductionDocument, p: JobPurpose, jobId: Id): LinkEndpoint {
  switch (p.for) {
    case 'frame':
    case 'clip':
    case 'frame_edit':
      return { kind: 'shot', id: p.shotId }
    case 'image_edit':
      return p.target.kind === 'shot' ? { kind: 'shot', id: p.target.shotId } : { kind: 'group', id: p.target.nodeId }
    case 'shot_list':
      return { kind: 'storyboard', id: (p.storyboardId && d.storyboards[p.storyboardId] ? p.storyboardId : mainStoryboard(d)!.id) }
    case 'stitch':
      return { kind: 'video', id: (p.videoId && d.videos[p.videoId] ? p.videoId : mainVideo(d)!.id) }
    case 'sketch':
      return { kind: 'sketch', id: p.sketchId }
    case 'write':
      return { kind: 'script', id: p.scriptId ?? mainScript(d)!.id }
    case 'size':
      return { kind: 'format_set', id: p.setId }
    default:
      // A Generate on today's canvas runs for the selection; its result is the canvas node named by the job's id.
      return { kind: 'group', id: jobId }
  }
}

/** The input rows a purpose keeps (what the job is a new version of, the notes it fixes). */
export function purposeInputs(p: JobPurpose): JobInputRow[] {
  const rows: JobInputRow[] = []
  if ((p.for === 'frame' || p.for === 'frame_edit' || p.for === 'image_edit') && p.parentFrameId) rows.push({ kind: 'frame', ref: p.parentFrameId, used_as: 'new version of', included: true })
  if (p.for === 'clip' && p.parentTakeId) rows.push({ kind: 'take', ref: p.parentTakeId, used_as: 'new version of', included: true })
  for (const r of (p.for === 'frame' ? p.fixReviewIds : p.for === 'clip' ? p.reviewIds : undefined) ?? []) {
    rows.push({ kind: 'note', ref: r, used_as: 'note to fix', included: true })
  }
  return rows
}

/** What a job in the document was for; null for a job whose purpose this build does not know. */
export function purposeOf(j: Pick<DocJob, 'purpose' | 'node' | 'inputs'>): JobPurpose | null {
  const [kind, how] = (j.purpose ?? '').split(' ')
  const notes = (j.inputs ?? []).filter((r) => r.kind === 'note' && r.ref).map((r) => r.ref!)
  const parent = (k: JobInputRow['kind']) => (j.inputs ?? []).find((r) => r.kind === k && r.used_as === 'new version of')?.ref
  switch (kind) {
    case 'shot_list':
      return j.node?.kind === 'storyboard' && j.node.id ? { for: 'shot_list', storyboardId: j.node.id } : { for: 'shot_list' }
    case 'stitch':
      return j.node?.kind === 'video' && j.node.id ? { for: 'stitch', videoId: j.node.id } : { for: 'stitch' }
    case 'canvas':
      return { for: kind }
    case 'write':
      return j.node.kind === 'script' ? { for: 'write', scriptId: j.node.id } : { for: 'write' }
    case 'size':
      return j.node?.kind === 'format_set' && how ? { for: 'size', setId: j.node.id, sizeId: how } : null
    case 'frame': {
      if (j.node.kind !== 'shot') return null
      const p: JobPurpose = { for: 'frame', shotId: j.node.id }
      const pf = parent('frame')
      if (pf) p.parentFrameId = pf
      if (how && HOWS.includes(how)) p.how = how as FrameHow
      if (notes.length) p.fixReviewIds = notes
      return p
    }
    case 'sketch':
      return j.node.kind === 'sketch' ? { for: 'sketch', sketchId: j.node.id } : null
    case 'frame_edit': {
      if (j.node.kind !== 'shot') return null
      const pf = parent('frame')
      return { for: kind, shotId: j.node.id, ...(pf ? { parentFrameId: pf } : {}) }
    }
    case 'image_edit': {
      const pf = parent('frame')
      const target: EditTarget | null = j.node.kind === 'shot' ? { kind: 'shot', shotId: j.node.id } : j.node.kind === 'group' ? { kind: 'picture', nodeId: j.node.id } : null
      return target ? { for: kind, target, ...(pf ? { parentFrameId: pf } : {}) } : null
    }
    case 'clip': {
      if (j.node.kind !== 'shot') return null
      const p: JobPurpose = { for: 'clip', shotId: j.node.id }
      const pt = parent('take')
      if (pt) p.parentTakeId = pt
      if (notes.length) p.reviewIds = notes
      return p
    }
    default:
      return null
  }
}
