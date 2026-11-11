// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Brief gate, above an open brief (features/brief-gate.clan; build prompt v2 section 6).
// A slim row says where the brief stands; "Check the brief" opens the six items, each
// pass or missing with the brief's own words, the questions the client is owed, the
// two signers and the one button this person has. The host decides every state
// (`GET /gate`); this draws it and sends the person's own writes.

import { useState, type FormEvent } from 'react'
import { host } from '../../host'
import type { GateItem, GateView } from '../../host'
import type { Gate } from './useGate'
import VersionPanel from '../versions/VersionPanel'
import type { BriefUndo } from '../versions/useBriefUndo'
import {
  CREATIVE_DIRECTOR, PLANNER, ROLE_WORDS, canStartNewVersion, clientQuestions, headline, namesBoth,
  passedCount, signAction, signerLine, teamItems,
} from './words'
import './gate.css'

interface Props {
  gate: Gate
  /** The client's name, as the brief's bar shows it. */
  client: string
  /** After a write: the app reads the document again. */
  onChanged: () => void
  /** Undo and redo of the person's own edits, and the version list's entry (features/brief-versions-undo.clan). */
  undo: BriefUndo
  docPath: string
}

function Row({ item }: { item: GateItem }) {
  const pass = item.state === 'pass'
  return (
    <li className="bg-row" data-testid="gate-item" data-item={item.id} data-state={item.state}>
      <span className="bg-label">{item.label}</span>
      <span className="bg-text">{item.evidence && pass ? item.evidence : (item.why ?? '')}
        {!pass && item.evidence ? <q className="bg-quote">{item.evidence}</q> : null}
      </span>
      <span className={`bg-state ${pass ? 'pass' : 'open'}`}><i aria-hidden />{pass ? 'Passed' : 'Missing'}</span>
    </li>
  )
}

function FameForm({ busy, onSave }: { busy: boolean; onSave: (text: string) => void }) {
  const [text, setText] = useState('')
  const submit = (e: FormEvent) => { e.preventDefault(); if (text.trim()) onSave(text.trim()) }
  return (
    <form className="bg-form" onSubmit={submit}>
      <label className="bg-field">
        <span>What would make this famous?</span>
        <input value={text} onChange={e => setText(e.target.value)} placeholder="The thing people would repeat to a friend" autoComplete="off" />
      </label>
      <button type="submit" className="ch-btn" disabled={busy || !text.trim()}>Add to the brief</button>
    </form>
  )
}

function SignersForm({ me, busy, onSave }: { me: string | null; busy: boolean; onSave: (planner: string, cd: string) => void }) {
  const [planner, setPlanner] = useState(me ?? '')
  const [cd, setCd] = useState('')
  const submit = (e: FormEvent) => { e.preventDefault(); if (planner.trim() && cd.trim()) onSave(planner.trim(), cd.trim()) }
  return (
    <form className="bg-form" onSubmit={submit}>
      <label className="bg-field"><span>Planner who signs</span>
        <input value={planner} onChange={e => setPlanner(e.target.value)} autoComplete="off" /></label>
      <label className="bg-field"><span>Creative director who signs</span>
        <input value={cd} onChange={e => setCd(e.target.value)} autoComplete="off" /></label>
      <button type="submit" className="ch-btn" disabled={busy || !planner.trim() || !cd.trim()}>Name the signers</button>
    </form>
  )
}

