// The busy pointer (ui-behaviour 6.7): while a job you started runs, the same loader rides at the
// arrow's lower right (14px on an 18px white disc, +11,+15), with a count when more than one runs.
// The system arrow stays as it is. Held still for 0.6 s, a dark pill says who is working on what.
// It hides while a button is held (a drag, a stroke), when the pointer leaves, and on touch.

import { useEffect, useRef, useState } from 'react'
import { useDoc, useJobsTick, useServices, useUi } from '../../app/context'
import { isActive, jobCtx, LOCAL_PERSON } from '../../jobs/runner'
import { jobsList, shotNumber } from '../../model/selectors'
import { whoIsWorking, workOf } from '../agents/cast'
import { NapkinLoader } from './NapkinLoader'

export function BusyPointer() {
  const { runner } = useServices()
  const doc = useDoc()
  const ui = useUi()
  useJobsTick()
  const me = ui.me ? `human:${ui.me.participantId}` : LOCAL_PERSON
  const mine = jobsList(doc)
    .filter((j) => j.started_by === me)
    .map((j) => ({ job: j, state: runner.liveInfo(j.id)?.state ?? j.state }))
    .filter((r) => isActive(r.state) && r.state !== 'needs_input')
    .sort((a, b) => (a.job.created_at < b.job.created_at ? 1 : -1))
  const lead = mine[0]
  const el = useRef<HTMLDivElement>(null)
  const [label, setLabel] = useState(false)
  const [shown, setShown] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const active = !!lead
  useEffect(() => {
    if (!active) return
    const move = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || e.buttons) { setShown(false); return }
      if (el.current) el.current.style.transform = `translate(${e.clientX + 11}px, ${e.clientY + 15}px)`
      setShown(true)
      setLabel(false)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setLabel(true), 600)
    }
    const leave = () => setShown(false)
    window.addEventListener('pointermove', move, { passive: true })
    document.documentElement.addEventListener('pointerleave', leave)
    return () => {
      window.removeEventListener('pointermove', move)
      document.documentElement.removeEventListener('pointerleave', leave)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [active])
  if (!lead) return null
  const ctx = jobCtx(doc, ui, lead.job.id)
  const shotId = ctx && 'shotId' in ctx ? ctx.shotId : undefined
  const who = whoIsWorking(lead.job, lead.state, ctx, shotId ? shotNumber(doc, shotId) || undefined : undefined)
  return (
    <div ref={el} className="busy-pointer" style={{ visibility: shown ? 'visible' : 'hidden' }} aria-hidden="true">
      <span className="bp-disc"><NapkinLoader work={workOf(lead.job.op, lead.state)} size={14} /></span>
      {mine.length > 1 && <span className="bp-count">{mine.length}</span>}
      {label && <span className="bp-label">{who.line} · started by you</span>}
    </div>
  )
}
