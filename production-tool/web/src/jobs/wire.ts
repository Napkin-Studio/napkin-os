// What happens when a Storyboard or Video job lands, and the chains a landing
// moves on: Draw the rest (frames.ts), Fix it in the shot (fix.ts) and Update
// what follows (follow.ts). Shared by the app's boot and the tests. Every
// landing is the crew's (handlers.ts, plan.ts).

import { continueFix, resumeFixes } from './fix'
import { continueFollow } from './follow'
import { landFrameEditIn } from './frameEdit'
import { continueDrawing, type FrameDeps } from './frames'
import { landFrame, landRemake, landRender, landRunTake, landTake } from './handlers'
import { landShotList } from './plan'
import { purposeOf } from '../model/purpose'
import type { DocumentStore } from '../doc/types'
import type { Job } from '../contracts/types'
import { landWrites } from '../script/skye'
import { landSize } from '../campaign/make'
import { landFilmPlan, landReframe } from '../campaign/filmJobs'

const warn = (what: string) => (e: unknown) => console.warn(`${what} stopped`, e)

export function wireJobs(deps: FrameDeps) {
  const { doc, runner } = deps
  runner.onComplete('shot_list', (job, ctx) => void landShotList(doc, job, ctx.for === 'shot_list' ? ctx : undefined).catch(warn('the plan')))
  runner.onComplete('frame', (job, ctx) => {
    if (ctx.for !== 'frame') return
    void landFrame(doc, job, ctx).then(async () => {
      await continueFix(deps, job.jobId, ctx).catch(warn('fix it in the shot'))
      await continueDrawing(deps).catch(warn('draw the rest'))
      await continueFollow(deps).catch(warn('update what follows'))
    })
  })
  // Change this frame: the new version lands unpicked, for Apply, Keep both or Discard (jobs/frameEdit.ts).
  runner.onComplete('frame_edit', (job, ctx) => {
    if (ctx.for !== 'frame_edit') return
    void landFrameEditIn(doc, job, ctx).catch(warn('change this frame'))
  })
  // A new take: in the Video editor it is picked in the cut; in the rooms it lands beside the others only.
  const inCut = () => ({ inCut: !deps.rooms?.() })
  runner.onComplete('clip', (job, ctx) => {
    if (ctx.for !== 'clip') return
    void landTake(doc, job, ctx, inCut()).then(() => continueFollow(deps)).catch(warn('update what follows'))
  })
  // One take of a run: one generation of the box, a window of it per shot (features/connected-video.clan).
  runner.onComplete('run', (job, ctx) => {
    if (ctx.for !== 'run') return
    void landRunTake(doc, job, ctx, inCut()).then(() => continueFollow(deps)).catch(warn('the take'))
  })
  // Change this…: a new take beside its parent, never in the cut (features/make-and-edit.clan).
  runner.onComplete('remake', (job, ctx) => {
    if (ctx.for !== 'remake') return
    void landRemake(doc, job, ctx).catch(warn('the new take'))
  })
  // The Image editor's actions land nowhere: the editor shows each result as a layer until Apply.
  runner.onComplete('image_edit', () => {})
  runner.onComplete('write', (job) => void landWrites(doc, job).catch(warn("Skye's draft")))
  // Make all sizes: a crop lands as its size's picture (features/campaign-formats.clan).
  runner.onComplete('size', (job, ctx) => {
    if (ctx.for === 'size') void landSize(doc, job, ctx, deps.relay).catch(warn('the size'))
  })
  // A film's plan lands nowhere (the sheet shows it); a shot made again for a shape renders its sizes again.
  runner.onComplete('film_plan', (job) => landFilmPlan(job))
  runner.onComplete('reframe', (job, ctx) => {
    if (ctx.for === 'reframe') void landReframe(deps, job, ctx).catch(warn('the reframe'))
  })
  runner.onComplete('stitch', (job, ctx) => void landRender(doc, job, ctx.for === 'stitch' ? ctx : undefined)
    .then(() => continueFollow(deps)).catch(warn('update what follows')))
}

/**
 * Finished clips that never became a take: the job is completed with its file, but its landing was
 * refused (a rationale over the .clan's limit, 2026-10-15: three paid clips missing) or the page went
 * first. Each lands now, as it would have. A clip whose landing was ever recorded (the take was
 * deleted since) is left alone. How many landed.
 */
export async function landMissedClips(doc: DocumentStore, opts: { inCut: boolean } = { inCut: true }): Promise<number> {
  const d = doc.get()
  const missed = Object.values(d.jobs).filter((j) => j.op === 'clip' && j.state === 'completed' && j.outputs?.length
    && !Object.values(d.generations).some((g) => g.job_id === j.id))
  const chainOf = (doc as { chain?: () => Promise<{ action: string; cites?: string[] }[]> }).chain
  if (!missed.length || !chainOf) return 0
  const chain = await chainOf.call(doc)
  let n = 0
  for (const j of missed) {
    if (chain.some((e) => e.action.startsWith('render take') && e.cites?.some((c) => c.endsWith(`#jobs[${j.id}]`)))) continue
    const ctx = purposeOf(j)
    if (ctx?.for !== 'clip') continue
    const job = {
      jobId: j.id, op: 'clip', crew: j.crew, provider: j.provider, model: j.model, kind: j.provider === 'mock' ? 'mock' : 'generated',
      outputs: (j.outputs ?? []).map((sha256) => ({ sha256 })),
    } as unknown as Job
    await landTake(doc, job, ctx, opts)
    if (Object.values(doc.get().generations).some((g) => g.job_id === j.id)) n++
  }
  return n
}

/** At boot, after runner.resume(): pick up every chain that was under way. */
export async function resumeChains(deps: FrameDeps) {
  await landMissedClips(deps.doc, { inCut: !deps.rooms?.() }).catch(warn('land the finished clips'))
  await continueDrawing(deps).catch(warn('draw the rest'))
  await resumeFixes(deps).catch(warn('fix it in the shot'))
  await continueFollow(deps).catch(warn('update what follows'))
}
