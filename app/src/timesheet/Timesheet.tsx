// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The person's own day (docs/design/timesheet-day.html; v2 section 6). Drafted from their work
// sessions and their own decisions, gaps flagged with a best guess, one tap to confirm. Nothing is
// submitted anywhere: confirming keeps the day for them. A person who has said no sees the same
// page and fills the day by hand, with no warning and no score. Every line of a confirmed day links
// back to the sessions it was built from.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loading } from '../components/states/ScreenStates'
import type { Route } from '../shell/route'
import { addLine, changeLine, confirmDay, eraseMine, jobChoices, readDay, reopenDay, type Day, type Gap, type Line } from './api'
import { Ask } from './Ask'
import { answer, useConsent } from './consent'
import { builtFrom, confirmWords, dayTitle, gapWords, hm, localDate } from './words'
import '../shell/home/home.css'
import './timesheet.css'

type Jobs = { number: string; client: string }[]

export function Timesheet({ go }: { go: (r: Route) => void }) {
  const consent = useConsent()
  const [date] = useState(() => localDate())
  const [day, setDay] = useState<Day | null>(null)
  const [jobs, setJobs] = useState<Jobs>([])
  const [error, setError] = useState<string | null>(null)
  const [changing, setChanging] = useState(false)
  const top = useRef<HTMLDivElement>(null)

  // Read again after any change: a tick re-runs the read.
  const [tick, setTick] = useState(0)
  const load = useCallback(async () => { setTick(t => t + 1) }, [])
  useEffect(() => {
    if (!consent) return
    let live = true
    readDay(date)
      .then(d => { if (live) { setDay(d); setError(null) } })
      .catch(e => { if (live) setError(String(e instanceof Error ? e.message : e)) })
    return () => { live = false }
  }, [consent, date, tick])
  useEffect(() => {
    if (!consent) return
    let live = true
    void jobChoices().then(j => { if (live) setJobs(j) })
    return () => { live = false }
  }, [consent])
  useEffect(() => { top.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true }) }, [])

  const name = (job: string | null, label: string) => {
    if (!job) return `Agency · ${label}`
    const c = jobs.find(j => j.number === job)?.client
    return `${job}${c ? ` ${c}` : ''} · ${label}`
  }
  const act = async (f: () => Promise<unknown>) => {
    try { await f(); await load() } catch (e) { setError(String(e instanceof Error ? e.message : e)) }
  }

  let body
  if (consent === null || (consent !== 'not_asked' && !day && !error)) {
    body = <Loading what="your day" rows={3} />
  } else if (consent === 'not_asked' || changing) {
    body = <div className="ts-read"><Ask variant="page" /></div>
  } else if (!day) {
    body = <p className="nui-empty" role="alert">Your day cannot be read just now. {error}</p>
  } else {
    body = (
      <div className="ts-cols">
        <div className="ts-main">
          <p className="ts-sub">
            {day.consent === 'yes' ? 'Drafted from your own work in Napkin OS. Nothing is sent until you confirm.' : 'Add the day by hand. Nothing is sent until you confirm.'}
          </p>
          {day.lines.length === 0 && day.gaps.length === 0 && (
            <p className="nui-empty" data-testid="timesheet-empty">
              {day.consent === 'yes' ? 'No work sessions yet today. Open a job’s document and they are noted here.' : 'No time added yet today.'}
            </p>
          )}
          <ul className="ts-day" data-testid="timesheet-lines">
            {day.lines.map(l => <LineRow key={l.key} line={l} title={name(l.job, l.label)} locked={day.status === 'confirmed'} onSave={m => act(() => changeLine(date, l.key, m))} />)}
            {day.status === 'draft' && day.gaps.map(g => <GapRow key={g.from} gap={g} name={name}
              onUse={() => act(() => addLine({ date, job: g.guess!.job, label: g.guess!.label, minutes: g.minutes, source: 'guess', from: g.from, session_ids: g.session_ids }))}
              onAdd={() => document.getElementById('ts-hand')?.scrollIntoView({ block: 'center' })} />)}
          </ul>
          {day.status === 'draft' && <HandForm jobs={jobs} onAdd={(job, label, minutes) => act(() => addLine({ date, job, label, minutes }))} />}
          {error && <p className="ts-note" role="alert">{error}</p>}
        </div>
        <aside className="ts-side">
          <section className="ts-sec">
            {day.status === 'draft' ? (
              <>
                <button type="button" className="ch-btn ch-btn-primary ts-btn ts-confirm" disabled={day.lines.length === 0} onClick={() => void act(() => confirmDay(date))}>{confirmWords(day.total_minutes)}</button>
                <p className="ts-reason">One tap. You can change a confirmed day until Friday.</p>
              </>
            ) : (
              <>
                <p className="ts-done" data-testid="timesheet-confirmed" role="status">Confirmed, {hm(day.total_minutes)}.</p>
                <p className="ts-reason">You can change this day until {dayTitle(day.editable_until)}.</p>
                <button type="button" className="ch-btn ts-btn" onClick={() => void act(() => reopenDay(date))}>Change this day</button>
              </>
            )}
          </section>
          <section className="ts-sec">
            <h2 className="hm-h">What is captured</h2>
            <p>Work sessions inside Napkin OS: {day.consent === 'yes' ? 'on' : 'off'}. <button type="button" className="side-link" onClick={() => setChanging(true)}>Change</button></p>
            <p className="ts-reason">No keystrokes, no screen capture. Your corrections are private to you.</p>
            <button type="button" className="side-link" onClick={() => { if (window.confirm('Delete every work session and correction kept about you?')) void act(eraseMine) }}>Delete what is kept about me</button>
          </section>
        </aside>
      </div>
    )
  }

  return (
    <div className="nui nui-page" ref={top} data-testid="timesheet" data-consent={consent ?? undefined}>
      <div className="studio-shell">
        <section className="app-head">
          <div className="app-head-text">
            <div className="eyebrow">TIMESHEET</div>
            <h1 className="hero-title" tabIndex={-1} data-testid="timesheet-title">{dayTitle(date)}<span className="period-dot" aria-hidden /></h1>
          </div>
          <div className="hm-tools"><button type="button" className="side-link" data-testid="to-home" onClick={() => go({ level: 'agency' })}>Back to your home</button></div>
        </section>
        <main className="hm-main">
          {changing && <ChangeBack onDone={() => setChanging(false)} />}
          {body}
        </main>
      </div>
    </div>
  )
}

