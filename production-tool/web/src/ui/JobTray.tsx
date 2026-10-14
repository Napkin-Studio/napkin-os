// The job tray (features/production-tool-look.clan): the top bar's "N running · N queued"
// as a button with the working agents' faces and a red count for failures. It opens a
// floating list, Working now, Waiting for you (a job asking a question) and Needs you; Show on a row
// goes to its stage and card.

import { useCallback, useRef, useState } from 'react'
import { useDoc, useJobsTick, useServices, useUi } from '../app/context'
import { modelLabel } from '../capabilities'
import type { StageName } from '../doc/ui'
import type { UiStore } from '../projects/uiStore'
import { ctxReader } from '../jobs/runner'
import { jobsList, shotNumber } from '../model/selectors'
import { AgentFigure } from './agents/AgentFigure'
import { whoIsWorking, workOf } from './agents/cast'
import { NapkinLoader } from './loader/NapkinLoader'
import { Float } from './Float'
import { fmtElapsed, useElapsed } from './hooks'
import { trayGroups, trayLabel, WAITING, whereIs, type TrayRow } from './tray'

export function JobTray() {
  const { runner } = useServices()
  const doc = useDoc()
  const ui = useUi()
  useJobsTick()
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const g = trayGroups(jobsList(doc), ctxReader(doc, ui), (id) => runner.liveInfo(id))
  const busy = g.working.length > 0
  const waitingFaces = new Set(g.waiting.map((r) => who(r).agent))
  const faces = [...new Set([...g.working.map((r) => who(r).agent), ...waitingFaces, ...(g.needsYou.length ? ['jude' as const] : [])])]
  const needsYou = (a: string) => (a === 'jude' && g.needsYou.length > 0) || (waitingFaces.has(a as never) && !g.working.some((r) => who(r).agent === a))
  const empty = !busy && !g.needsYou.length && !g.waiting.length
  // The bar's status pill (mock Loader): the first running job in words, only while something
  // runs, waits or failed; nothing at all when nothing is being made.
  const lead = g.working[0] ?? g.waiting[0]
  const leadLine = lead ? who(lead).line : undefined
  return (
    <>
      {!empty && (
        <button ref={ref} className={`pt-status tray ${busy ? 'busy' : ''} ${!busy && !g.waiting.length ? 'bad' : ''} ${open ? 'open' : ''}`} aria-live="polite" aria-haspopup="dialog" aria-expanded={open}
          title="What is being made, and what needs you" onClick={() => setOpen(!open)}>
          {g.working[0] && <NapkinLoader work={workOf(g.working[0].job.op, g.working[0].state)} size={20} />}
          {!g.working[0] && faces.length > 0 && (
            <span className="faces" aria-hidden="true">
              {faces.slice(0, 3).map((a) => <AgentFigure key={a} agent={a} size={20} state={needsYou(a) ? 'needs-you' : 'working'} decorative />)}
            </span>
          )}
          <span className="pt-status-line">{leadLine ?? trayLabel(g)}{g.working.length + g.waiting.length > 1 ? ` · ${trayLabel(g)}` : ''}</span>
          {g.needsYou.length > 0 && <><span className="sep">·</span><span className="bad">{g.needsYou.length} failed</span></>}
        </button>
      )}
      <Float anchor={ref} open={open} onClose={close} align="end" role="dialog" label="Jobs" className="traypop">
        {empty && <div className="tray-empty faint">Nothing is being made right now. Jobs show here while they run, and stay here if one fails.</div>}
        {busy && <div className="fhead">Working now</div>}
        {g.working.map((r) => <Row key={r.job.id} row={r} onShow={close} />)}
        {g.waiting.length > 0 && <div className="fhead">{WAITING}</div>}
        {g.waiting.map((r) => <Row key={r.job.id} row={r} onShow={close} />)}
        {g.needsYou.length > 0 && <div className="fhead">Needs you</div>}
        {g.needsYou.map((r) => <Row key={r.job.id} row={r} onShow={close} />)}
      </Float>
    </>
  )

  function who(r: TrayRow) {
    const shotId = r.ctx && 'shotId' in r.ctx ? r.ctx.shotId : undefined
    return whoIsWorking(r.job, r.state, r.ctx, shotNumber(doc, shotId) || undefined)
  }
}

function Row({ row, onShow }: { row: TrayRow; onShow: () => void }) {
  const { ui: uiStore } = useServices()
  const doc = useDoc()
  const ui = useUi()
  const failed = row.state === 'failed'
  // A job waiting for an answer shows no clock: nothing is being made (ui-behaviour 5.2).
  const waiting = row.state === 'needs_input'
  const elapsed = useElapsed(row.job.created_at, !failed && !waiting)
  const shotId = row.ctx && 'shotId' in row.ctx ? row.ctx.shotId : undefined
  const w = whoIsWorking(row.job, row.state, row.ctx, shotNumber(doc, shotId) || undefined)
  const model = row.job.model ? modelLabel(row.job.provider, row.job.model) : undefined
  const sub = failed
    ? row.job.error?.message ?? 'Something went wrong.'
    : waiting ? WAITING
    : [model, row.state === 'queued' ? 'in the queue' : undefined, row.queuePosition ? `#${row.queuePosition} in queue` : undefined].filter(Boolean).join(' · ')
  const show = () => {
    onShow()
    const where = whereIs(row.job, row.ctx)
    void goTo(uiStore, ui.stage, where.stage, where.shotId)
  }
  return (
    <div className={`trayrow ${failed ? 'failed' : ''}`}>
      <AgentFigure agent={w.agent} state={w.state} size={34} decorative />
      <div className="trayrow-text">
        <b>{w.line}</b>
        {sub && <small>{sub}</small>}
      </div>
      {failed || waiting
        ? <button className="btn xs" onClick={show}>Show</button>
        : <span className="trayrow-t">{fmtElapsed(elapsed)}<button className="btn xs ghost" onClick={show} aria-label={`Show ${w.line}`}>Show</button></span>}
    </div>
  )
}

/** Go to a job's stage, then bring its card into view (and select a shot card on Video). */
async function goTo(uiStore: UiStore, current: StageName, stage: StageName, shotId?: string) {
  if (current !== stage) uiStore.update((u) => { u.stage = stage })
  if (!shotId) return
  // The stage renders on the next frames; look for the card a few times.
  for (let i = 0; i < 20; i++) {
    const card = document.querySelector<HTMLElement>(`[data-shot-card="${CSS.escape(shotId)}"]`)
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
      if (card.getAttribute('role') === 'button') card.click()
      card.classList.remove('flash')
      void card.offsetWidth
      card.classList.add('flash')
      return
    }
    await new Promise((r) => requestAnimationFrame(r))
  }
}
