// The job tray (features/production-tool-look.clan; features/topbar-declutter.clan): the bar's agent status
// dot (Shrey 2026-11-19: Brief Maker's .tb-status .sdot, idle / working / needs you / error; the sphere stays
// only in the Booth). It opens a
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
import { chipText, dotState, jobLine, jobLook, trayGroups, WAITING, whereIs, type DotState, type TrayRow } from './tray'
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
  // The bar's status dot: its words live in the tooltip, the label, a separate live region and the
  // popover's first row, never in the bar.
  const lead = g.working[0] ?? g.waiting[0] ?? g.needsYou[0]
  const line = jobLine(g, lead && lead.state !== 'failed' ? who(lead).line : undefined)
  const look = jobLook(g)
  return (
    <>
      <StatusDot ref={ref} state={dotState(look)} line={empty ? IDLE : line}
        chip={chipText(g.waiting.length, g.working.length, g.needsYou.length, g.working[0] ? what(g.working[0]) : undefined)}
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

const IDLE = 'The agents are idle'
const SAID: Record<DotState, string> = { idle: 'Idle', working: 'Working', needs: 'Needs you', error: 'Error' }

/** The dot itself, pure for the tests: the shell's .sdot in its state's colour; its words in the tooltip and label. */
export function StatusDot({ ref, state, line, chip, open, onClick }: {
  ref?: Ref<HTMLButtonElement>
  state: DotState
  line: string
  /** "Working · frame 3", "Your call · 1": the tooltip's first words. */
  chip?: string
  open: boolean
  onClick: () => void
}) {
  const tip = [chip || SAID[state], line].filter((x, i, a) => x && a.indexOf(x) === i).join(' — ')
  return (
    <button ref={ref} type="button" className={`tb-status-dot ${open ? 'open' : ''}`} data-st={state}
      aria-label={`Agents: ${SAID[state].toLowerCase()}. ${line}`} title={tip} aria-haspopup="dialog" aria-expanded={open} onClick={onClick}>
      <i className="sdot" aria-hidden="true" />
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
