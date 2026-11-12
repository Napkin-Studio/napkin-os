// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// A reviewer's page (features/client-review-full.clan; v2 section 4): one piece at a time, full width,
// with its version and its AI label; a tap on an image, or a moment in a film, to say where; Approve or
// Ask for changes on each piece; and one answer at the end. No account, no shell, no host: the link in
// the address is the whole of the authority, and every call goes back to it. Phone first: the primary
// buttons are 48 px tall and nothing scrolls sideways.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgencyLook } from '../shell/agency/look'
import {
  aiWords, answerBody, nextUnmarked, pinFromPoint, pinStyle, roundWords, versionWords, whereWords,
  type Mark, type Piece, type Pin, type Remark,
} from './reviewModel'

export interface Review {
  title: string
  client: { name: string }
  agency: { name: string | null; logo?: string | null; accent?: AgencyLook['accent'] | null }
  version: string
  /** The Nth signed version of the document, or null when the host could not count it. */
  version_n: number | null
  expires: string
  round: number
  rounds_in_scope: number | null
  approver: boolean
  pieces: Piece[]
  comments: Remark[]
  points: { key: string; label: string }[]
  html: string
}

const date = (iso: string) => new Date(iso).toLocaleDateString('en-IE', { day: 'numeric', month: 'long' })

interface Props {
  token: string
  page: Review
  /** The link is over (answered, withdrawn, superseded, expired): show its line. */
  onGone: (state: string) => void
  /** The reviewer's answer is in. */
  onDone: (answer: 'confirm' | 'changes') => void
}

