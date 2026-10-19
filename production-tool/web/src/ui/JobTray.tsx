// The job tray (features/production-tool-look.clan): the top bar's "N running · N queued"
// as a button with the working agents' faces and a red count for failures. It opens a
// floating list, Working now and Needs you; Show on a row goes to its stage and card.

import { useCallback, useRef, useState } from 'react'
import { useDoc, useJobsTick, useServices, useUi } from '../app/context'
import { modelLabel } from '../capabilities'
import type { StageName } from '../contracts/types'
import { updateDoc } from '../doc/store'
import { AgentFigure } from './agents/AgentFigure'
import { whoIsWorking } from './agents/cast'
import { Float } from './Float'
import { fmtElapsed, useElapsed } from './hooks'
import { trayGroups, trayLabel, whereIs, type TrayRow } from './tray'

export function JobTray() {
  const { runner } = useServices()
  const doc = useDoc()
  const ui = useUi()
  useJobsTick()
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const g = trayGroups(doc.jobs, (id) => ui.jobCtx[id], (id) => runner.liveInfo(id))
  const busy = g.working.length > 0
  const faces = [...new Set([...g.working.map((r) => who(r).agent), ...(g.needsYou.length ? ['jude' as const] : [])])]
  const empty = !busy && !g.needsYou.length
  return (
    <>
      <button ref={ref} className={`jobchip tray ${busy ? 'busy' : ''} ${open ? 'open' : ''}`} aria-live="polite" aria-haspopup="dialog" aria-expanded={open}
        title={empty ? 'Nothing is being made' : 'What is being made, and what needs you'} onClick={() => setOpen(!open)}>
        {faces.length ? (
          <span className="faces" aria-hidden="true">
            {faces.map((a) => <AgentFigure key={a} agent={a} size={22} state={a === 'jude' && g.needsYou.length ? 'needs-you' : 'working'} decorative />)}
          </span>
        ) : <span className="dot" />}
        {trayLabel(g)}
        {g.needsYou.length > 0 && <><span className="sep">·</span><span className="bad">{g.needsYou.length} failed</span></>}
      </button>
      <Float anchor={ref} open={open} onClose={close} align="end" role="dialog" label="Jobs" className="traypop">
        {empty && <div className="tray-empty faint">Nothing is being made right now. Jobs show here while they run, and stay here if one fails.</div>}
        {busy && <div className="fhead">Working now</div>}
        {g.working.map((r) => <Row key={r.job.id} row={r} onShow={close} />)}
        {g.needsYou.length > 0 && <div className="fhead">Needs you</div>}
        {g.needsYou.map((r) => <Row key={r.job.id} row={r} onShow={close} />)}
      </Float>
    </>
  )

  function who(r: TrayRow) {
    const shotId = r.ctx && 'shotId' in r.ctx ? r.ctx.shotId : undefined
    return whoIsWorking(r.job, r.state, r.ctx, shotId ? (doc.shots ?? []).find((s) => s.id === shotId)?.order : undefined)
  }
}

function Row({ row, onShow }: { row: TrayRow; onShow: () => void }) {
  const { doc: docStore } = useServices()
  const doc = useDoc()
  const failed = row.state === 'failed'
  const elapsed = useElapsed(row.job.created_at, !failed)
  const shotId = row.ctx && 'shotId' in row.ctx ? row.ctx.shotId : undefined
  const w = whoIsWorking(row.job, row.state, row.ctx, shotId ? (doc.shots ?? []).find((s) => s.id === shotId)?.order : undefined)
  const model = row.job.model ? modelLabel(row.job.provider, row.job.model) : undefined
  const sub = failed
    ? row.job.error?.message ?? 'Something went wrong.'
    : [model, row.state === 'queued' ? 'in the queue' : undefined, row.queuePosition ? `#${row.queuePosition} in queue` : undefined].filter(Boolean).join(' · ')
  const show = () => {
    onShow()
    const where = whereIs(row.job, row.ctx)
    void goTo(docStore, doc.stage.current, where.stage, where.shotId)
  }
  return (
    <div className={`trayrow ${failed ? 'failed' : ''}`}>
      <AgentFigure agent={w.agent} state={w.state} size={34} decorative />
      <div className="trayrow-text">
        <b>{w.line}</b>
        {sub && <small>{sub}</small>}
      </div>
      {failed
        ? <button className="btn xs" onClick={show}>Show</button>
        : <span className="trayrow-t">{fmtElapsed(elapsed)}<button className="btn xs ghost" onClick={show} aria-label={`Show ${w.line}`}>Show</button></span>}
    </div>
  )
}

/** Go to a job's stage, then bring its card into view (and select a shot card on Video). */
async function goTo(docStore: Parameters<typeof updateDoc>[0], current: StageName, stage: StageName, shotId?: string) {
  if (current !== stage) await updateDoc(docStore, (d) => { d.stage.current = stage }, 'stage')
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
