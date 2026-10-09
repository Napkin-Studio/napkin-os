// The update box (decided 2026-10-09): a steered update shows its plan first when it has
// more than one item (the items in order, why each one, the cost: Start, Do them as they
// are, Cancel; features/one-to-one-updates.clan), then each frame and clip here, one at a
// time, in order. Words for that request
// only (never the script), the model (starting on the last that worked for that
// step), "Make it". The new version replaces the old one once it lands; a failure
// stays here with its error, to make again on another model. The run: jobs/follow.ts.

import { useState } from 'react'
import { useConfig, useDoc, useJobsTick, useServices, useUi } from '../app/context'
import { choiceToSend, modelChoicesFor } from '../capabilities'
import type { ModelChoice } from '../contracts/types'
import type { FollowItem } from '../doc/ui'
import { selectedTake } from '../jobs/clips'
import { beginFollow, cancelFollow, followState, makeAwaited, planSummary, planWords, restAsTheyAre } from '../jobs/follow'
import { selectedFrame } from '../jobs/frames'
import { frameStale, takeStale } from '../jobs/stale'
import { AgentFigure } from './agents/AgentFigure'
import { behindLabel } from './behind'
import { useBlobUrl } from './hooks'
import { JobNode } from './JobNode'
import { ModelPick } from './ModelPick'

const keyOf = (c: ModelChoice) => `${c.provider}:${c.model}`

export function UpdateBox() {
  const ui = useUi()
  const doc = useDoc()
  useJobsTick()
  // Minimised to a pill; held here, not in Box, so it stays minimised from one item to the next.
  const [min, setMin] = useState(false)
  const run = ui.following
  const state = followState(doc, (id) => ui.jobCtx[id], run)
  if (!run || !state || run.cancel) return null
  if (run.reviewing) {
    if (min) {
      return (
        <button className="updatebox-pill waiting" onClick={() => setMin(false)} aria-label="Open the update" title="Waiting for you: check the plan and start it">
          <AgentFigure agent="dex" state="idle" size={22} decorative />
          <b>Update</b>
          <span className="faint">{run.total ?? '…'} to make · waiting for you</span>
        </button>
      )
    }
    return <Plan onMinimise={() => setMin(true)} />
  }
  // The item on show: the one waiting for the user, else the steered one being made now.
  const runningCtx = state.running ? ui.jobCtx[state.running.id] : undefined
  const making: FollowItem | undefined = runningCtx?.for === 'frame' || runningCtx?.for === 'clip' ? { kind: runningCtx.for, shotId: runningCtx.shotId } : undefined
  const item = run.awaiting ?? (run.steer ? making : undefined)
  if (!item) return null
  const shot = (doc.shots ?? []).find((s) => s.id === item.shotId)
  if (min) {
    const waiting = !!run.awaiting && !state.running
    return (
      <button className={`updatebox-pill ${waiting ? 'waiting' : ''}`} onClick={() => setMin(false)} aria-label="Open the update"
        title={waiting ? 'Waiting for you: open to make it' : 'Open the update box'}>
        <AgentFigure agent="dex" state={state.running ? 'working' : 'idle'} size={22} decorative />
        <b>Update</b>
        <span className="faint">{Math.min(state.done + (run.awaiting ? 1 : 0), run.total ?? 99)} of {run.total ?? '…'}</span>
        {shot && <span className="faint">· Shot {shot.order} {item.kind}{waiting ? ' · waiting for you' : state.running ? ' · making' : ''}</span>}
      </button>
    )
  }
  return <Box key={`${item.kind}:${item.shotId}`} item={item} jobId={state.running?.id ?? (run.awaiting ? state.failed?.id : undefined)} onMinimise={() => setMin(true)} />
}

/** A plan of more than one item, shown before anything is sent: the items in order, each with why, and the cost. */
function Plan({ onMinimise }: { onMinimise: () => void }) {
  const { doc: docStore, ui: uiStore, runner, relay } = useServices()
  const doc = useDoc()
  const ui = useUi()
  const { config } = useConfig()
  const run = ui.following!
  const deps = { relay, doc: docStore, ui: uiStore, runner }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const plan = { frames: run.frameShots ?? [], clips: run.clipShots, ad: run.ad }
  const shots = doc.shots ?? []
  const rows: { key: string; what: string; why: string }[] = [
    ...shots.filter((s) => plan.frames.includes(s.id)).map((s) => {
      const mark = frameStale(doc, s.id)
      return { key: `f:${s.id}`, what: `Frame ${s.order}`, why: mark ? behindLabel(doc, mark) : selectedFrame(doc, s.id) ? 'Carries the look forward' : 'Not made yet' }
    }),
    ...shots.filter((s) => plan.clips.includes(s.id)).map((s) => {
      const mark = takeStale(doc, s.id)
      return { key: `c:${s.id}`, what: `Clip ${s.order}`, why: mark ? behindLabel(doc, mark) : plan.frames.includes(s.id) ? 'Follows its new frame' : selectedTake(doc, s.id) ? 'Carries forward' : 'Not made yet' }
    }),
    ...(plan.ad ? [{ key: 'ad', what: 'The ad', why: 'Follows the new clips' }] : []),
  ]
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <aside className="updatebox" role="dialog" aria-label="Update" onClick={(e) => e.stopPropagation()}>
      <div className="row">
        <AgentFigure agent="dex" state="idle" size={30} decorative />
        <b>Update</b>
        <span className="faint">{planWords(plan)}</span>
        <span className="spacer" />
        <button className="btn xs icon ghost" onClick={onMinimise} aria-label="Minimise" title="Minimise: nothing is made until you start">–</button>
      </div>
      <ol className="ub-plan">
        {rows.map((r) => <li key={r.key}><b>{r.what}</b><span className="faint">{r.why}</span></li>)}
      </ol>
      <div className="faint" style={{ fontSize: 12 }}>{planSummary(plan, config, undefined, run.models)}. One at a time, in this order: your words and model for each.</div>
      {error && <div role="alert" style={{ color: 'var(--danger)', fontWeight: 600, fontSize: 12.5 }}>{error}</div>}
      <div className="row wrap" style={{ justifyContent: 'flex-end' }}>
        <button className="btn sm ghost" disabled={busy} onClick={() => act(() => cancelFollow(deps))} title="Make nothing">Cancel</button>
        <button className="btn sm" disabled={busy} onClick={() => act(() => restAsTheyAre(deps))}
          title="Make them all on the models they start on, with no words">Do them as they are</button>
        <button className="btn sm primary" disabled={busy} onClick={() => act(() => beginFollow(deps))}>Start</button>
      </div>
    </aside>
  )
}

