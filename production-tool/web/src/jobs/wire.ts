// What happens when a Storyboard or Video job lands, and the chains a landing
// moves on: Draw the rest (frames.ts), Fix it in the shot (fix.ts) and Update
// what follows (follow.ts). Shared by the app's boot and the tests.

import { systemUpdate } from '../doc/store'
import { continueFix, resumeFixes } from './fix'
import { continueFollow } from './follow'
import { continueDrawing, type FrameDeps } from './frames'
import { applyFrame, applyShotList, applyStitch, applyTake } from './handlers'

const warn = (what: string) => (e: unknown) => console.warn(`${what} stopped`, e)

export function wireJobs(deps: FrameDeps) {
  const { doc, runner } = deps
  runner.onComplete('shot_list', (job, ctx) => void systemUpdate(doc, (d) => ctx.for === 'shot_list' && applyShotList(d, job, ctx), 'shot list'))
  runner.onComplete('frame', (job, ctx) => void systemUpdate(doc, (d) => ctx.for === 'frame' && applyFrame(d, job, ctx), 'frame')
    .then(async () => {
      await continueFix(deps, job.jobId, ctx).catch(warn('fix it in the shot'))
      await continueDrawing(deps).catch(warn('draw the rest'))
      await continueFollow(deps).catch(warn('update what follows'))
    }))
  runner.onComplete('clip', (job, ctx) => void systemUpdate(doc, (d) => ctx.for === 'clip' && applyTake(d, job, ctx), 'take')
    .then(() => continueFollow(deps)).catch(warn('update what follows')))
  runner.onComplete('stitch', (job) => void systemUpdate(doc, (d) => applyStitch(d, job), 'ad')
    .then(() => continueFollow(deps)).catch(warn('update what follows')))
}

/** At boot, after runner.resume(): pick up every chain that was under way. */
export async function resumeChains(deps: FrameDeps) {
  await continueDrawing(deps).catch(warn('draw the rest'))
  await resumeFixes(deps).catch(warn('fix it in the shot'))
  await continueFollow(deps).catch(warn('update what follows'))
}
