// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Setting an agency up (features/agency-setup.clan; v2 section 5): a short flow that starts with the
// logo and asks for nothing before it. Name, people, clients and jobs follow, and every one of them can
// be skipped and picked up later. Nothing is stored about how far someone got: the server reads each
// step's progress from the data (a logo, a name, a person besides the admin, a client, a job), so
// coming back resumes at the first step whose data is not there yet.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { FailedSave, Loading, MissingAccess } from '../../components/states/ScreenStates'
import type { Route } from '../route'
import { applyAgencyLook, getAgencyLook, lookFromFile, saveAgencyLook, type AgencyLook } from '../agency/look'
import { CsvImport } from './CsvImport'
import { readSettings, readSetup, saveSettings, type SetupStatus } from './api'
import { firstUnfinished, isDone, nextStep, numberOf, prevStep, STEPS, stepOf, type StepId } from './model'
import '../home/home.css'
import './setup.css'

type Load = 'loading' | 'ready' | 'refused' | 'failed'

export function SetupFlow({ go }: { go: (r: Route) => void }) {
  const [load, setLoad] = useState<Load>('loading')
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [step, setStep] = useState<StepId | null>(null)
  const [name, setName] = useState('')
  const top = useRef<HTMLDivElement>(null)

  const apply = useCallback((s: Awaited<ReturnType<typeof readSetup>>, cfg: Awaited<ReturnType<typeof readSettings>>, resume: boolean) => {
    if (!s.ok) { setLoad(s.status === 403 ? 'refused' : 'failed'); return }
    setStatus(s.data)
    if (cfg.ok) setName(cfg.data.name)
    // Opening the flow resumes at the first step not done; a later read keeps where the person is.
    if (resume) setStep(firstUnfinished(s.data) ?? 'logo')
    setLoad('ready')
  }, [])
  const read = useCallback(async (resume: boolean) => { apply(...(await Promise.all([readSetup(), readSettings()])), resume) }, [apply])
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    void Promise.all([readSetup(), readSettings()]).then(([s, cfg]) => { if (live) apply(s, cfg, true) })
    return () => { live = false }
  }, [apply, attempt])
  useEffect(() => { top.current?.querySelector<HTMLElement>('[data-testid="setup-step"] h2')?.focus({ preventScroll: true }) }, [step])

  const home = () => go({ level: 'agency' })
  const leave = <button type="button" className="side-link" data-testid="to-home" onClick={home}>Back to your home</button>

  let body: ReactNode
  if (load === 'loading') body = <Loading what="your setup" rows={3} />
  else if (load === 'refused') body = <MissingAccess what="the agency's setup" who="an admin of this agency" />
  else if (load === 'failed' || !step || !status) body = <FailedSave onRetry={() => { setLoad('loading'); setAttempt(a => a + 1) }} primary={false} />
  else body = <StepPage step={step} status={status} agency={name || null} onStep={setStep} onRead={() => read(false)} onName={setName} onFinish={home} />

  return (
    <div className="nui nui-page" ref={top} data-testid="setup" data-step={step ?? undefined}>
      <div className="studio-shell">
        <section className="app-head">
          <div className="app-head-text">
            <div className="eyebrow">SET UP</div>
            <h1 className="hero-title" data-testid="setup-title">{name ? `Set up ${name}` : 'Set up your agency'}<span className="period-dot" aria-hidden /></h1>
            <p className="hero-sub">Five short steps. Skip any of them and come back when you are ready.</p>
          </div>
          <div className="hm-tools">{leave}</div>
        </section>
        <main className="hm-main">{body}</main>
      </div>
    </div>
  )
}

interface PageProps {
  step: StepId
  status: SetupStatus
  agency: string | null
  onStep: (s: StepId) => void
  onRead: () => Promise<void>
  onName: (n: string) => void
  onFinish: () => void
}

