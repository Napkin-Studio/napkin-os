// The chain entries as a list: who (you, the director, the provider), what,
// why, and which fields changed. Presentational, so it renders in a test.

import { aboutItem, kindOf, readable, timeOf, type AgentKind, type ChainLike, type HistoryItem } from './history'

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
            {e.rationale && <div className="history-why muted" title={e.rationale}>{readable(e.rationale)}</div>}
            {!!e.fields_changed?.length && (
              <div className="history-fields">{e.fields_changed.map((f) => <span key={f} className="history-field">{f}</span>)}</div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
