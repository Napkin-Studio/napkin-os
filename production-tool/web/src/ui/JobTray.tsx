// The job tray (features/production-tool-look.clan; features/topbar-declutter.clan): the top bar's agents' status,
// Brief Maker's dot (owner 2026-11-19: "a dot only works"; the sphere ran off its spot), idle, working, needs
// you or failed, with a few words beside it while something happens. It opens a
// floating list, Working now, Waiting for you (a job asking a question) and Needs you; Show on a row
// goes to its stage and card, and on a waiting row to its question, with the focus on its first answer
// (the Script editor for Skye's; the ask dock when no card shows it). The ask dock rides here, so every
// bar has one (ui/AskDock.tsx).

import { useCallback, useContext, useRef, useState, type Ref } from 'react'
import { RouterContext, useDoc, useJobsTick, useServices, useUi } from '../app/context'
import { scriptRoute, type Router } from '../app/route'
import { modelLabel } from '../capabilities'
import type { StageName } from '../doc/ui'
import type { UiStore } from '../projects/uiStore'
import { askOf, ctxReader } from '../jobs/runner'
import { jobsList, shotNumber } from '../model/selectors'
import { AgentFigure } from './agents/AgentFigure'
import { AskDock } from './AskDock'
import { hereOf, homeOf, sameHome, showAsk } from './askPlaces'
import { jobWhat, whoIsWorking } from './agents/cast'
import { Float } from './Float'
import { fmtElapsed, useElapsed } from './hooks'
import { chipText, jobLine, jobLook, trayGroups, WAITING, whereIs, type TrayRow } from './tray'
import { plainJobError } from '../jobs/errorWords'

export function JobTray({ phone = false }: {
  /** The phone bar: watch only, so no ask dock and no Show (asks are answered on a laptop or iPad, 2.5). */
  phone?: boolean
} = {}) {
  const { runner } = useServices()
  const doc = useDoc()
  const ui = useUi()
  useJobsTick()
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const g = trayGroups(jobsList(doc), ctxReader(doc, ui), (id) => runner.liveInfo(id))
  const busy = g.working.length > 0
  const empty = !busy && !g.needsYou.length && !g.waiting.length
  // The bar's job button: the Napkin logo alone (owner, 2026-10-15). With the busy pointer, the one
  // place the logo turns (ui-behaviour 6.5). Its words live in the tooltip, the label, a separate
  // live region and the popover's first row, never in the bar.
  const lead = g.working[0] ?? g.waiting[0] ?? g.needsYou[0]
  const line = jobLine(g, lead && lead.state !== 'failed' ? who(lead).line : undefined)
  const look = jobLook(g)
  return (
    <>
      <JobButton ref={ref} look={look} line={empty ? 'No agent is working' : line} chip={look ? chipText(g.waiting.length, g.working.length, g.needsYou.length, g.working[0] ? what(g.working[0]) : undefined) : undefined}
        open={open} onClick={() => setOpen(!open)} />
      <span className="pt-sr" role="status" aria-live="polite">{empty ? '' : line}</span>
      {!phone && <AskDock />}
      <Float anchor={ref} open={open} onClose={close} align="end" role="dialog" label="Jobs" className="traypop">
        {empty && <div className="tray-empty faint">Nothing is being made right now. Jobs show here while they run, and stay here if one fails.</div>}
        {!empty && <div className="tray-lead">{line}</div>}
        {busy && <div className="fhead">Working now</div>}
        {g.working.map((r) => <Row key={r.job.id} row={r} onShow={close} phone={phone} />)}
        {g.waiting.length > 0 && <div className="fhead">{WAITING}</div>}
        {g.waiting.map((r) => <Row key={r.job.id} row={r} onShow={close} phone={phone} />)}
        {g.needsYou.length > 0 && <div className="fhead">Needs you</div>}
        {g.needsYou.map((r) => <Row key={r.job.id} row={r} onShow={close} phone={phone} />)}
      </Float>
    </>
  )

  function what(r: TrayRow) {
    const shotId = r.ctx && 'shotId' in r.ctx ? r.ctx.shotId : undefined
    return jobWhat(r.job, r.ctx, shotNumber(doc, shotId) || undefined)
  }

  function who(r: TrayRow) {
    const shotId = r.ctx && 'shotId' in r.ctx ? r.ctx.shotId : undefined
    return whoIsWorking(r.job, r.state, r.ctx, shotNumber(doc, shotId) || undefined)
  }
}

/** The status as the shell's bars show it (Brief Maker's .tb-status, app/src/components/Toolbar.tsx): a small dot,
 *  and its words while something happens. `data-st`: idle, working, needs (a question waits) or error. Pure for
 *  the tests. */
export function JobButton({ ref, look, line, chip, open, onClick }: {
  ref?: Ref<HTMLButtonElement>
  look: ReturnType<typeof jobLook>
  line: string
  chip?: string
  open: boolean
  onClick: () => void
}) {
  const st = !look ? 'idle' : look.mark === 'ask' ? 'needs' : look.spin !== 'still' ? 'working' : look.mark === 'failed' ? 'error' : 'working'
  return (
    <button ref={ref} type="button" className={`tb-status pt-job ${open ? 'open' : ''}`} data-st={st}
      aria-label={line} data-tip={line} aria-haspopup="dialog" aria-expanded={open} onClick={onClick}>
      <i className="sdot" aria-hidden="true" />
      {chip && <span className="jb-text" aria-hidden="true">{chip}</span>}
    </button>
  )
}

function Row({ row, onShow, phone }: { row: TrayRow; onShow: () => void; phone: boolean }) {
  const { ui: uiStore, project } = useServices()
  const router = useContext(RouterContext)
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
    ? (row.job.error ? plainJobError(row.job.error, row.job.op).message : 'Something went wrong.')
    : waiting ? WAITING
    : [model, row.state === 'queued' ? 'in the queue' : undefined, row.queuePosition ? `#${row.queuePosition} in queue` : undefined].filter(Boolean).join(' · ')
  const ask = waiting ? askOf(doc, row.job.id) : undefined
  const show = () => {
    onShow()
    if (ask) return void goToAsk(uiStore, router, project.id, ui.stage, row, ask.id)
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
      {phone ? (failed || waiting ? null : <span className="trayrow-t">{fmtElapsed(elapsed)}</span>)
        : failed || waiting
        ? <button className="btn xs" onClick={show}>Show</button>
        : <span className="trayrow-t">{fmtElapsed(elapsed)}<button className="btn xs ghost" onClick={show} aria-label={`Show ${w.line}`}>Show</button></span>}
    </div>
  )
}

/** A waiting job's question: go where it belongs (its script's editor for Skye's, else its stage), then bring
 *  its card into view with the focus on the first answer; when no card shows it, the dock does. */
async function goToAsk(uiStore: UiStore, router: Router | null, projectId: string, current: StageName, row: TrayRow, askId: string) {
  const home = homeOf(row.job, row.ctx)
  const here = hereOf(router?.get() ?? null, current)
  if (!sameHome(home, here)) {
    if ('script' in home) router?.push(scriptRoute(projectId, home.script))
    else {
      if (current !== home.stage) uiStore.update((u) => { u.stage = home.stage })
      if (router?.get().kind === 'script') router.leave()
    }
  }
  await showAsk(askId)
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
      if (card.getAttribute('role') === 'button' || card.dataset.select === 'shot') card.click()
      card.classList.remove('flash')
      void card.offsetWidth
      card.classList.add('flash')
      return
    }
    await new Promise((r) => requestAnimationFrame(r))
  }
}
