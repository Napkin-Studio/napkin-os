// The minimal ask card (ui-behaviour 3.17; features/contract-v3.clan, the only
// new UI on today's panels): an agent asked instead of guessing, and its job
// waits (needs_input). The card shows the question, why, the options with their
// detail (never a cost: owner, 2026-10-13), the text box when the question allows one, Later, and once
// answered, who chose what with Change. Anyone in the agency may answer; the
// first answer wins (the relay says who won).

import { useEffect, useState } from 'react'
import { useDoc, useServices, useUi } from '../app/context'
import type { Ask, Question } from '../contracts/types'
import { LOCAL_PERSON, type AnswerChoice } from '../jobs/runner'
import { placeAsk } from './askPlaces'
import { answerLocally, sendAnswer } from './asks'
import { AgentFigure } from './agents/AgentFigure'
import { castOf, sayer } from './agents/cast'
import './askcard.css'

/** The question's options as buttons, the recommended one marked. */
export function AskOptions({ q, disabled, onPick }: { q: Question; disabled: boolean; onPick: (optionId: string) => void }) {
  const options = q.options.filter((o) => o.value !== undefined)
  // Options with a line of detail are blocks (mock Asks: "Plan the storyboard first · 6 shots"); short ones are pills.
  const blocks = options.some((o) => o.detail)
  return (
    <div className={`askcard-options ${blocks ? 'blocks' : ''}`}>
      {options.map((o) => (
        <button key={o.id} className={`btn sm askcard-opt${o.id === q.recommended_option_id ? ' rec' : ''}`} disabled={disabled} onClick={() => onPick(o.id)}>
          <span className="askcard-label">{o.label}</span>
          {o.id === q.recommended_option_id && <span className="askcard-rec">Recommended</span>}
          {o.detail && <span className="askcard-detail">{o.detail}</span>}
        </button>
      ))}
    </div>
  )
}

/** `onLocalAnswer`: for an ask with no job (Wren's on a sketch area, features/frame-aspect.clan), the answer is
 *  written to the document here and handed back, and the caller goes ahead with it. `docked`: shown by the ask
 *  dock (ui/AskDock.tsx), which shows what no card in its place does; any other card places the ask (askPlaces). */
export function AskCard({ ask, onLocalAnswer, docked = false }: { ask: Ask; onLocalAnswer?: (answer: AnswerChoice) => Promise<void> | void; docked?: boolean }) {
  const { runner, doc: docStore } = useServices()
  const ui = useUi()
  const doc = useDoc()
  const [text, setText] = useState('')
  const [later, setLater] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [changing, setChanging] = useState(false)
  const q = ask.question
  const answered = ask.state === 'answered' && !changing
  const last = ask.answers.at(-1)
  const me = ui.me?.participantId ? `human:${ui.me.participantId}` : undefined
  const byWords = (by?: string) => (!by ? 'Someone' : by === me ? 'You' : by.replace(/^human:/, ''))
  const chose = last?.option_id ? q.options.find((o) => o.id === last.option_id)?.label ?? last.option_id : last?.text
  const job = ask.job_id ? doc.jobs[ask.job_id] : undefined
  useEffect(() => (docked ? undefined : placeAsk(ask.id)), [ask.id, docked])

  const local = !ask.job_id && !!onLocalAnswer
  const send = async (answer: AnswerChoice) => {
    if (!ask.job_id && !onLocalAnswer) return
    setBusy(true)
    setNote(null)
    try {
      if (!ask.job_id) {
        await answerLocally(docStore, ask.id, answer, me ?? LOCAL_PERSON)
        await onLocalAnswer!(answer)
        return
      }
      const said = await sendAnswer(runner, ask, answer, changing, byWords)
      if (changing) setChanging(false)
      if (said) setNote(said)
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (later && !answered) {
    return (
      <button className="askcard-later" onClick={() => setLater(false)} aria-label={`Waiting for you: ${q.text}`} data-ask={ask.id}>
        <AgentFigure agent={castOf(ask.crew)} size={20} state="needs-you" decorative /><b>Waiting for you</b><span>· {q.text}</span>
      </button>
    )
  }
  return (
    <section className={`askcard ${answered ? 'answered' : 'open'}${docked ? ' docked' : ''}`} role="group" aria-label={`${ask.crew} asks: ${q.text}`} data-ask={ask.id}>
      <div className="askcard-head">
        <AgentFigure agent={castOf(ask.crew)} size={28} state={answered ? 'idle' : 'needs-you'} decorative />
        <span className="askcard-who">{sayer(castOf(ask.crew))}</span>
        {job && job.started_by !== me && <span className="faint">· started by {byWords(job.started_by)}</span>}
        <span className="askcard-sp" />
        {!answered && !changing && <button className="askcard-latr" onClick={() => setLater(true)}>Later</button>}
      </div>
      <div className="askcard-q">{q.text}</div>
      {q.why && <div className="askcard-why faint">{q.why}</div>}
      {answered ? (
        <div className="askcard-done">
          <span>{byWords(last?.by)} chose: {chose}</span>
          <span className="faint"> · in History</span>
          {!local && <button className="btn xs" disabled={busy} onClick={() => setChanging(true)}>Change</button>}
        </div>
      ) : (
        <>
          <AskOptions q={q} disabled={busy || (!ask.job_id && !local)} onPick={(optionId) => void send({ optionId })} />
          {q.allow_text && (
            <form className="askcard-text" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void send({ text: text.trim() }) }}>
              <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={q.options.find((o) => o.value === undefined)?.label ?? 'Say it in your words'} aria-label="Your answer" />
              <button className="btn sm" type="submit" disabled={busy || !text.trim()}>Send</button>
            </form>
          )}
          {changing && <div className="askcard-foot"><button className="btn xs ghost" onClick={() => setChanging(false)}>Keep the answer</button></div>}
        </>
      )}
      {note && <div className="askcard-note" role="status">{note}</div>}
    </section>
  )
}
