// The decisions as a list: who (you, another person, the crew), what, why, the
// addresses it changed, and its Kind. Presentational, so it renders in a test.

import { cardsFromRationale, type SeenCard } from '../../../clan-store/src/attribution'
import { Thumbs } from '../dogfood/Dogfood'
import type { Kind } from '../model/lineage'
import { aboutItem, entryKind, kindOf, readable, timeOf, who, type AgentKind, type ChainLike, type HistoryItem } from './historyItems'

const KIND_ICON: Record<AgentKind, string> = { person: '●', crew: '◆', other: '▲' }

export function HistoryList({ entries, me, item, kind }: { entries: ChainLike[]; me?: string; item?: HistoryItem; kind?: Kind }) {
  const shown = entries.filter((e) => aboutItem(e, item) && (!kind || entryKind(e) === kind))
  if (!shown.length) return <div className="history-empty faint">{item || kind ? 'Nothing recorded about this yet.' : 'Nothing decided yet. Every choice you and the crew make lands here.'}</div>
  return (
    <ol className="history-list">
      {shown.map((e, i) => {
        const ak = kindOf(e.agent)
        const w = who(e.agent, me)
        // A crew landing's rationale ends with the character cards the director was given (clan-store attribution.ts).
        const { rest: why, cards } = ak === 'crew' && e.rationale ? cardsFromRationale(e.rationale) : { rest: e.rationale, cards: [] as SeenCard[] }
        const fields = (e.targets ?? []).filter((t) => /\]\./.test(t)).map((t) => t.slice(t.indexOf('#') + 1))
        return (
          <li key={`${e.id ?? e.timestamp}-${i}`} className={`history-entry ${ak}`} data-kind={ak} data-decision-kind={entryKind(e)}>
            <div className="history-head">
              <span className={`history-agent ${ak}`} title={e.agent}>
                <span className="history-icon" aria-hidden>{KIND_ICON[ak]}</span>
                {w.label}
              </span>
              {w.detail && <span className="history-model faint">{w.detail}</span>}
              <span className="spacer" />
              <span className="history-kind faint">{entryKind(e)}</span>
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
            {ak === 'crew' && (
              <div className="history-thumbs">
                <Thumbs compact target={{
                  kind: 'director', id: e.id ?? e.timestamp, action: e.action, model: w.detail,
                  jobId: (e.cites ?? []).map((c) => /#jobs\[(job_[0-9A-HJKMNP-TV-Z]{26})\]/.exec(c)?.[1]).find(Boolean),
                }} />
              </div>
            )}
            {fields.length > 0 && (
              <div className="history-fields">{fields.map((f) => <span key={f} className="history-field">{readable(f)}</span>)}</div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
