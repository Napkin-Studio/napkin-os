// Make all sizes (features/campaign-formats.clan; ui-behaviour 3.19): the sheet that asks for a plan
// or a pack and the film lengths, Wren's ask "What must stay in every size?" (once per master), and the
// send tray: every format with the method the rule table picked, no prices, untick any, Send.

import { sheetLine } from './boardWords'
import { useMemo, useState } from 'react'
import type { PersonRef, ProtectBox } from '../contracts/types'
import { useConfig, useDoc } from '../app/context'
import { AgentFigure } from '../ui/agents/AgentFigure'
import { sayer } from '../ui/agents/cast'
import { choicesFor, DEFAULT_LENGTHS, FILMS_FROM_VIDEO, LANES, rowsFor, shortName, sizeWords } from './formats'
import { makeAllSizes, type CampaignDeps, type TrayRow } from './make'
import { setsOf, type MasterInfo } from './master'
import { ProtectEditor } from './ProtectEditor'
import { availableMethods, METHOD_WORD, methodFor, methodModels, methodWords, PAID } from './rules'
import './campaign.css'

type Step = 'plan' | 'protect' | 'tray'

export function MakeSizesSheet({ master, deps, by, near, onClose, onMade }: {
  master: MasterInfo
  deps: CampaignDeps
  by: PersonRef
  near?: import('../canvas/core/canvasAdapter').CanvasElement
  onClose(): void
  onMade(el: import('../canvas/core/canvasAdapter').CanvasElement): void
}) {
  const doc = useDoc()
  const choices = useMemo(() => choicesFor(master.media), [master.media])
  const [choice, setChoice] = useState(choices[0])
  const [lengths, setLengths] = useState<number[]>(DEFAULT_LENGTHS)
  const [extra, setExtra] = useState('')
  const earlierCopy = setsOf(doc, master).find((s) => s.copy)?.copy
  const [line, setLine] = useState(earlierCopy?.line ?? '')
  const [legal, setLegal] = useState(earlierCopy?.legal ?? '')
  // Asked once per master: an earlier set's answer is used again.
  const earlier = setsOf(doc, master).find((s) => s.protect)?.protect
  const [boxes, setBoxes] = useState<ProtectBox[]>(earlier?.boxes ?? [])
  const [keepMiddle, setKeepMiddle] = useState(!!earlier?.keep_middle)
  const answered = !!earlier
  const [step, setStep] = useState<Step>('plan')
  const [off, setOff] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { config } = useConfig()
  const models = useMemo(() => methodModels(config), [config])
  const available = useMemo(() => availableMethods(models), [models])
  const rows: TrayRow[] = useMemo(() => rowsFor(choice, master.media, lengths).map((r) => {
    const pick = methodFor(r, master, keepMiddle ? [] : boxes, available, master.length_s)
    return { ...r, pick, on: !pick.unavailable && !off.has(r.key) }
  }), [choice, lengths, master, boxes, keepMiddle, available, off])
  const makeable = rows.filter((r) => r.on)
  const paidCount = makeable.filter((r) => r.pick.now && PAID.has(r.pick.now)).length

  const send = async () => {
    setBusy(true)
    setError(null)
    try {
      const plan = { kind: choice.kind, id: choice.id, lengths_s: rows.some((r) => r.media === 'video') ? lengths : undefined }
      const { el } = await makeAllSizes(deps, { master, plan, protect: { boxes: keepMiddle ? [] : boxes, keep_middle: keepMiddle }, copy: { line, legal }, rows, near }, by)
      onMade(el)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const next = () => setStep(answered || master.media === 'video' ? 'tray' : 'protect')

  return (
    <div className="cf-scrim" role="presentation" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className="cf-sheet pt-panel" role="dialog" aria-modal="true" aria-label="Make all sizes">
        <header className="cf-sheethead">
          <b>Make all sizes</b>
          <span className="cf-from">from {master.label}</span>
          <span className="pt-grow" />
          <button type="button" className="btn sm ghost" onClick={onClose}>Cancel</button>
        </header>

        {step === 'plan' && (
          <div className="cf-body">
            <div className="cf-label">Plan</div>
            <div className="cf-chips" role="radiogroup" aria-label="Plan">
              {choices.map((c) => (
                <button key={`${c.kind}:${c.id}`} type="button" role="radio" aria-checked={choice.id === c.id}
                  className={`cf-chip ${choice.id === c.id ? 'on' : ''}`} onClick={() => setChoice(c)}>{c.name}</button>
              ))}
            </div>
            {master.media === 'video' && <>
            <div className="cf-label">Film lengths</div>
            <div className="cf-chips" aria-label="Film lengths">
              {[...new Set([30, 20, 15, 10, 6, ...lengths])].sort((a, b) => b - a).map((s) => (
                <button key={s} type="button" aria-pressed={lengths.includes(s)} className={`cf-chip ${lengths.includes(s) ? 'on' : ''}`}
                  onClick={() => setLengths(lengths.includes(s) ? lengths.filter((x) => x !== s) : [...lengths, s].sort((a, b) => b - a))}>{s} s</button>
              ))}
              <input className="cf-len" inputMode="numeric" placeholder="+ length" value={extra} aria-label="Another length in seconds"
                onChange={(e) => setExtra(e.target.value.replace(/\D/g, '').slice(0, 3))}
                onKeyDown={(e) => {
                  const n = Number(extra)
                  if (e.key === 'Enter' && n > 0 && n <= 600) {
                    setLengths([...new Set([...lengths, n])].sort((a, b) => b - a))
                    setExtra('')
                  }
                }} />
            </div>
            </>}
            <div className="cf-label">Words on every size</div>
            <div className="cf-words">
              <input className="cf-input" value={line} maxLength={200} placeholder="The brand line (optional)" aria-label="The brand line" onChange={(e) => setLine(e.target.value)} />
              <input className="cf-input" value={legal} maxLength={600} placeholder="Legal (optional)" aria-label="Legal" onChange={(e) => setLegal(e.target.value)} />
            </div>
            <p className="cf-note">The line, the logo from the Brand board and legal are laid out on each size as layers, drawn on our server; never sent to a model. Edit them on any tile.</p>
            <p className="cf-note">{master.media === 'video'
              ? `${rows.length} formats. Films are cut from the ad's own takes; stills are made from a key visual.`
              : `${rows.length} still formats from this picture. ${FILMS_FROM_VIDEO}`}</p>
            <footer className="cf-foot"><span className="pt-grow" /><button type="button" className="btn primary" onClick={next}>Next</button></footer>
          </div>
        )}

        {step === 'protect' && (
          <ProtectAsk master={master} boxes={boxes} setBoxes={(b) => { setBoxes(b); setKeepMiddle(false) }}
            onBack={() => setStep('plan')} onDone={() => setStep('tray')}
            onKeepMiddle={() => { setBoxes([]); setKeepMiddle(true); setStep('tray') }} />
        )}

        {step === 'tray' && (
          <div className="cf-body">
            <div className="cf-trayhead">
              <AgentFigure agent="wren" size={24} decorative />
              <span><b>{sayer('wren')}</b>: what I will make</span>
              <span className="pt-grow" />
              {master.media === 'image' && <button type="button" className="btn xs ghost" onClick={() => setStep('protect')}>
                {keepMiddle ? 'Keeping the middle' : `${boxes.length} kept in every size`} · Change</button>}
            </div>
            <div className="cf-tray" role="list" aria-label="What the Camera agent will make">
              {LANES.map((lane) => {
                const mine = rows.filter((r) => r.channel === lane.channel)
                if (!mine.length) return null
                return (
                  <div key={lane.channel} className="cf-lane" role="group" aria-label={lane.label}>
                    <div className="cf-lanehead">{lane.label}</div>
                    {mine.map((r) => (
                      <label key={r.key} className={`cf-row ${r.pick.unavailable ? 'off' : ''}`} role="listitem">
                        <input type="checkbox" checked={r.on} disabled={!!r.pick.unavailable}
                          onChange={() => setOff((s) => { const n = new Set(s); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n })} />
                        <span className="cf-name">{shortName(r.format)}{r.length_s ? ` · ${r.length_s} s` : ''}</span>
                        <span className="cf-size">{sizeWords(r.format)}</span>
                        <span className="cf-dots" />
                        <span className={`cf-method ${r.pick.waits || r.pick.unavailable ? 'waits' : ''}`} title={r.pick.unavailable ?? r.pick.waits}>
                          {r.pick.unavailable ? r.pick.unavailable
                            : r.pick.now === r.pick.method ? methodWords(r.pick.method, models)
                              : r.pick.now ? `${METHOD_WORD[r.pick.method]} · needs ${r.pick.waits?.split(' needs ')[1] ?? 'a later build'} · cropped for now`
                                : r.pick.waits}
                        </span>
                      </label>
                    ))}
                  </div>
                )
              })}
            </div>
            {error && <p className="cf-error" role="alert">{error}</p>}
            <footer className="cf-foot">
              <span className="cf-note">{sheetLine(makeable.length, rows.filter((r) => !r.pick.unavailable && !r.on).length, rows.filter((r) => r.pick.unavailable).length, paidCount)}. Each lands on a Campaign board beside the master.</span>
              <span className="pt-grow" />
              <button type="button" className="btn ghost" onClick={() => setStep(master.media === 'image' ? 'protect' : 'plan')}>Back</button>
              <button type="button" className="btn primary" disabled={busy || !makeable.length} onClick={() => void send()}>
                {busy ? 'Starting…' : `Make ${makeable.length} ${makeable.length === 1 ? 'size' : 'sizes'}`}
              </button>
            </footer>
          </div>
        )}
      </section>
    </div>
  )
}

/** Wren's ask, once per master: mark what must stay (the subject, the product), name it, change it. */
function ProtectAsk({ master, boxes, setBoxes, onBack, onDone, onKeepMiddle }: {
  master: MasterInfo
  boxes: ProtectBox[]
  setBoxes(b: ProtectBox[]): void
  onBack(): void
  onDone(): void
  onKeepMiddle(): void
}) {
  return (
    <div className="cf-body">
      <section className="askcard open cf-ask" role="group" aria-label="wren asks: What must stay in every size?">
        <div className="askcard-head">
          <AgentFigure agent="wren" size={28} state="needs-you" decorative />
          <span className="askcard-who">{sayer('wren')}</span>
        </div>
        <div className="askcard-q">What must stay in every size?</div>
        <div className="askcard-why faint">Drag over the subject and the product, or tap them. Click a box to move it, resize it, rename it or remove it. I keep them inside every size's safe area. The logo and the words come from the Brand board as layers, so leave them out.</div>
      </section>
      <ProtectEditor master={master} boxes={boxes} setBoxes={setBoxes} />
      <footer className="cf-foot">
        <button type="button" className="btn ghost" onClick={onBack}>Back</button>
        <span className="pt-grow" />
        <button type="button" className="btn" onClick={onKeepMiddle}>Nothing in particular: keep the middle</button>
        <button type="button" className="btn primary" disabled={!boxes.length} onClick={onDone}>Done</button>
      </footer>
    </div>
  )
}
