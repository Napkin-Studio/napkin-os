// A shot's Change this frame and camera, as the sheet cell and the shot's Booth both read them
// (features/production-new-ui.clan): the latest change job and its proposal, its recast question, whether a
// result still waits, and the camera chips.

import type { Camera, DocJob, Frame, ProductionDocument, Shot } from '../contracts/types'
import type { UiState } from '../doc/ui'
import { cameraLabel, proposalOf } from '../jobs/frameEdit'
import { askOf, jobCtx } from '../jobs/runner'
import { isRunning } from '../jobs/select'
import { jobsList } from '../model/selectors'

/** The latest Change this frame on a shot, and what it proposed. */
export function frameChangeOf(doc: ProductionDocument, ui: Pick<UiState, 'jobs'>, shotId: string): { job: DocJob; proposal?: Frame } | undefined {
  const jobs = jobsList(doc)
  for (let i = jobs.length - 1; i >= 0; i--) {
    const j = jobs[i]
    if (j.op !== 'frame_edit') continue
    const ctx = jobCtx(doc, ui, j.id)
    if (!ctx || ctx.dismissed || !('shotId' in ctx) || ctx.shotId !== shotId) continue
    return { job: j, proposal: proposalOf(doc, j.id) }
  }
  return undefined
}

/** A Change this frame waiting on the person: the Director agent's recast question (Redraw instead or Edit anyway). */
export function recastAsk(doc: ProductionDocument, change: ReturnType<typeof frameChangeOf>) {
  const waiting = change && change.job.state === 'needs_input' ? askOf(doc, change.job.id) : undefined
  return waiting?.state === 'open' && waiting.question.kind === 'recast' ? waiting : undefined
}

/** A Change this frame result the person has not applied, kept or discarded yet (or one still running). */
export function changeShown(doc: ProductionDocument, shot: Shot, change: ReturnType<typeof frameChangeOf>): boolean {
  if (!change) return false
  if (isRunning(doc, change.job.id)) return true
  return !!change.proposal && shot.pick?.current !== change.proposal.id && !shot.pick?.alternates?.includes(change.proposal.id)
}

export const cap = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1)

export function cameraChips(c: Camera): { field: keyof Camera; label: string }[] {
  return ([['size', c.size], ['angle', c.angle], ['movement', c.movement ?? 'static'], ['lens_mm', c.lens_mm]] as const)
    .filter(([, v]) => v !== undefined && v !== null).map(([field, v]) => ({ field, label: cap(cameraLabel(field, v)) }))
}

