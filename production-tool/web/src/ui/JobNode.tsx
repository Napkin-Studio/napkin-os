// A job in place: where its output will land, it shows the queue position and
// elapsed time; when it fails, the error with Retry, another model to try, and Report. Never a toast.

import { useState } from 'react'
import { useConfig, useDoc, useJobsTick, useServices } from '../app/context'
import { choiceToSend, modelChoicesFor } from '../capabilities'
import type { DocJob } from '../contracts/types'
import { isActive } from '../jobs/runner'
import { cancelText, mayStillCharge } from './cancel'
import { InlineConfirm } from './Undo'
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
  const [confirming, setConfirming] = useState(false)
  const { config } = useConfig()

  if (!job) return null

  if (state === 'failed' || state === 'cancelled') {
    const err = job.error
    const cancelled = state === 'cancelled'
    const retryable = cancelled || (err?.retryable ?? true)
    return (
      <div className={`errnode ${compact ? 'compact' : ''}`} role="alert">
        <div className="msg" title={compact ? err?.message : undefined}>{cancelled ? 'Cancelled.' : err?.message ?? 'Something went wrong.'}</div>
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
        {!cancelled && <OtherModel job={job} compact={compact} onRetried={onRetried} />}
      </div>
    )
  }

  if (!running) return null

  if (state === 'uncertain') {
    // No answer in time: the provider may have it, so it is never sent again by itself. The person
    // decides: stop waiting, or send it again knowing it may be charged twice (2026-10-09).
    return (
      <div className={`errnode ${compact ? 'compact' : ''}`} role="alert">
        <div className="msg">No answer from {job.provider ?? 'the provider'} in time. It may still make this, or it may not.</div>
        {!compact && <div className="code">uncertain{job.error?.providerCode ? ` · ${job.error.providerCode}` : ''}</div>}
        <div className="row">
          <button className="btn xs" onClick={() => void runner.cancel(jobId)} title="Stop waiting for it. If the provider did take it, it may still be charged.">Stop waiting</button>
          <button className="btn xs primary" title="Send it again. If the provider did take the first one, both may be charged." onClick={async () => {
            await runner.cancel(jobId)
            const id = await runner.retry(jobId)
            if (id) onRetried?.(id)
          }}>Try again</button>
        </div>
      </div>
    )
  }

  const q = live?.queuePosition
  return (
    <div className="pending" aria-live="polite">
      <div className="spinner" />
      <div className="state">{STATE_LABEL[state] ?? 'Working…'}</div>
      <div className="meta">
        {q ? `#${q} in queue · ` : ''}{fmtElapsed(elapsed)}
      </div>
      {!compact && (confirming
        ? <InlineConfirm text={cancelText(job, config)} yes="Stop it" onYes={() => { setConfirming(false); void runner.cancel(jobId) }} onNo={() => setConfirming(false)} />
        : <button className="btn xs ghost" onClick={() => (mayStillCharge(job, config) ? setConfirming(true) : void runner.cancel(jobId))}>Cancel</button>)}
    </div>
  )
}

const keyOf = (c: { provider: string; model: string }) => `${c.provider}:${c.model}`

/** A failed job, sent again on another model: whatever made it fail (an account out of credit, a model
 *  that cannot take the step) may not hold on the next one. Starts on a model from another provider. */
function OtherModel({ job, compact, onRetried }: { job: DocJob; compact: boolean; onRetried?: (newId: string) => void }) {
  const { runner } = useServices()
  const { config } = useConfig()
  const options = modelChoicesFor(job.op, config).filter((o) => !(o.provider === job.provider && o.model === job.model))
  const [chosen, setChosen] = useState<string | undefined>()
  if (!options.length) return null
  const start = options.find((o) => o.provider !== job.provider) ?? options[0]
  const pick = options.find((o) => keyOf(o) === chosen) ?? start
  return (
    <div className="row othermodel" onClick={(e) => e.stopPropagation()}>
      {!compact && <span className="faint">Try another model</span>}
      <select className="select xs" aria-label="Another model to try" value={keyOf(pick)} onChange={(e) => setChosen(e.target.value)}>
        {options.map((o) => <option key={keyOf(o)} value={keyOf(o)}>{o.label} · {o.provider}</option>)}
      </select>
      <button className="btn xs primary" onClick={async () => {
        const id = await runner.retry(job.id, choiceToSend(job.op, config, pick) ?? null)
        if (id) onRetried?.(id)
      }}>{compact ? 'Try' : 'Try it'}</button>
    </div>
  )
}
