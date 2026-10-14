// The decisions as a list: who (you, another person, the crew), what, why, the
// addresses it changed, and its Kind. Presentational, so it renders in a test.

import { cardsFromRationale, type SeenCard } from '../../../clan-store/src/attribution'
import { Thumbs } from '../dogfood/Dogfood'
import type { Kind } from '../model/lineage'
import type { ProductionDocument } from '../contracts/types'
import { aboutItem, entryKind, jobCost, jobOf, kindOf, plainWords, readable, timeOf, who, type ChainLike, type HistoryItem } from './historyItems'
import { AgentFigure } from './agents/AgentFigure'
import type { CastKey } from './agents/cast'
import { initials } from './chrome/panels'

export function HistoryList({ entries, me, myName, item, kind, doc, tree = false }: { entries: ChainLike[]; me?: string; myName?: string; item?: HistoryItem; kind?: Kind; doc?: ProductionDocument; tree?: boolean }) {
  const words = (t: string) => readable(doc ? plainWords(t, doc) : t)
  const shown = entries.filter((e) => aboutItem(e, item) && (!kind || entryKind(e) === kind))
  if (!shown.length) return <div className="history-empty faint">{item || kind ? 'Nothing recorded about this yet.' : 'Nothing decided yet. Every choice you and the crew make lands here.'}</div>
  return (
    <ol className={`history-list ${tree ? 'tree' : ''}`}>
      {shown.map((e, i) => {
        const ak = kindOf(e.agent)
        const w = who(e.agent, me)
        // A crew landing's rationale ends with the character cards the director was given (clan-store attribution.ts).
        const { rest: why, cards } = ak === 'crew' && e.rationale ? cardsFromRationale(e.rationale) : { rest: e.rationale, cards: [] as SeenCard[] }
        const fields = (e.targets ?? []).filter((t) => /\]\./.test(t)).map((t) => t.slice(t.indexOf('#') + 1))
        const job = jobOf(e)
        const cost = doc && job ? jobCost(doc.jobs[job]?.cost) : undefined
        return (
          <li key={`${e.id ?? e.timestamp}-${i}`} className={`history-entry ${ak} ${entryKind(e) === 'ask' ? 'asked' : ''}`} data-kind={ak} data-decision-kind={entryKind(e)}>
            <span className="history-gutter" aria-hidden="true">
              {ak === 'crew' ? <AgentFigure agent={e.agent as CastKey} size={22} decorative /> : <span className="history-who">{w.label === 'You' ? initials(myName ?? me) : initials(w.label)}</span>}
            </span>
            <div className="history-card">
            <div className="history-head">
              <span className={`history-agent ${ak}`} title={e.agent}>
                {w.label}
              </span>
              {w.detail && <span className="history-model faint">{w.detail}</span>}
              <span className="spacer" />
              {e.pinned && <span className="history-pin" title="Pinned: never compressed">pinned</span>}
              {cost && <span className="history-cost faint" title="What this job cost">{cost}</span>}
              <time className="faint" dateTime={e.timestamp} title={e.timestamp}>{timeOf(e.timestamp)}</time>
            </div>
            <div className="history-action" title={e.action}>{words(e.action)}</div>
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
            <div className="history-meta">
              <span className="history-kind">{entryKind(e)}</span>
              {fields.length > 0 && (
                <details className="history-fields">
                  <summary>{[...new Set(fields.map((f) => words(f)))].join(' · ')}</summary>
                  {fields.map((f) => <span key={f} className="history-field">{readable(f)}</span>)}
                </details>
              )}
            </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
