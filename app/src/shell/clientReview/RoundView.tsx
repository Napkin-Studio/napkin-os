// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The agency's one merged view of a client review round (features/client-review-full.clan): who was sent
// it and where each stands, then every comment ordered by piece then position, with the two flags the host
// gave it (`split`, `same spot`). A comment is a client's own words, so it is drawn as text and never as
// markup. Only the approver's answer is the client's decision; the others are shown as advice.

import { useEffect, useState } from 'react'
import { readRound } from '../../host/http'
import type { ClientRoundView } from '../../host/types'
import './ClientReview.css'
import { roundTitle, whereWords } from './roundWords'

const ANSWER: Record<string, string> = { accepted: 'approved', accepted_with_changes: 'asked for changes' }
const STATE: Record<string, string> = { open: 'Not answered yet', answered: 'Answered', withdrawn: 'Withdrawn', expired: 'Expired', superseded: 'Replaced: the document changed' }

export function RoundView({ round }: { round: ClientRoundView }) {
  const label = (n: number) => round.pieces.find(p => p.n === n)?.label ?? `Piece ${n}`
  return (
    <div className="cr-round" data-testid="client-round" data-round={round.round}>
      <h3 className="cr-h" data-testid="round-number">{roundTitle(round)}</h3>
      {!round.current && <p className="bg-mid" data-testid="round-old">The document has changed since this round was sent. Its links no longer open.</p>}
      <ul className="bg-list cr-reviewers" aria-label="Reviewers" data-testid="round-reviewers">
        {round.reviewers.map(r => (
          <li key={r.id} data-state={r.state} data-role={r.role}>
            <span>
              <b>{r.name}</b>{r.role === 'approver' ? ' (approver)' : ''} <span className="bg-mid" data-testid="reviewer-email">{r.email}</span>: {r.answer ? (ANSWER[r.answer] ?? r.answer) : (STATE[r.state] ?? r.state)}
              {r.answer && !r.counts ? ', counts as advice' : ''}
            </span>
          </li>
        ))}
      </ul>
      {(round.earlier_rounds?.length ?? 0) > 0 && (
        <ul className="bg-list cr-reviewers" aria-label="Earlier rounds" data-testid="round-earlier">
          {round.earlier_rounds!.map(e => (
            <li key={e.review} data-round={e.round}>
              <span>
                <b>Round {e.round}</b>: {e.reviewers.map(r => `${r.name} ${r.answer ? (ANSWER[r.answer] ?? r.answer) : (STATE[r.state] ?? r.state).toLowerCase()}`).join(', ')}
              </span>
            </li>
          ))}
        </ul>
      )}
      {round.pieces.some(p => p.split) && (
        <p className="bg-mid" data-testid="round-split">
          {round.pieces.filter(p => p.split).map(p => `${p.label}: ${p.approved_by.join(', ')} approved, ${p.changes_by.join(', ')} asked for changes.`).join(' ')}
        </p>
      )}
      {round.comments.length === 0
        ? <p className="bg-mid">No comments yet.</p>
        : (
          <ul className="bg-list cr-comments" aria-label="Comments" data-testid="round-comments">
            {round.comments.map(c => (
              <li key={c.id} data-testid="comment" data-flags={c.flags.join(',') || undefined}>
                <span className="cr-c-where">{label(c.piece)}, {whereWords(c)} · {c.tag === 'preference' ? 'a preference' : c.tag.replace(/_/g, ' ')}</span>
                <span className="cr-c-text">{c.text}</span>
                <span className="cr-c-by">{c.by.name}{c.role === 'approver' ? ' (approver)' : ''}</span>
                {c.flags.map(f => <span key={f} className="cr-flag" data-testid="comment-flag">{f}</span>)}
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}

/** The round of one document, read when the page opens; nothing at all when there is none or this person may not read it. */
export function ClientRound({ doc, reloadKey }: { doc: string; reloadKey?: unknown }) {
  const [round, setRound] = useState<ClientRoundView | null>(null)
  useEffect(() => {
    let live = true
    void readRound(doc).then(r => { if (live) setRound(r) })
    return () => { live = false }
  }, [doc, reloadKey])
  return round ? <RoundView round={round} /> : null
}