function Box({ item, jobId, onMinimise }: { item: FollowItem; jobId?: string; onMinimise: () => void }) {
  const { doc: docStore, ui: uiStore, runner, relay } = useServices()
  const doc = useDoc()
  const ui = useUi()
  const { config } = useConfig()
  const run = ui.following!
  const deps = { relay, doc: docStore, ui: uiStore, runner }
  const [words, setWords] = useState('')
  const [pick, setPick] = useState<ModelChoice | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const shot = (doc.shots ?? []).find((s) => s.id === item.shotId)
  const thumb = useBlobUrl(shot ? selectedFrame(doc, shot.id)?.asset ?? shot.storyboard_frame : undefined)
  if (!shot) return null
  const options = modelChoicesFor(item.kind, config)
  const sent = run.models?.[item.kind]
  const choice = pick ?? (sent && options.find((o) => keyOf(o) === keyOf(sent))) ?? options[0]
  const mark = item.kind === 'frame' ? frameStale(doc, shot.id) : takeStale(doc, shot.id)
  const job = jobId ? doc.jobs.find((j) => j.id === jobId) : undefined
  const making = !!job && !['completed', 'failed', 'cancelled'].includes(job.state)
  const why = making ? (mark ? 'Updating…' : 'Making it…') : mark ? behindLabel(doc, mark) : item.kind === 'frame' ? 'It has no frame' : 'It has no clip'
  const n = Math.min(run.framesDone.length + run.clipsDone.length + (run.awaiting ? 1 : 0), run.total ?? 99)
  const toSend = () => (choice ? choiceToSend(item.kind, config, choice) ?? null : null)

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="updatebox" role="dialog" aria-label="Update" onClick={(e) => e.stopPropagation()}>
      <div className="row">
        <AgentFigure agent="dex" state={making ? 'working' : 'idle'} size={30} decorative />
        <b>Update</b>
        <span className="faint">{n} of {run.total ?? '…'}</span>
        <span className="spacer" />
        <button className="btn xs icon ghost" onClick={onMinimise} aria-label="Minimise" title="Minimise: the run goes on">–</button>
        <button className="btn xs ghost" onClick={() => void cancelFollow(deps)} title="Stop after the step running now; nothing else is made">Stop</button>
      </div>
      <div className="row ub-item">
        {thumb ? <img src={thumb} alt="" /> : <span className="ub-empty" />}
        <div className="stack" style={{ gap: 2 }}>
          <b>Shot {shot.order} · {item.kind === 'frame' ? 'frame' : 'clip'}</b>
          <span className={`behind ${making ? 'updating' : ''}`} title={mark?.reason}>{why}</span>
        </div>
      </div>
      {job && <div className="ub-job"><JobNode jobId={job.id} /></div>}
      {!making && (
        <>
          <textarea className="textarea" rows={2} maxLength={1000} value={words} onChange={(e) => setWords(e.target.value)}
            placeholder={`Add words for this ${item.kind} only (optional)`} />
          <ModelPick op={item.kind} value={choice} onChange={setPick} />
          <div className="faint" style={{ fontSize: 12 }}>{item.kind === 'frame' ? 'The old frame is replaced once the new one lands.' : 'The old clip is replaced once the new one lands.'}</div>
          {error && <div role="alert" style={{ color: 'var(--danger)', fontWeight: 600, fontSize: 12.5 }}>{error}</div>}
          <div className="row wrap" style={{ justifyContent: 'flex-end' }}>
            <button className="btn sm" disabled={busy} onClick={() => act(() => restAsTheyAre(deps, toSend()))}
              title="Make this and every one after it on these models, with no words; the ad renders at the end">Do the rest as they are</button>
            <button className="btn sm primary" disabled={busy} onClick={() => act(() => makeAwaited(deps, { text: words, modelChoice: toSend() }))}>
              {job ? 'Make it again' : 'Make it'}
            </button>
          </div>
        </>
      )}
    </aside>
  )
}
