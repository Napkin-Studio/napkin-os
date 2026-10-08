// A job in place: where its output will land, it shows the queue position and
// elapsed time; when it fails, the error and one floating bar: Retry, Try another model (a menu),
// Report, Clear. Never a toast.

import { useCallback, useRef, useState } from 'react'
import { useConfig, useDoc, useJobsTick, useServices } from '../app/context'
import { choiceToSend, modelChoicesFor } from '../capabilities'
import type { DocJob } from '../contracts/types'
import { isActive } from '../jobs/runner'
import { cancelText, mayStillCharge } from './cancel'
import { Float } from './Float'
import { otherModels } from './modelChoice'
import { ModelItems } from './ModelPick'
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
    const report = async () => {
      setReported('sending')
      const ok = await runner.report(jobId, `${job.op} ${err?.code ?? ''}: ${err?.message ?? ''}`)
      setReported(ok ? 'yes' : 'failed')
    }
    const reportLabel = reported === 'yes' ? 'Reported' : reported === 'failed' ? 'Report again' : 'Report'
    return (
      <div className={`errnode ${compact ? 'compact' : ''}`} role="alert">
        <div className="msg" title={compact ? err?.message : undefined}>{cancelled ? 'Cancelled.' : err?.message ?? 'Something went wrong.'}</div>
        {!compact && err?.code && <div className="code">{err.code}{err.providerCode ? ` · ${err.providerCode}` : ''}</div>}
        {/* One floating bar of what to do next: Retry, another model, Report, Clear. */}
        <div className="optbar" role="group" aria-label="What to do with this job">
          {retryable && (
            <button className={`btn ${compact ? 'xs' : 'sm'} ghost`} title="Send it again as it was" onClick={async () => {
              const id = await runner.retry(jobId)
              if (id) onRetried?.(id)
            }}>↻ Retry</button>
          )}
          {!cancelled && <OtherModel job={job} compact={compact} onRetried={onRetried} />}
          {!cancelled && (
            <button className={`btn ${compact ? 'xs icon' : 'sm'} ghost`} disabled={reported === 'sending' || reported === 'yes'}
              aria-label={reportLabel} title={compact ? reportLabel : 'Tell the organisers this failed'} onClick={report}>
              {compact ? '⚑' : reportLabel}
            </button>
          )}
          <button className={`btn ${compact ? 'xs' : 'sm'} icon ghost`} aria-label="Clear" title="Clear" onClick={() => runner.dismiss(jobId)}>✕</button>
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
      {!compact && (confirming
        ? <InlineConfirm text={cancelText(job, config)} yes="Stop it" onYes={() => { setConfirming(false); void runner.cancel(jobId) }} onNo={() => setConfirming(false)} />
        : <button className="btn xs ghost" onClick={() => (mayStillCharge(job, config) ? setConfirming(true) : void runner.cancel(jobId))}>Cancel</button>)}
    </div>
  )
}

/** A failed job, sent again on another model: whatever made it fail (an account out of credit, a model
 *  that cannot take the step) may not hold on the next one. A button that opens the model menu, models
 *  from another provider first; picking one sends the job again on it. */
function OtherModel({ job, compact, onRetried }: { job: DocJob; compact: boolean; onRetried?: (newId: string) => void }) {
  const { runner } = useServices()
  const { config } = useConfig()
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const options = otherModels(modelChoicesFor(job.op, config), job)
  if (!options.length) return null
  return (
    <>
      <button ref={ref} className={`btn ${compact ? 'xs' : 'sm'} ${open ? 'on' : 'ghost'}`} aria-haspopup="menu" aria-expanded={open}
        title="Send it again on another model" onClick={(e) => { e.stopPropagation(); setOpen(!open) }}>
        ⇄ {compact ? 'Model' : 'Try another model'} <span className="caret" aria-hidden="true">▾</span>
      </button>
      <Float anchor={ref} open={open} onClose={close} align="center" label="Another model to try" className="modelmenu">
        <div className="fhead">Make it again with</div>
        <ModelItems options={options} tagOther={job.provider} onPick={async (o) => {
          close()
          const id = await runner.retry(job.id, choiceToSend(job.op, config, o) ?? null)
          if (id) onRetried?.(id)
        }} />
        <div className="fnote">Same request, same references: only the model changes.</div>
      </Float>
    </>
  )
}