export default function ReviewLink({ token, page, onGone, onDone }: Props) {
  const [at, setAt] = useState(1)
  const [marks, setMarks] = useState<Record<number, Mark>>({})
  const [remarks, setRemarks] = useState<Remark[]>(page.comments)
  const [draft, setDraft] = useState<{ pin: Pin | null; then: Mark | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const piece = page.pieces[at - 1]
  const mine = remarks.filter(r => r.piece === at)
  const top = useRef<HTMLDivElement>(null)

  useEffect(() => { top.current?.scrollTo?.({ top: 0 }) }, [at])

  const fail = useCallback(async (r: Response) => {
    const body = (await r.json().catch(() => ({}))) as { state?: string; error?: string }
    if (r.status === 410) onGone(body.state ?? 'gone')
    else setProblem(body.error ?? 'That did not go through. Try again.')
  }, [onGone])

  const post = (path: string, body: unknown) => fetch(`/c/${token}/${path}`, {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })

  const send = (next: Record<number, Mark>, said?: string) => {
    const body = answerBody(page.pieces, next)
    if (!body) return
    setBusy(true); setProblem(null)
    post('answer', said ? { ...body, said } : body).then(async r => {
      if (r.ok) onDone(body.answer)
      else await fail(r)
    }, () => setProblem('That did not go through. Check your connection and try again.')).finally(() => setBusy(false))
  }

  /** Mark this piece, then go on: to the next piece with no mark, or send when none is left. */
  const mark = (m: Mark, base: Record<number, Mark> = marks) => {
    const next = { ...base, [at]: m }
    setMarks(next)
    const left = nextUnmarked(page.pieces, next, at)
    if (left === null) send(next)
    else { setAt(left); setProblem(null) }
  }

  const saveRemark = (text: string, tag: string) => {
    if (!draft) return
    setBusy(true); setProblem(null)
    const body: Record<string, unknown> = { piece: at, tag, text }
    if (draft.pin) body.pin = draft.pin
    post('comment', body).then(async r => {
      if (!r.ok) { await fail(r); return }
      const made = (await r.json()) as { comment: string }
      setRemarks(rs => [...rs, { id: made.comment, piece: at, pin: draft.pin, tag, text }])
      const then = draft.then
      setDraft(null)
      if (then) mark(then)
    }, () => setProblem('That did not go through. Check your connection and try again.')).finally(() => setBusy(false))
  }

  const withdraw = (id: string) => {
    post(`comment/${id}/withdraw`, {}).then(async r => {
      if (r.ok) setRemarks(rs => rs.filter(x => x.id !== id))
      else await fail(r)
    }, () => setProblem('That did not go through. Try again.'))
  }

  const agency = page.agency.name ? page.agency.name.toUpperCase() : 'YOUR AGENCY'
  const last = page.pieces.length

  return (
    <main className="cl-page" data-testid="client-link-page" data-mode="review">
      <div className="cl-wrap cl-review" ref={top}>
        <header className="cl-head">
          <p className="cl-mark" aria-label={agency}>
            {page.agency.logo ? <img src={page.agency.logo} alt="" /> : <><i aria-hidden /><span>{agency}</span></>}
          </p>
          <p className="eyebrow">For {page.client.name} · {page.title}</p>
          <p className="cl-round" data-testid="round-number">{roundWords(page.round, page.rounds_in_scope)}</p>
        </header>

        <section aria-label={`Piece ${at} of ${last}`} className="cl-piece" data-testid="piece" data-kind={piece.kind}>
          <div className="cl-piece-head">
            <p className="eyebrow" data-testid="piece-count">Piece {at} of {last}</p>
            <p className="cl-piece-meta">
              <span data-testid="piece-version">{versionWords(page.version_n)}</span>
              <span className="cl-dot" aria-hidden>·</span>
              <span data-testid="ai-label" className="cl-ai">{aiWords(piece.ai)}</span>
            </p>
            <h1 className="cl-title cl-piece-title">{piece.label}</h1>
          </div>

          <Stage token={token} piece={piece} html={page.html} mine={mine} onPin={pin => setDraft({ pin, then: null })} />

          <Remarks mine={mine} onWithdraw={withdraw} />
          <button type="button" className="ch-btn cl-btn cl-add" disabled={busy} data-testid="add-comment"
            onClick={() => setDraft({ pin: null, then: null })}>Add a comment on this piece</button>
          {marks[at] && <p className="cl-note" data-testid="piece-mark">You marked this piece: {marks[at] === 'approve' ? 'approved' : 'changes asked for'}.</p>}
          {problem && <p className="cl-problem" role="alert">{problem}</p>}
          {page.pieces.length > 1 && (
            <nav className="cl-pager" aria-label="Pieces">
              <button type="button" className="ch-btn cl-btn" disabled={at <= 1} onClick={() => setAt(at - 1)}>Previous</button>
              <button type="button" className="ch-btn cl-btn" disabled={at >= last} onClick={() => setAt(at + 1)}>Next</button>
            </nav>
          )}
          <p className="cl-note">{page.approver ? 'You are the approver for this round: your answer is the one the agency works from.' : 'Your answer goes to the agency with the others.'} This link is yours and ends on {date(page.expires)}.</p>
        </section>
      </div>

      {draft ? (
        <CommentSheet
          points={page.points} pin={draft.pin} piece={piece} busy={busy} problem={problem}
          needs={draft.then === 'changes'}
          onCancel={() => { setDraft(null); setProblem(null) }}
          onSave={saveRemark}
        />
      ) : (
        <div className="cl-bar">
          <div className="cl-bar-in">
            <button type="button" className="ch-btn ch-btn-primary cl-btn" disabled={busy} onClick={() => mark('approve')}>Approve</button>
            <button type="button" className="ch-btn cl-btn" disabled={busy}
              onClick={() => mine.length > 0 ? mark('changes') : setDraft({ pin: null, then: 'changes' })}>Ask for changes</button>
          </div>
        </div>
      )}
    </main>
  )
}

/** The piece itself, and the way to say where. */
function Stage({ token, piece, html, mine, onPin }: { token: string; piece: Piece; html: string; mine: Remark[]; onPin: (pin: Pin | null) => void }) {
  const src = `/c/${token}/piece/${piece.n}`
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null)
  if (piece.kind === 'text') {
    return <iframe className="cl-frame cl-frame-piece" title={piece.label} sandbox="" srcDoc={html} data-testid="piece-text" />
  }
  if (piece.kind === 'image') {
    return (
      <div className="cl-stage" data-testid="piece-image">
        <button type="button" className="cl-tap" aria-label="Tap the image to say where"
          onClick={e => onPin(pinFromPoint(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY))}>
          <img src={src} alt={piece.label} draggable={false} />
          {mine.map((r, i) => { const st = r.pin ? pinStyle(r.pin) : null; return st ? <span key={r.id} className="cl-pin" style={st} data-testid="pin">{i + 1}</span> : null })}
        </button>
        <p className="cl-hint">Tap the image where you mean.</p>
      </div>
    )
  }
  const Media = piece.kind === 'film' ? 'video' : 'audio'
  return (
    <div className="cl-stage" data-testid={`piece-${piece.kind}`}>
      <Media ref={media} className="cl-media" controls preload="metadata" playsInline src={src} />
      <button type="button" className="ch-btn cl-btn" onClick={() => onPin({ t_ms: Math.round((media.current?.currentTime ?? 0) * 1000) })}>
        Comment at this moment
      </button>
    </div>
  )
}

