// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What the brief's Booth is sent about the client's links and the round (features/align-booth.clan), in the words
// it draws. Pure: no host and no React, so the allow list and the words are table-tested. The hook that sends it is
// clientLinkFeed.ts.

import type { ClientLinkRow, ClientRoundView } from '../../host/types'
import { roundTitle, whereWords } from '../clientReview/roundWords'

const STATE_WORDS: Record<string, string> = {
  open: 'Waiting for the client',
  answered: 'Answered',
  withdrawn: 'Withdrawn',
  expired: 'Expired',
  superseded: 'Replaced: the brief changed',
}
const ANSWER_WORDS: Record<string, string> = { accepted: 'confirmed', accepted_with_changes: 'asked for changes' }
const REVIEWER_ANSWER: Record<string, string> = { accepted: 'approved', accepted_with_changes: 'asked for changes' }
const REVIEWER_STATE: Record<string, string> = { ...STATE_WORDS, open: 'Not answered yet', superseded: 'Replaced: the document changed' }

export interface LinkLine { id: string; name: string; email: string; state: string; words: string; expires: string; can_withdraw: boolean }
export interface RoundLines {
  title: string
  current: boolean
  reviewers: { name: string; words: string; approver: boolean }[]
  split: string[]
  comments: { id: string; where: string; text: string; by: string; flags: string[] }[]
}
export interface LinksMessage { type: 'clan:client-links'; links: LinkLine[]; round: RoundLines | null; code: boolean }

/** What the page is sent: an allow list of each link's and the round's fields, in the words it draws. */
export function linksMessage(rows: readonly ClientLinkRow[], round: ClientRoundView | null, code: boolean): LinksMessage {
  const links = rows.map(r => ({
    id: r.id,
    name: r.client.name,
    email: r.client.email,
    state: r.state,
    words: r.answer ? ANSWER_WORDS[r.answer] ?? r.answer : STATE_WORDS[r.state] ?? r.state,
    expires: r.expires,
    can_withdraw: r.state === 'open',
  }))
  const label = (n: number) => round?.pieces.find(p => p.n === n)?.label ?? `Piece ${n}`
  return {
    type: 'clan:client-links',
    links,
    round: round
      ? {
        title: roundTitle(round),
        current: round.current,
        reviewers: round.reviewers.map(r => ({
          name: r.name,
          approver: r.role === 'approver',
          words: (r.answer ? REVIEWER_ANSWER[r.answer] ?? r.answer : REVIEWER_STATE[r.state] ?? r.state) + (r.answer && !r.counts ? ', counts as advice' : ''),
        })),
        split: round.pieces.filter(p => p.split).map(p => `${p.label}: ${p.approved_by.join(', ')} approved, ${p.changes_by.join(', ')} asked for changes.`),
        comments: round.comments.map(c => ({
          id: c.id,
          where: `${label(c.piece)}, ${whereWords(c)} · ${c.tag === 'preference' ? 'a preference' : c.tag.replace(/_/g, ' ')}`,
          text: c.text,
          by: c.by.name + (c.role === 'approver' ? ' (approver)' : ''),
          flags: [...c.flags],
        })),
      }
      : null,
    code,
  }
}
