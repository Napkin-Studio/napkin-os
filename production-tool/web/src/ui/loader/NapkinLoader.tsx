// The working sign is the Deep O (features/production-new-ui.clan; app/src/brand/deepOSvg.ts, the shell's
// own mark), in the agency's colours: it replaces the October quadrant loader. It turns in two places
// only (owner, 2026-10-15; ui-behaviour 6.5): the busy pointer's badge and the bar's job chip; the
// medallion shows the same state. Everywhere else a job runs, the agent doing it shows working (its role
// sphere). places.test.ts holds that. The words always sit beside it: the mark itself says nothing.

import type { Work } from '../agents/cast'
import { DeepO } from '../shell/look'

export type LoaderState = 'run' | 'finish' | 'queued'

export function NapkinLoader({ work = 'create', state = 'run', size = 20, flat = false }: {
  /** The department of the work: kept for the record (data-work); the Deep O draws every job the same. */
  work?: Work
  state?: LoaderState
  /** Still, awake: the job chip when nothing runs but something waits. */
  flat?: boolean
  size?: 14 | 20
}) {
  const mark = flat ? 'awake' : state === 'finish' ? 'done' : state === 'queued' ? 'awake' : 'working'
  return (
    <span className="napkin-loader" data-work={work} data-state={state} aria-hidden="true">
      <DeepO size={size} state={mark} />
    </span>
  )
}
