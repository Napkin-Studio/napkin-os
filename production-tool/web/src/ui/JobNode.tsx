// A job in place: where its output will land, it shows the queue position and
// elapsed time; when it fails, the error with Retry and Report. Never a toast.

import { useState } from 'react'
import { useDoc, useJobsTick, useServices } from '../app/context'
import { isActive } from '../jobs/runner'
import { fmtElapsed, useElapsed } from './hooks'

const STATE_LABEL: Record<string, string> = {
  queued: 'In the queue',
  submitting: 'Sending…',
  submitted: 'Making it…',
  fetching: 'Almost there…',
  validating: 'Checking…',
  uncertain: 'Checking with the provider…',
}

export function JobNode({ jobId, compact = false, onRetried }: { jobId: string; compact?: boolean; onRetried?: (newId: string) => void }) {
  const { runner } = useServices()
  const doc = useDoc()
  useJobsTick()
  const job = doc.jobs.find((j) => j.id === jobId)
  const live = runner.liveInfo(jobId)
  const state = live?.state ?? job?.state ?? 'queued'
  const running = isActive(state)
  const elapsed = useElapsed(job?.created_at, running)
  const [reported, setReported] = useState<'no' | 'sending' | 'yes' | 'failed'>('no')

  if (!job) return null

  if (state === 'failed' || state === 'cancelled') {
    const err = job.error
    const cancelled = state === 'cancelled'
    const retryable = cancelled || (err?.retryable ?? true)
    return (
      <div className="errnode" role="alert">
        <div className="msg">{cancelled ? 'Cancelled.' : err?.message ?? 'Something went wrong.'}</div>
        {!compact && err?.code && <div className="code">{err.code}{err.providerCode ? ` · ${err.providerCode}` : ''}</div>}
        <div className="row">
          {retryable && (
            <button className="btn xs primary" onClick={async () => {
              const id = await runner.retry(jobId)
              if (id) onRetried?.(id)
            }}>Retry</button>
          )}
          {!cancelled && (
            <button className="btn xs" disabled={reported === 'sending' || reported === 'yes'} onClick={async () => {
              setReported('sending')
              const ok = await runner.report(jobId, `${job.op} ${err?.code ?? ''}: ${err?.message ?? ''}`)
              setReported(ok ? 'yes' : 'failed')
            }}>{reported === 'yes' ? 'Reported' : reported === 'failed' ? 'Report again' : 'Report'}</button>
          )}
          <button className="btn xs ghost" onClick={() => runner.dismiss(jobId)}>Clear</button>
        </div>
      </div>
    )
  }

  if (!running) return null

  const q = live?.queuePosition
  return (
    <div className="pending" aria-live="polite">
      <div className="spinner" />
      <div className="state">{STATE_LABEL[state] ?? 'Working…'}</div>
      <div className="meta">
        {q ? `#${q} in queue · ` : ''}{fmtElapsed(elapsed)}
      </div>
      {!compact && (
        <button className="btn xs ghost" onClick={() => runner.cancel(jobId)}>Cancel</button>
      )}
    </div>
  )
}
