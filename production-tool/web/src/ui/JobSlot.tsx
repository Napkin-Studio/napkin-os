// A job's place in a panel (the Storyboard's plan and frames, the Video's clips and ad, the update box):
// its node, or, while the job waits on a question, the ask card instead (ui-behaviour 3.17, 5.2: no
// loader, no busy pointer while it waits for you).

import { useDoc } from '../app/context'
import { AskCard } from './AskCard'
import { waitingAsk } from './asks'
import { JobNode } from './JobNode'

export function JobSlot({ jobId, compact = false, row = false, onRetried }: { jobId: string; compact?: boolean; row?: boolean; onRetried?: (newId: string) => void }) {
  const doc = useDoc()
  const ask = waitingAsk(doc, jobId)
  if (ask) return <div className="jobslot-ask" style={{ overflow: 'auto', maxHeight: '100%' }}><AskCard ask={ask} /></div>
  return <JobNode jobId={jobId} compact={compact} row={row} onRetried={onRetried} />
}
