// The chain entries as a list: who (you, the director, the provider), what,
// why, and which fields changed. Presentational, so it renders in a test.

import { cardsFromRationale, type SeenCard } from '../../../clan-store/src/attribution'
import { Thumbs } from '../dogfood/Dogfood'
import { aboutItem, kindOf, readable, timeOf, type AgentKind, type ChainLike, type HistoryItem } from './historyItems'

const KIND_ICON: Record<AgentKind, string> = { participant: '●', director: '◆', provider: '▲' }

/** Who an entry names, in the panel's words. */
function who(agent: string, kind: AgentKind, handle: string): { label: string; detail?: string } {
  if (kind === 'participant') return { label: agent === handle ? 'You' : `@${agent}` }
  const [, ...rest] = agent.split(' · ')
  if (kind === 'director') return { label: 'Director', detail: rest.join(' · ') }
  return { label: agent.split(' · ')[0], detail: rest.join(' · ') }
}

export function HistoryList({ entries, handle, item }: { entries: ChainLike[]; handle: string; item?: HistoryItem }) {
  const shown = entries.filter((e) => aboutItem(e, item))
  if (!shown.length) return <div className="history-empty faint">{item ? 'Nothing recorded about this yet.' : 'Nothing recorded yet.'}</div>
  return (
    <ol className="history-list">
      {shown.map((e, i) => {
        const kind = kindOf(e.agent)
        const w = who(e.agent, kind, handle)
        // A director entry ends with the character cards it was given (clan-store attribution.ts).
        const { rest: why, cards } = kind === 'director' && e.rationale ? cardsFromRationale(e.rationale) : { rest: e.rationale, cards: [] as SeenCard[] }
        return (
          <li key={`${e.timestamp}-${i}`} className={`history-entry ${kind}`} data-kind={kind}>
            <div className="history-head">
              <span className={`history-agent ${kind}`} title={e.agent}>
                <span className="history-icon" aria-hidden>{KIND_ICON[kind]}</span>
                {w.label}
              </span>
              {w.detail && <span className="history-model faint" title={e.agent}>{w.detail}</span>}
              <span className="spacer" />
              {e.pinned && <span className="history-pin" title="Pinned: never compressed">pinned</span>}
              <time className="faint" dateTime={e.timestamp} title={e.timestamp}>{timeOf(e.timestamp)}</time>
            </div>
            <div className="history-action">{readable(e.action)}</div>
            {why && <div className="history-why muted" title={why}>{readable(why)}</div>}
            {cards.length > 0 && (
              <details className="history-saw">
                <summary>What the director saw</summary>
                <ul>
                  {cards.map((c, k) => (
                    <li key={k}>
                      <span className="history-saw-tag">@{c.tag}</span> <span className="faint">{c.kind}</span>
                      {c.lines.map((l, n) => <div key={n} className="history-saw-line">{l}</div>)}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {kind === 'director' && (
              <div className="history-thumbs">
                <Thumbs compact target={{
                  kind: 'director', id: e.timestamp, action: e.action, model: w.detail,
                  jobId: `${e.action} ${e.rationale ?? ''}`.match(/job_[0-9A-HJKMNP-TV-Z]{26}/)?.[0],
                }} />
              </div>
            )}
            {!!e.fields_changed?.length && (
              <div className="history-fields">{e.fields_changed.map((f) => <span key={f} className="history-field">{f}</span>)}</div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