function Remarks({ mine, onWithdraw }: { mine: Remark[]; onWithdraw: (id: string) => void }) {
  if (mine.length === 0) return null
  return (
    <ul className="cl-remarks" aria-label="Your comments on this piece">
      {mine.map((r, i) => (
        <li key={r.id} data-testid="own-comment">
          <span className="cl-pin cl-pin-static" aria-hidden>{i + 1}</span>
          <div>
            <p className="eyebrow">{whereWords(r.pin)} · {r.tag === 'preference' ? 'A preference' : r.tag.replace(/_/g, ' ')}</p>
            <p className="cl-text-sm">{r.text}</p>
          </div>
          <button type="button" className="cl-link" onClick={() => onWithdraw(r.id)}>Take back</button>
        </li>
      ))}
    </ul>
  )
}

function CommentSheet({ points, pin, piece, busy, problem, needs, onCancel, onSave }: {
  points: { key: string; label: string }[]; pin: Pin | null; piece: Piece; busy: boolean; problem: string | null; needs: boolean
  onCancel: () => void; onSave: (text: string, tag: string) => void
}) {
  const [text, setText] = useState('')
  const [tag, setTag] = useState('preference')
  return (
    <form className="cl-sheet" aria-label="Your comment" data-testid="comment-sheet"
      onSubmit={e => { e.preventDefault(); if (text.trim()) onSave(text.trim(), tag) }}>
      <label htmlFor="cl-say" className="eyebrow">{needs ? 'What should change?' : `${whereWords(pin)} on ${piece.label}`}</label>
      <textarea id="cl-say" value={text} onChange={e => setText(e.target.value)} rows={4} maxLength={2000} autoFocus
        placeholder="Say it in your own words. The agency reads it as you wrote it." />
      <label htmlFor="cl-tag" className="eyebrow">What is it about?</label>
      <select id="cl-tag" value={tag} onChange={e => setTag(e.target.value)}>
        <option value="preference">A preference</option>
        {points.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
      </select>
      {problem && <p className="cl-problem" role="alert">{problem}</p>}
      <div className="cl-bar-in">
        <button type="submit" className="ch-btn ch-btn-primary cl-btn" disabled={busy || !text.trim()}>{needs ? 'Save and ask for changes' : 'Save comment'}</button>
        <button type="button" className="ch-btn cl-btn" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

/** The screen of a link on the emailed code: nothing of the document, until the code is in. */
export function CodeScreen({ token, agency, onIn, onGone }: { token: string; agency: { name: string | null; logo?: string | null }; onIn: () => void; onGone: (s: string) => void }) {
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const call = (body?: unknown) => fetch(`/c/${token}/code`, {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  })
  const ask = () => {
    setBusy(true); setProblem(null)
    call().then(async r => {
      if (r.ok) setSent(true)
      else if (r.status === 410) onGone(((await r.json().catch(() => ({}))) as { state?: string }).state ?? 'gone')
      else setProblem(r.status === 429 ? 'No more codes can be sent just now. Try again later.' : 'The code could not be sent just now. Try again in a minute.')
    }, () => setProblem('That did not go through. Check your connection.')).finally(() => setBusy(false))
  }
  const enter = () => {
    setBusy(true); setProblem(null)
    call({ code: code.trim() }).then(async r => {
      if (r.ok) onIn()
      else setProblem(r.status === 429 ? 'Too many tries. Ask for a new code in ten minutes.' : 'That code is not right. Check the email and try again.')
    }, () => setProblem('That did not go through. Check your connection.')).finally(() => setBusy(false))
  }
  const who = agency.name ? agency.name.toUpperCase() : 'YOUR AGENCY'
  return (
    <main className="cl-page" data-testid="client-link-code">
      <div className="cl-wrap">
        <p className="cl-mark" aria-label={who}>{agency.logo ? <img src={agency.logo} alt="" /> : <><i aria-hidden /><span>{who}</span></>}</p>
        <h1 className="cl-title">Enter your code</h1>
        <p className="cl-sub">To open this, we send a six digit code to the address this link was sent to. It works for ten minutes.</p>
        {!sent ? (
          <button type="button" className="ch-btn ch-btn-primary cl-btn" disabled={busy} onClick={ask}>Email me a code</button>
        ) : (
          <form className="cl-ask" onSubmit={e => { e.preventDefault(); if (code.trim().length === 6) enter() }}>
            <label htmlFor="cl-code" className="eyebrow">The code from your email</label>
            <input id="cl-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, ''))} data-testid="code-input" />
            <button type="submit" className="ch-btn ch-btn-primary cl-btn" disabled={busy || code.length !== 6}>Open</button>
            <button type="button" className="cl-link" disabled={busy} onClick={ask}>Send it again</button>
          </form>
        )}
        {problem && <p className="cl-problem" role="alert">{problem}</p>}
      </div>
    </main>
  )
}