export default function BriefGateBand({ gate, client, onChanged, undo, docPath }: Props) {
  const [open, setOpen] = useState(false)
  const [versions, setVersions] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const v: GateView | null = gate.view
  if (!v) return null

  const act = (run: () => Promise<unknown>) => {
    setBusy(true); setError(null)
    run().then(() => { gate.reload(); onChanged() }, e => setError(String(e instanceof Error ? e.message : e))).finally(() => setBusy(false))
  }

  const n = passedCount(v)
  const questions = clientQuestions(v.items)
  const team = teamItems(v.items)
  const sign = signAction(v, gate.me)
  const famousMissing = v.items.some(i => i.id === 'famous' && i.state === 'missing')
  const summary = `${n} of ${v.items.length} gate items passed${v.enforced ? (v.open ? ' · Territories open' : ' · Territories closed') : ''}`

  return (
    <section className="bg-band" data-testid="gate-band" aria-label="Brief gate">
      <div className="bg-bar">
        <span className="bg-tag">Brief gate</span>
        {!open && <span className="bg-sum" data-testid="gate-summary">{summary}</span>}
        {open && <span className="bg-sum" />}
        <div className="bg-tools">
          <button type="button" className="ch-btn" disabled={!undo.canUndo} onClick={undo.undo}>Undo</button>
          <button type="button" className="ch-btn" disabled={!undo.canRedo} onClick={undo.redo}>Redo</button>
          <button type="button" className="ch-btn" aria-expanded={versions} onClick={() => setVersions(o => !o)}>Version history</button>
        </div>
        <button type="button" className="ch-btn bg-toggle" aria-expanded={open} onClick={() => setOpen(o => !o)}>
          {open ? 'Hide the gate' : 'Check the brief'}
        </button>
        {undo.note && <p className="bg-note-line" role="status" data-testid="undo-note">{undo.note}</p>}
      </div>
      {versions && <VersionPanel docPath={docPath} undo={undo} onChanged={() => { gate.reload(); onChanged() }} />}

      {open && (
        <div className="bg-body">
          <div className="bg-main">
            <h2 className="bg-head" data-testid="gate-headline">{headline(v, client)}</h2>
            <ul className="bg-rows" aria-label="The six gate items">
              {v.items.map(i => <Row key={i.id} item={i} />)}
            </ul>
            {famousMissing && <FameForm busy={busy} onSave={text => act(() => host.gatePatch({ famous: text }, 'say what would make this famous'))} />}
          </div>

          <aside className="bg-side">
            {questions.length > 0 && (
              <section className="bg-block bg-note" data-testid="gate-questions">
                <h3 className="bg-h3">{questions.length === 1 ? `One question for ${client}` : `${questions.length} questions for ${client}`}</h3>
                {questions.map(q => (
                  <div key={q.id} className="bg-q">
                    <p className="bg-ask">{q.text}</p>
                    <p className="bg-mid">{q.because}</p>
                  </div>
                ))}
              </section>
            )}
            {team.length > 0 && (
              <section className="bg-block">
                <h3 className="bg-h3">For the team</h3>
                <ul className="bg-list">{team.map(i => <li key={i.id}>{i.why}</li>)}</ul>
              </section>
            )}

            <section className="bg-block">
              <h3 className="bg-h3">Signing</h3>
              {!namesBoth(v.signers) ? (
                <>
                  <p className="bg-mid">Name the planner and the creative director who sign this brief. The agency signs first, then {client} confirms.</p>
                  <SignersForm me={gate.me} busy={busy} onSave={(p, c) => act(() => host.gatePatch({
                    signers: [{ role: PLANNER, person: p }, { role: CREATIVE_DIRECTOR, person: c }],
                  }, 'name who signs the brief'))} />
                </>
              ) : (
                <>
                  <ul className="bg-list" data-testid="gate-signers">
                    {v.signers.filter(s => ROLE_WORDS[s.role]).map(s => <li key={s.role} data-signed={s.signed}>{signerLine(s)}</li>)}
                    <li data-signed={v.confirmed && !v.changed_since_lock}>{client}: {v.confirmed && !v.changed_since_lock ? 'confirmed' : 'not yet'}</li>
                  </ul>
                  {sign && (
                    <>
                      <button type="button" className="ch-btn ch-btn-primary bg-sign" data-testid="gate-sign"
                        aria-disabled={sign.blocked !== null || busy}
                        onClick={() => { if (!sign.blocked && !busy) act(() => host.gateSign()) }}>
                        {sign.label}
                      </button>
                      <p className="bg-reason" data-testid="gate-reason">{sign.blocked ?? 'Signing locks this version.'}</p>
                    </>
                  )}
                  {!sign && !v.signed && <p className="bg-mid">You are not named as a signer on this brief.</p>}
                  {canStartNewVersion(v, gate.me) && (
                    <>
                      <button type="button" className="ch-btn bg-sign" data-testid="gate-new-version" disabled={busy}
                        onClick={() => act(() => host.gateNewVersion('The brief changed after it was signed; this starts a new version.'))}>
                        Start a new version
                      </button>
                      <p className="bg-reason">The signed version stays in the history as it was.</p>
                    </>
                  )}
                </>
              )}
              {error && <p className="bg-err" role="alert">{error}</p>}
            </section>
          </aside>
        </div>
      )}
    </section>
  )
}
