// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// People from a file, on the People page (features/align-needs-lock-people.clan, stage 4): choose the file, it is checked at
// once and nothing is saved, the result says how many rows are fine and lists the others by line with the reason, then
// Import saves the rows that are fine, into the signed-in admin's own agency.

import { useRef, useState } from 'react'
import { PeopleError, type ImportReport, type PeopleApi } from './api'
import { errorRows, firstListNote, importSummary, importVerb } from './importModel'

export type Phase = 'idle' | 'checking' | 'checked' | 'importing' | 'done' | 'failed' | 'unreadable'

/** The panel with no state of its own: every phase is drawn from these props. */
export function ImportBody({ phase, file, report, said, agency, onPick, onImport, onClose }: {
  phase: Phase
  file: string | null
  report: ImportReport | null
  said: string
  agency: string | null
  onPick: (f: File | undefined) => void
  onImport: () => void
  onClose: () => void
}) {
  const busy = phase === 'checking' || phase === 'importing'
  const summary = report ? importSummary(report) : null
  const rows = report ? errorRows(report) : null
  const note = report ? firstListNote(report, agency) : null
  const verb = report ? importVerb(report) : null
  return (
    <section className="pa-sheet pa-import" aria-label="Import people from a file" data-testid="people-import" data-phase={phase}>
      <h2>Import people from a file</h2>
      <p className="pa-hint">One line per person, with the columns <b>email</b>, <b>name</b> and <b>roles</b> (and <b>username</b> if you like). Everyone joins {agency ? <b>{agency}</b> : 'your agency'}. The file is checked first; nothing is saved until you import it.</p>
      <div className="pa-pick">
        <label className="pa-btn pa-file" aria-disabled={busy || undefined}>
          {file ? 'Choose a different file' : 'Choose a people file'}
          <input type="file" accept=".csv,.tsv,.txt,text/csv" data-testid="people-import-input" disabled={busy}
            onChange={e => { onPick(e.target.files?.[0]); e.target.value = '' }} />
        </label>
        {file && <span className="pa-fname" data-testid="import-file">{file}</span>}
      </div>
      {phase === 'checking' && <p className="pa-hint" role="status">Checking your file…</p>}
      {phase === 'importing' && <p className="pa-hint" role="status">Importing your people…</p>}
      {phase === 'unreadable' && <p className="pa-err" role="alert" data-testid="import-unreadable">{said || 'That file could not be read.'}</p>}
      {phase === 'failed' && <p className="pa-err" role="alert">The file could not be checked. Try again.</p>}
      {report && summary && (phase === 'checked' || phase === 'done') && (
        <div className="pa-result" data-tone={summary.tone}>
          <p className="pa-summary" role="status" data-testid={phase === 'done' ? 'import-done' : 'import-summary'}>{summary.head}</p>
          {summary.sub && <p className="pa-hint">{summary.sub}</p>}
          {note && <p className="pa-note" data-testid="import-first-list">{note}</p>}
          {rows && rows.shown.length > 0 && (
            <table className="pa-table" data-testid="import-errors">
              <caption className="pa-cap">Rows that need a look</caption>
              <thead><tr><th scope="col">LINE</th><th scope="col">ROW</th><th scope="col">WHAT TO FIX</th></tr></thead>
              <tbody>
                {rows.shown.map(r => (
                  <tr key={r.line} data-testid="import-error" data-line={r.line}><td>{r.line}</td><td>{r.label}</td><td>{r.reason}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          {rows && rows.more > 0 && <p className="pa-hint">And {rows.more} more. Fix these first and check the file again.</p>}
        </div>
      )}
      <div className="pa-acts pa-end">
        <button type="button" className="pa-btn" onClick={onClose}>{phase === 'done' ? 'Done' : 'Cancel'}</button>
        {phase === 'checked' && (
          <button type="button" className="pa-btn pa-primary" disabled={!verb} onClick={onImport}>{verb ?? 'Nothing to import'}</button>
        )}
      </div>
    </section>
  )
}

/** The panel with its calls: check on choosing, import on the button. */
export function PeopleImport({ api, agency, onImported, onClose }: {
  api: PeopleApi
  agency: string | null
  onImported: (r: ImportReport) => void
  onClose: () => void
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [file, setFile] = useState<File | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [said, setSaid] = useState('')
  const seq = useRef(0)
  const refused = (e: unknown) => {
    if (e instanceof PeopleError && (e.status === 400 || e.status === 409)) { setSaid(e.message); setPhase('unreadable') }
    else setPhase('failed')
  }
  const check = async (f: File) => {
    const mine = ++seq.current
    setPhase('checking'); setReport(null); setSaid('')
    try {
      const r = await api.importPeople(f, true)
      if (mine !== seq.current) return
      setReport(r); setPhase('checked')
    } catch (e) { if (mine === seq.current) refused(e) }
  }
  const save = async () => {
    if (!file) return
    setPhase('importing')
    try {
      const r = await api.importPeople(file, false)
      setReport(r); setPhase('done'); onImported(r)
    } catch (e) { refused(e) }
  }
  return (
    <ImportBody phase={phase} file={file?.name ?? null} report={report} said={said} agency={agency}
      onPick={f => { if (!f) return; setFile(f); void check(f) }} onImport={() => void save()} onClose={onClose} />
  )
}
