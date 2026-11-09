// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The landing: the studio as one circle, what is waiting on you, what is
// running. Everything is given to it; it reads nothing and fetches nothing.

import type { LibraryItem } from '../../host'
import { Circle } from './Circle'
import { ACTIVITY_WORD, countsLine, initialsOf, needsReason, plural, runWords, toolName, type AgencySummary } from './model'
import { lastTouched } from '../when'

const STRIP_SHOWN = 5

interface Props {
  agency: string
  /** The greeting, "Good evening." with a first name when there is one. */
  greeting: string
  summary: AgencySummary
  onOpenAgency: () => void
  onOpenItem: (path: string) => void
}

/** "Brief · Client A": the tool and who it is for; the document's own name below. */
function Strip({
  title, items, tag, why, empty, clientOf, onOpenItem, testId, hideWhenEmpty,
}: {
  title: string
  items: LibraryItem[]
  tag: (i: LibraryItem) => { text: string; kind: 'need' | 'run' | 'fail' }
  /** The reason, in words, beside the title: "2 things to check". */
  why?: (i: LibraryItem) => string
  testId: string
  hideWhenEmpty?: boolean
  empty: string
  clientOf: (i: LibraryItem) => string
  onOpenItem: (path: string) => void
}) {
  if (hideWhenEmpty && items.length === 0) return null
  return (
    <section className={`lc-strip lc-strip-${testId}`} aria-label={title} data-testid={`strip-${testId}`}>
      <h2 className="lc-strip-h">
        {title}
        {items.length > 0 && <span className="lc-n">{items.length}</span>}
      </h2>
      {items.length === 0 ? (
        <p className="lc-nothing">{empty}</p>
      ) : (
        <ul className="lc-cards">
          {items.slice(0, STRIP_SHOWN).map(i => {
            const t = tag(i)
            return (
              <li key={i.path}>
                <button className="lc-card" onClick={() => onOpenItem(i.path)}>
                  <span className="lc-card-t">{toolName(i)?.name ?? 'Work'} · {clientOf(i)}</span>
                  <span className={`lc-tag lc-tag-${t.kind}`}>{t.text}</span>
                  <span className="lc-card-m">{why ? `${why(i)} · ` : ''}{i.title || 'Untitled'} · {lastTouched(i.updated_at)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {items.length > STRIP_SHOWN && <p className="lc-nothing">and {items.length - STRIP_SHOWN} more</p>}
    </section>
  )
}

export function LandingPage({ agency, greeting, summary, onOpenAgency, onOpenItem }: Props) {
  const clientOf = (i: LibraryItem) => i.client?.name ?? 'No client yet'
  const hasClients = summary.clients > 0
  return (
    <div className="lc-page" data-testid="landing">
      <header className="lc-hello">
        <p className="eyebrow">Home</p>
        <h1 className="lc-h1" tabIndex={-1}>{greeting}</h1>
      </header>

      <div className="lc-door">
        <button className="lc-doorbtn" onClick={onOpenAgency} data-testid="agency-circle">
          <span className="lc-orb">
            <Circle size={233} material="onyx" initials={initialsOf(agency)} activity={summary.activity} slot="agency" orb />
          </span>
          <span className="lc-dl">
            <span className="lc-dname">{agency}</span>
            <span className="lc-dline" data-testid="counts">{countsLine(summary)}</span>
            {(summary.activity === 'think' || summary.activity === 'read' || summary.activity === 'check') && (
              <span className="lc-dverb" data-testid="agency-verb">The studio is {ACTIVITY_WORD[summary.activity]}.</span>
            )}
          </span>
          <span className="lc-dhint">{hasClients ? 'Open the studio to see its clients.' : 'Open the studio to add your first client.'}</span>
        </button>
      </div>

      <div className="lc-strips">
        <Strip
          title="Needs you"
          items={summary.needsYou}
          testId="needs"
          empty="Nothing is waiting on you."
          why={needsReason}
          tag={() => ({ text: 'Needs you', kind: 'need' })}
          clientOf={clientOf}
          onOpenItem={onOpenItem}
        />
        <Strip
          title="Running"
          items={summary.running}
          testId="running"
          empty="Nothing is running."
          tag={i => ({ text: runWords(i), kind: 'run' })}
          clientOf={clientOf}
          onOpenItem={onOpenItem}
        />
        <Strip
          title="Failed"
          items={summary.failed}
          testId="failed"
          hideWhenEmpty
          empty=""
          tag={() => ({ text: 'Failed', kind: 'fail' })}
          why={runWords}
          clientOf={clientOf}
          onOpenItem={onOpenItem}
        />
      </div>
      {summary.unassigned > 0 && (
        <p className="lc-unassigned" data-testid="unassigned">
          {plural(summary.unassigned, 'piece of work', 'pieces of work')} {summary.unassigned === 1 ? 'is' : 'are'} not attached to a client yet.
        </p>
      )}
    </div>
  )
}
