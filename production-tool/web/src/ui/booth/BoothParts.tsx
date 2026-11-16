// What goes in a Booth (features/script-freeform.clan; mock script-freeform-v1): the agent at work here, the
// box to tell them what to do (only where an existing action takes words), and cards. A card is a thing to
// keep or answer: a draft, an edit, an ask, a note. Never a chat bubble.

import { useEffect, useState, type ReactNode } from 'react'
import { useServices, useUi } from '../../app/context'
import type { Ask } from '../../contracts/types'
import { LOCAL_PERSON } from '../../jobs/runner'
import { AgentAvatar, AgentFigure } from '../agents/AgentFigure'
import { CAST, castOf, type CastKey } from '../agents/cast'
import { placeAsk } from '../askPlaces'
import { answerLocally, sendAnswer } from '../asks'
import { useWhy } from './hooks'

/** The agent at work in this room: their figure, who they are, and what waits here. */
export function BoothAgent({ agent, line, needsYou, crew }: { agent: CastKey; line: string; needsYou?: boolean; crew?: CastKey[] }) {
  return (
    <div className="bt-agent">
      <AgentFigure agent={agent} size={40} state={needsYou ? 'needs-you' : 'idle'} decorative />
      <div>
        <div className="who">{CAST[agent].given} · {CAST[agent].job}</div>
        <div className="line">{line}</div>
      </div>
      {crew && crew.length > 0 && (
        <span className="bt-crew" title={`Also here: ${crew.map((c) => CAST[c].given).join(', ')}`}>
          {crew.map((c) => <AgentAvatar key={c} agent={c} size={22} decorative />)}
        </span>
      )}
    </div>
  )
}

/** What the box applies to: the whole thing, or a part or a selection with a way back to the whole. */
export function ScopeChip({ label, quote, on, onClear, clearLabel }: { label: string; quote?: string; on?: boolean; onClear?: () => void; clearLabel?: string }) {
  return (
    <span className={`bt-scope ${on ? 'on' : 'whole'}`} title={quote}>
      {label}
      {quote && <span className="q">· “{quote}”</span>}
      {on && onClear && <button type="button" aria-label={clearLabel ?? 'Apply to the whole'} onClick={onClear}>×</button>}
    </span>
  )
}

/** The box: tell the agent what to write or change. Enter sends; Shift+Enter is a new line. */
export function BoothBox({ placeholder, button, scope, onSend, disabled, busy, hint, initial = '' }: {
  placeholder: string
  button: string
  scope: ReactNode
  onSend: (words: string) => Promise<boolean | void> | boolean | void
  disabled?: boolean
  busy?: boolean
  hint?: ReactNode
  initial?: string
}) {
  const [text, setText] = useState(initial)
  const send = async () => {
    const words = text.trim()
    if (!words || disabled || busy) return
    const r = await onSend(words)
    if (r !== false) setText('')
  }
  return (
    <form className="bt-box" onSubmit={(e) => { e.preventDefault(); void send() }}>
      <textarea rows={2} value={text} placeholder={placeholder} aria-label={placeholder} disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }} />
      {hint && <div className="bt-hint">{hint}</div>}
      <div className="row">{scope}<span className="sp" /><button type="submit" className="btn sm dark" disabled={disabled || busy || !text.trim()}>{busy ? 'Asking…' : button}</button></div>
    </form>
  )
}

export function BoothSection({ label, count }: { label: string; count?: number }) {
  return <div className="bt-sec"><span className="pt-label">{label}</span>{count ? <span className="ct">{count}</span> : null}</div>
}

/** A card's head: the agent's avatar, 'SKYE · DRAFT', the needs-you dot on an ask, and when. */
export function CardHead({ agent, label, ask, time }: { agent: CastKey; label: string; ask?: boolean; time?: string }) {
  return (
    <header className="bc-hd">
      <AgentAvatar agent={agent} size={20} decorative />
      <span className="bc-who">{CAST[agent].given} · {label}</span>
      {ask && <span className="nd" aria-hidden="true" />}
      <span className="bc-t">{time}</span>
    </header>
  )
}

export interface Choice {
  label: string
  run: () => unknown
  /** The first, dark button. */
  primary?: boolean
  disabled?: boolean
}

/** A thing that waits for the person, with its choices: an ask with no job (a name, a shot a re-plan left
 *  out), a failed take, a new take ready. */
