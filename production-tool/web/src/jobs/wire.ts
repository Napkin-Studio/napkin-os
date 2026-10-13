// What happens when a Storyboard or Video job lands, and the chains a landing
// moves on: Draw the rest (frames.ts), Fix it in the shot (fix.ts) and Update
// what follows (follow.ts). Shared by the app's boot and the tests. Every
// landing is the crew's (handlers.ts, plan.ts).

import { continueFix, resumeFixes } from './fix'
import { continueFollow } from './follow'
import { continueDrawing, type FrameDeps } from './frames'
import { landFrame, landRender, landTake } from './handlers'
import { landShotList } from './plan'

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
  runner.onComplete('clip', (job, ctx) => {
    if (ctx.for !== 'clip') return
    void landTake(doc, job, ctx).then(() => continueFollow(deps)).catch(warn('update what follows'))
  })
  runner.onComplete('stitch', (job, ctx) => void landRender(doc, job, ctx.for === 'stitch' ? ctx : undefined)
    .then(() => continueFollow(deps)).catch(warn('update what follows')))
}

/** At boot, after runner.resume(): pick up every chain that was under way. */
export async function resumeChains(deps: FrameDeps) {
  await continueDrawing(deps).catch(warn('draw the rest'))
  await resumeFixes(deps).catch(warn('fix it in the shot'))
  await continueFollow(deps).catch(warn('update what follows'))
}
