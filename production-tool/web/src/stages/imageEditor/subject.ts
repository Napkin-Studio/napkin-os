// What the Image editor works on (features/edit-canvas-pictures.clan): a shot's frame, or a picture on
// the canvas. Everything that differs between the two is resolved here, once, so the editor reads one
// shape: the versions and the one open, the picture's size, the words, the job's purpose, and how Apply
// and a version pick are written. The tools, masks, layers and actions do not know which it is.

import type { Frame, ProductionDocument, Shot } from '../../contracts/types'
import type { EditTarget, JobPurpose } from '../../model/purpose'
import { currentFrame, currentPictureFrame, framesOf, mainStoryboard, pictureVersions, refsList, shotsOf } from '../../model/selectors'
import { nameOf } from '../../lib/names'
import { ratioAspect } from '../../jobs/select'

/** A canvas picture as the canvas shows it now (before its first edit, the document has no version of it). */
export interface PictureNow { sha: string; w?: number; h?: number }

export interface Subject {
  target: EditTarget
  /** Its versions, v1 first (a picture before its first edit has none). */
  versions: Frame[]
  /** The version open now, if any. */
  current?: Frame
  /** The picture being edited. */
  sha?: string
  /** The version number shown ("v2"); a picture with no versions yet is v1. */
  version: number
  /** Where the edits not applied yet are kept (ProjectUi.imageEdits): the open version, else the picture's node. */
  sessionKey?: string
  /** The picture's shape (width / height) when its size is not known yet. */
  aspect: number
  /** The frame's ratio, locked while cropping (a shot's storyboard); a picture keeps its own shape. */
  ratio?: string
  /** The editor's title and what the send tray calls it ("Frame 2 · Close up", "@baby_front"). */
  title: string
  label: string
  /** The back button's words. */
  back: string
  /** Where Apply puts the result, for the line under the edits. */
  applyWhere: string
  /** The jobs this picture was made by (an action's parents). */
  parents: string[]
  purpose: Extract<JobPurpose, { for: 'image_edit' }>
  /** A shot's neighbours, for ← → (a picture has none). */
  prev?: { id: string; title: string }
  next?: { id: string; title: string }
}

const capital = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
export const shotTitle = (s: Shot | undefined, n: number) => `Frame ${n} · ${capital(s?.camera.size ?? 'shot')}`

/** The subject of a target, or undefined when it is gone (the shot deleted, the picture not on the canvas). */
export function subjectOf(d: ProductionDocument, target: EditTarget, now?: PictureNow): Subject | undefined {
  if (target.kind === 'shot') {
    const sbId = d.shots[target.shotId]?.storyboard_id
    const shots = shotsOf(d, sbId)
    const index = shots.findIndex((s) => s.id === target.shotId)
    const shot = shots[index]
    if (!shot) return undefined
    const versions = framesOf(d, shot.id)
    const current = currentFrame(d, shot) ?? versions.at(-1)
    const ratio = (sbId && d.storyboards[sbId]?.ratio) || mainStoryboard(d)?.ratio || '16:9'
    const prev = shots[index - 1]
    const next = shots[index + 1]
    return {
      target, versions, current, sha: current?.asset, version: current?.version ?? 0, sessionKey: current?.id,
      aspect: ratioAspect(ratio), ratio,
      title: shotTitle(shot, index + 1), label: `Frame ${index + 1}`, back: 'Storyboard',
      applyWhere: `updates shot ${index + 1} on the storyboard`,
      parents: current?.job_id ? [current.job_id] : [],
      purpose: { for: 'image_edit', target, ...(current ? { parentFrameId: current.id } : {}) },
      ...(prev ? { prev: { id: prev.id, title: shotTitle(prev, index) } } : {}),
      ...(next ? { next: { id: next.id, title: shotTitle(next, index + 2) } } : {}),
    }
  }
  const versions = pictureVersions(d, target.nodeId)
  const current = currentPictureFrame(d, target.nodeId)
  const sha = current?.asset ?? now?.sha
  if (!sha) return undefined
  const a = d.assets[sha]
  const w = a?.w ?? now?.w
  const h = a?.h ?? now?.h
  const ref = refsList(d).find((r) => r.node === target.nodeId)
  const name = ref ? `@${nameOf(ref)}` : 'Picture'
  // A result on the canvas is named by its job's id: that job made it.
  const made = d.jobs[target.nodeId] ? [target.nodeId] : []
  return {
    target, versions, current, sha, version: current?.version ?? 1, sessionKey: current?.id ?? target.nodeId,
    aspect: w && h ? w / h : 1,
    title: name, label: name, back: 'Canvas',
    applyWhere: 'puts it in place on the canvas',
    parents: current?.job_id ? [current.job_id] : made,
    purpose: { for: 'image_edit', target, ...(current ? { parentFrameId: current.id } : {}) },
  }
}