/** The step list and the step in hand, drawn from the status the server read. */
export function StepPage({ step, status, agency, onStep, onRead, onName, onFinish }: PageProps) {
  const info = stepOf(step)
  const next = nextStep(step)
  const prev = prevStep(step)
  return (
    <div className="su-layout">
      <nav className="su-steps" aria-label="Setup steps" data-testid="setup-steps">
        <ol>
          {STEPS.map(s => (
            <li key={s.id}>
              <button type="button" className="su-stepbtn" data-testid="setup-nav" data-step={s.id} data-done={isDone(status, s.id) || undefined}
                aria-current={s.id === step ? 'step' : undefined} onClick={() => onStep(s.id)}>
                <i aria-hidden>{isDone(status, s.id) ? '✓' : numberOf(s.id)}</i>
                <span>{s.nav}</span>
                {isDone(status, s.id) && <span className="su-sr"> done</span>}
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <section className="su-card" data-testid="setup-step" data-step={step} aria-labelledby="su-title">
        <p className="su-count">Step {numberOf(step)} of {STEPS.length}</p>
        <h2 id="su-title" tabIndex={-1} className="su-title">{info.title}</h2>
        <p className="su-line">{info.line}</p>
        {step === 'logo' && <LogoStep onSaved={onRead} />}
        {step === 'name' && <NameStep onSaved={n => { onName(n); void onRead() }} />}
        {step === 'people' && <PeopleStep agency={agency} onRead={onRead} />}
        {step === 'clients' && (
          <CsvImport kind="clients" agency={agency} onImported={() => void onRead()}
            help={<p>The first line names the column: <b>name</b>. You can add <b>material</b> (pearl, ceramic, stone or graphite) for the client's circle.</p>} />
        )}
        {step === 'jobs' && (
          <CsvImport kind="jobs" agency={agency} onImported={() => void onRead()}
            help={<p>The first line names the columns. <b>client</b> is the only one you need, and it must match a client you have added. Optional: <b>title</b>, <b>number</b> (like J012), <b>owner</b>, <b>opened_on</b>, <b>due</b> and <b>hours</b> (the hours the job may take). Dates read as 2026-12-18 or 18/12/2026.</p>} />
        )}
        <div className="su-footer">
          {prev && <button type="button" className="ch-btn ch-btn-quiet su-btn" onClick={() => onStep(prev)}>Back</button>}
          {next && !isDone(status, step) && <button type="button" className="side-link su-skip" data-testid="setup-skip" onClick={() => onStep(next)}>Skip for now</button>}
          {next
            ? <button type="button" className="ch-btn ch-btn-primary su-btn" onClick={() => onStep(next)}>Next</button>
            : <button type="button" className="ch-btn ch-btn-primary su-btn" data-testid="setup-finish" onClick={onFinish}>Finish</button>}
        </div>
      </section>
    </div>
  )
}

// ── the steps ───────────────────────────────────────────────────────────────

function LogoStep({ onSaved }: { onSaved: () => Promise<void> }) {
  const [look, setLook] = useState<AgencyLook | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)
  useEffect(() => { void getAgencyLook().then(setLook) }, [])

  async function pick(file: File | undefined) {
    if (!file) return
    setNote(null); setBusy(true)
    try {
      const next = await lookFromFile(file)
      const saved = await saveAgencyLook(next)
      setLook(saved)
      applyAgencyLook(saved)
      setNote({ text: saved.accent ? 'Saved. The studio now wears your colour.' : 'Saved. Your logo has only black, white and grey, so there is no accent colour.' })
      await onSaved()
    } catch (e) {
      setNote({ text: e instanceof Error && e.message ? e.message : 'That logo could not be read. Try an SVG or a PNG.', bad: true })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="su-body">
      <div className="su-logo">
        {look?.logo ? <img src={look.logo} alt="Your logo" data-testid="setup-logo" /> : <span>{look ? 'No logo yet.' : 'Reading what is saved.'}</span>}
      </div>
      <label className="ch-btn su-btn su-file" aria-disabled={busy || undefined}>
        {look?.logo ? 'Replace your logo' : 'Choose your logo'}
        <input type="file" accept=".svg,.png,image/svg+xml,image/png" data-testid="setup-logo-input" disabled={busy}
          onChange={e => { void pick(e.target.files?.[0]); e.target.value = '' }} />
      </label>
      <p className="su-sub" role={note?.bad ? 'alert' : 'status'} data-testid="setup-logo-note" data-bad={note?.bad || undefined}>{note?.text ?? ''}</p>
    </div>
  )
}

function NameStep({ onSaved }: { onSaved: (name: string) => void }) {
  const [name, setName] = useState('')
  const [cap, setCap] = useState('')
  const [phase, setPhase] = useState<'loading' | 'ready' | 'saving' | 'saved' | 'failed'>('loading')
  const [said, setSaid] = useState('')
  useEffect(() => {
    void readSettings().then(r => {
      if (r.ok) { setName(r.data.name); setCap(r.data.credit_cap_month_eur ? String(r.data.credit_cap_month_eur) : '') }
      setPhase('ready')
    })
  }, [])
  if (phase === 'loading') return <Loading what="your agency's name" rows={2} />
  const save = async () => {
    setPhase('saving'); setSaid('')
    const amount = cap.trim() === '' ? 0 : Number(cap.replace(',', '.'))
    if (!Number.isFinite(amount) || amount < 0) { setSaid('The monthly cap is an amount in euros, not below zero.'); setPhase('ready'); return }
    const r = await saveSettings({ name, credit_cap_month_eur: amount })
    if (r.ok) { setPhase('saved'); onSaved(r.data.name); return }
    setSaid(r.status === 400 ? r.message : ''); setPhase('failed')
  }
  return (
    <form className="su-body su-form" onSubmit={e => { e.preventDefault(); void save() }} data-testid="setup-name-form">
      <label className="su-lab">Agency name
        <input type="text" value={name} maxLength={120} autoComplete="organization" data-testid="setup-name" onChange={e => { setName(e.target.value); setPhase('ready') }} />
      </label>
      <label className="su-lab">Monthly credit cap, in euros
        <input type="text" inputMode="decimal" value={cap} data-testid="setup-cap" onChange={e => { setCap(e.target.value); setPhase('ready') }} />
        <small>What the agency means to spend on AI in a month. Napkin shows it here. It does not stop anything yet.</small>
      </label>
      {said && <p className="su-warn" role="alert">{said}</p>}
      {phase === 'failed' && <FailedSave onRetry={() => void save()} primary={false} compact />}
      <div className="su-actions">
        <button type="submit" className="ch-btn su-btn" disabled={phase === 'saving' || name.trim() === ''} data-testid="setup-name-save">{phase === 'saving' ? 'Saving' : 'Save the name'}</button>
        {phase === 'saved' && <span className="su-ok" role="status" data-testid="setup-name-saved">Saved.</span>}
      </div>
    </form>
  )
}

function PeopleStep({ agency, onRead }: { agency: string | null; onRead: () => Promise<void> }) {
  const [imported, setImported] = useState(false)
  return (
    <>
      <CsvImport kind="people" agency={agency} onImported={() => { setImported(true); void onRead() }}
        help={(
          <>
            <p>The first line names the columns: <b>email</b>, <b>name</b> and <b>roles</b>. Put more than one role in a cell by separating them with a semicolon.</p>
            <p>Roles are the ones your homes know, like planning, creative-director, copywriter or producer. Use <b>admin</b> for someone who runs the studio.</p>
            <p>A person signs in as the first part of their email, then @ and your agency's short name.</p>
          </>
        )} />
      {imported && <p className="su-sub"><a className="side-link" href="#people" data-testid="setup-to-people">Look over the people and their roles</a></p>}
    </>
  )
}