export function ChoiceCard({ id, agent, label = 'asks', q, body, thumb, meta, choices, why, time, onLater, ask = true }: {
  id: string
  agent: CastKey
  label?: string
  q: string
  body?: ReactNode
  thumb?: ReactNode
  meta?: ReactNode
  choices: Choice[]
  why?: ReactNode
  time?: string
  onLater?: () => void
  ask?: boolean
}) {
  const [showWhy, toggleWhy] = useWhy()
  return (
    <article className={`bc ${ask ? 'ask' : ''}`} role="group" aria-label={`${CAST[agent].given} ${label}: ${q}`} data-booth-card={id}>
      <CardHead agent={agent} label={label} ask={ask} time={time} />
      {thumb && <div className="bc-thumb">{thumb}<div className="meta">{meta}</div></div>}
      <div className="bc-q">{q}</div>
      {body && <p className="bc-note">{body}</p>}
      <div className="bc-act bc-opts">
        {choices.map((c) => <button key={c.label} type="button" className={`btn sm ${c.primary ? 'dark' : ''}`} disabled={c.disabled} onClick={() => void c.run()}>{c.label}</button>)}
        {why && <button type="button" className="btn sm why" aria-expanded={showWhy} onClick={toggleWhy}>Why</button>}
        {onLater && <button type="button" className="later" onClick={onLater}>Later</button>}
      </div>
      {why && showWhy && <div className="bc-why">{why}</div>}
    </article>
  )
}

/** A job's question (the doc's asks model): its options, its own words when allowed, Later. Answered through
 *  the runner as the ask card does (ui/AskCard.tsx); the card places the ask so the dock does not repeat it. */
export function BoothAsk({ ask, onLater, onLocalAnswer, time }: { ask: Ask; onLater?: () => void; onLocalAnswer?: (optionId: string) => Promise<void> | void; time?: string }) {
  const { runner, doc: docStore } = useServices()
  const ui = useUi()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const q = ask.question
  const agent = castOf(ask.crew)
  const me = ui.me?.participantId ? `human:${ui.me.participantId}` : undefined
  useEffect(() => placeAsk(ask.id), [ask.id])
  const send = async (answer: { optionId: string } | { text: string }) => {
    setBusy(true)
    setNote(null)
    try {
      if (!ask.job_id) {
        if (!onLocalAnswer || !('optionId' in answer)) return
        await answerLocally(docStore, ask.id, answer, me ?? LOCAL_PERSON)
        await onLocalAnswer(answer.optionId)
        return
      }
      const said = await sendAnswer(runner, ask, answer, false, (by) => (!by ? 'Someone' : by === me ? 'You' : by.replace(/^human:/, '')))
      if (said) setNote(said)
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const options = q.options.filter((o) => o.value !== undefined || !ask.job_id)
  return (
    <article className="bc ask" role="group" aria-label={`${CAST[agent].given} asks: ${q.text}`} data-ask={ask.id}>
      <CardHead agent={agent} label="asks" ask time={time} />
      <div className="bc-q">{q.text}</div>
      {q.why && <p className="bc-note">{q.why}</p>}
      <div className="bc-act bc-opts">
        {options.map((o, i) => (
          <button key={o.id} type="button" className={`btn sm ${(q.recommended_option_id ? o.id === q.recommended_option_id : i === 0) ? 'dark' : ''}`} disabled={busy}
            title={o.detail} onClick={() => void send({ optionId: o.id })}>{o.label}</button>
        ))}
        {onLater && <button type="button" className="later" onClick={onLater}>Later</button>}
      </div>
      {q.allow_text && ask.job_id && (
        <form className="bc-answer" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void send({ text: text.trim() }) }}>
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={q.options.find((o) => o.value === undefined)?.label ?? 'Say it in your words'} aria-label="Your answer" />
          <button className="btn sm" type="submit" disabled={busy || !text.trim()}>Send</button>
        </form>
      )}
      {note && <div className="bc-note" role="status">{note}</div>}
    </article>
  )
}

/** A note: what the agent did or noticed here, from the decision chain. */
export function NoteCard({ agent, label, body, time, thumb, meta }: { agent: CastKey; label: string; body: ReactNode; time?: string; thumb?: ReactNode; meta?: ReactNode }) {
  return (
    <article className="bc" data-booth-note="">
      <CardHead agent={agent} label={label} time={time} />
      {thumb && <div className="bc-thumb">{thumb}<div className="meta">{meta}</div></div>}
      <p className="bc-note ink">{body}</p>
    </article>
  )
}

/** The agent is at it now. */
export function WorkingCard({ agent, text }: { agent: CastKey; text: string }) {
  return (
    <article className="bc working" role="status">
      <AgentFigure agent={agent} size={26} state="working" decorative />
      <span>{text}</span>
    </article>
  )
}

/** What happened to a card the person decided: Kept (with Undo), Discarded. */
export function DoneCard({ agent, text, onUndo }: { agent: CastKey; text: string; onUndo?: () => void }) {
  return (
    <article className="bc done" role="status">
      <AgentAvatar agent={agent} size={18} decorative />
      <span>{text}</span>
      {onUndo && <button type="button" className="btn link" onClick={onUndo}>Undo</button>}
    </article>
  )
}