/** Answering again, from the page: the same question, and a way back without answering. */
function ChangeBack({ onDone }: { onDone: () => void }) {
  return (
    <p className="ts-reason">
      <button type="button" className="side-link" onClick={onDone}>Keep it as it is</button>
      {' · '}
      <button type="button" className="side-link" onClick={() => { void answer(false).then(onDone) }}>Turn it off</button>
    </p>
  )
}

function LineRow({ line, title, locked, onSave }: { line: Line; title: string; locked: boolean; onSave: (minutes: number) => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(String(line.minutes))
  return (
    <li className="ts-line" data-testid="timesheet-line" data-source={line.source}>
      <span className="ts-time">{hm(line.minutes)}</span>
      <span className="ts-what">
        {title}
        <small data-testid={line.session_ids.length > 0 ? 'line-sessions' : undefined} data-sessions={line.session_ids.join(' ') || undefined}>{builtFrom(line)}</small>
      </span>
      {!locked && !editing && <button type="button" className="side-link" onClick={() => setEditing(true)}>Change</button>}
      {!locked && editing && (
        <span className="ts-edit">
          <label className="ts-lab">Minutes<input type="number" min={1} max={1440} inputMode="numeric" value={value} onChange={e => setValue(e.target.value)} /></label>
          <button type="button" className="ch-btn ts-btn" onClick={() => { const m = Math.round(Number(value)); if (m > 0) { onSave(m); setEditing(false) } }}>Save</button>
        </span>
      )}
    </li>
  )
}

function GapRow({ gap, name, onUse, onAdd }: { gap: Gap; name: (j: string | null, l: string) => string; onUse: () => void; onAdd: () => void }) {
  const w = gapWords(gap, (j, l) => name(j, l))
  return (
    <li className="ts-line ts-gap" data-testid="timesheet-gap">
      <span className="ts-time">{hm(gap.minutes)}</span>
      <span className="ts-what">{w.head}{w.guess && <small>{w.guess}</small>}</span>
      {gap.guess ? <button type="button" className="side-link" onClick={onUse}>Use this guess</button> : <button type="button" className="side-link" onClick={onAdd}>Add a line</button>}
    </li>
  )
}

function HandForm({ jobs, onAdd }: { jobs: Jobs; onAdd: (job: string | null, label: string, minutes: number) => void }) {
  const [job, setJob] = useState('')
  const [label, setLabel] = useState('')
  const [minutes, setMinutes] = useState('')
  const ok = label.trim() !== '' && Number(minutes) > 0
  return (
    <form className="ts-hand" id="ts-hand" onSubmit={e => { e.preventDefault(); if (ok) { onAdd(job || null, label.trim(), Math.round(Number(minutes))); setLabel(''); setMinutes('') } }}>
      <h2 className="hm-h">Add time by hand</h2>
      <div className="ts-fields">
        <label className="ts-lab">Job
          <select value={job} onChange={e => setJob(e.target.value)}>
            <option value="">Agency, no job</option>
            {jobs.map(j => <option key={j.number} value={j.number}>{j.number} {j.client}</option>)}
          </select>
        </label>
        <label className="ts-lab">What
          <input type="text" value={label} maxLength={80} onChange={e => setLabel(e.target.value)} />
        </label>
        <label className="ts-lab">Minutes
          <input type="number" min={1} max={1440} inputMode="numeric" value={minutes} onChange={e => setMinutes(e.target.value)} />
        </label>
        <button type="submit" className="ch-btn ts-btn" disabled={!ok}>Add to my day</button>
      </div>
    </form>
  )
}
