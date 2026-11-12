// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Bringing a list in from a file (features/agency-setup.clan): choose the file, it is checked at once
// and nothing is saved, the result says how many rows are fine and lists the others by line with the
// reason, then Import saves the rows that are fine. The same screen for people, clients and jobs.

import { useRef, useState, type ReactNode } from 'react'
import { FailedSave, Loading, MissingAccess } from '../../components/states/ScreenStates'
import { importFile, type ImportKind, type ImportReport } from './api'
import { directoryNote, errorRows, importSummary, NOUN } from './model'
import './setup.css'

export type Phase = 'idle' | 'checking' | 'checked' | 'importing' | 'done' | 'failed' | 'refused' | 'unreadable'

interface BodyProps {
  kind: ImportKind
  phase: Phase
  file: string | null
  report: ImportReport | null
  /** The server's own sentence when a file could not be read. */
  said: string
  agency: string | null
  inputId: string
  help: ReactNode
  onPick: (f: File | undefined) => void
  onImport: () => void
  onRetry: () => void
}

/** The panel with no state of its own: every phase of it is drawn from these props. */
export function ImportBody({ kind, phase, file, report, said, agency, inputId, help, onPick, onImport, onRetry }: BodyProps) {
  const noun = NOUN[kind]
  const busy = phase === 'checking' || phase === 'importing'
  const summary = report ? importSummary(report) : null
  const rows = report ? errorRows(report) : null
  const note = report ? directoryNote(report, agency) : null
  const canImport = phase === 'checked' && !!report && report.ok > 0 && (report.created > 0 || report.updated > 0 || report.starts_directory)
  return (
    <div className="su-import" data-testid="import" data-phase={phase}>
      <div className="su-help">{help}</div>
      <div className="su-pick">
        <label className="ch-btn su-btn su-file" aria-disabled={busy || undefined}>
          {file ? 'Choose a different file' : `Choose a ${noun.one} file`}
          <input id={inputId} type="file" accept=".csv,.tsv,.txt,text/csv" data-testid={`setup-${kind}-input`} disabled={busy}
            onChange={e => { onPick(e.target.files?.[0]); e.target.value = '' }} />
        </label>
        {file && <span className="su-fname" data-testid="import-file">{file}</span>}
      </div>

      {phase === 'checking' && <Loading what="your file" rows={2} />}
      {phase === 'importing' && <Loading what={`your ${noun.of}`} rows={2} />}
      {phase === 'unreadable' && <p className="su-warn" role="alert" data-testid="import-unreadable">{said || 'That file could not be read.'}</p>}
      {phase === 'refused' && <MissingAccess what="the agency's setup" who="an admin of this agency" />}
      {phase === 'failed' && <FailedSave onRetry={onRetry} primary={false} compact />}

      {report && summary && (phase === 'checked' || phase === 'done') && (
        <section className="su-result" aria-label="What the file holds" data-tone={summary.tone}>
          <p className="su-summary" role="status" data-testid={phase === 'done' ? 'import-done' : 'import-summary'}>{summary.head}</p>
          {summary.sub && <p className="su-sub">{summary.sub}</p>}
          {note && <p className="su-note" data-testid="import-directory-note">{note}</p>}
          {rows && rows.shown.length > 0 && (
            <div className="su-tablewrap">
              <table className="su-table" data-testid="import-errors">
                <caption>Rows that need a look</caption>
                <thead><tr><th scope="col">Line</th><th scope="col">Row</th><th scope="col">What to fix</th></tr></thead>
                <tbody>
                  {rows.shown.map(r => (
                    <tr key={r.line} data-testid="import-error" data-line={r.line}>
                      <td>{r.line}</td><td>{r.label}</td><td>{r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.more > 0 && <p className="su-sub">And {rows.more} more. Fix these first and check the file again.</p>}
            </div>
          )}
        </section>
      )}

      {phase === 'checked' && (
        <div className="su-actions">
          <button type="button" className="ch-btn ch-btn-primary su-btn" disabled={!canImport} onClick={onImport}>
            {report && report.ok > 0 ? `Import ${report.created + report.updated || report.ok} ${report.created + report.updated === 1 ? noun.one : noun.many}` : 'Nothing to import'}
          </button>
        </div>
      )}
    </div>
  )
}

interface Props {
  kind: ImportKind
  agency: string | null
  help: ReactNode
  /** Told when rows were saved, so the flow can read its progress again. */
  onImported: (r: ImportReport) => void
}

/** The panel with its calls: check on choosing, import on the button. */
export function CsvImport({ kind, agency, help, onImported }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [file, setFile] = useState<File | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [said, setSaid] = useState('')
  const seq = useRef(0)

  const check = async (f: File) => {
    const mine = ++seq.current
    setPhase('checking'); setReport(null); setSaid('')
    const r = await importFile(kind, f, true)
    if (mine !== seq.current) return
    if (r.ok) { setReport(r.data); setPhase('checked'); return }
    if (r.status === 403) setPhase('refused')
    else if (r.status === 400) { setSaid(r.message); setPhase('unreadable') }
    else setPhase('failed')
  }
  const pick = (f: File | undefined) => { if (!f) return; setFile(f); void check(f) }
  const save = async () => {
    if (!file) return
    setPhase('importing')
    const r = await importFile(kind, file, false)
    if (r.ok) { setReport(r.data); setPhase('done'); onImported(r.data); return }
    if (r.status === 403) setPhase('refused')
    else if (r.status === 400 || r.status === 409) { setSaid(r.message); setPhase('unreadable') }
    else setPhase('failed')
  }
  return (
    <ImportBody kind={kind} phase={phase} file={file?.name ?? null} report={report} said={said} agency={agency}
      inputId={`su-${kind}`} help={help} onPick={pick} onImport={() => void save()} onRetry={() => (phase === 'failed' && file ? void check(file) : undefined)} />
  )
}
