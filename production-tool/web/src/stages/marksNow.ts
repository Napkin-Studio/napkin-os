// The pin or "guide" on each storyboard frame, as the video's plan makes it now (connected video). A frame
// inside a take its box was made together keeps "guide" from that take's segments (jobs/runView frameMarks);
// once the box is made apart the plan no longer has it inside a take, and the badge went stale (live test
// 2026-11-16). The plan decides wherever it covers the shot.
import { frameMarks, type FrameMark } from '../jobs/runView'
import type { RunPlan } from '../jobs/runs'
import type { Id, ProductionDocument } from '../contracts/types'

export function marksNow(d: ProductionDocument, videoId: Id | undefined, plan: RunPlan | undefined): Record<Id, FrameMark> {
  const out = frameMarks(d, videoId, plan)
  if (!plan) return out
  for (const id of Object.keys(out)) {
    const run = plan.runs.find((r) => r.shotIds.includes(id))
    if (!run) continue
    out[id] = run.mode === 'take_refs' ? 'guide' : run.mode === 'take' ? (run.shotIds[0] === id ? 'pin' : 'guide') : 'pin'
  }
  return out
}
