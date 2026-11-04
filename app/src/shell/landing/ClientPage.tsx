// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// One client: its circle, its six tools around it, and its work. Idea and Prod
// are dimmed "Soon". A live tool starts a document that is already the client's.

import type { LibraryItem } from '../../host'
import { Circle } from './Circle'
import { initialsOf, needsYou, type ClientSummary } from './model'
import { lastTouched } from '../when'
import { TOOLS, toolOfApp, type Tool } from './tools'

interface Props {
  summary: ClientSummary
  /** This client's work, newest first. */
  items: LibraryItem[]
  /** Which tools have an installed app. */
  live: ReadonlySet<string>
  onStart: (tool: Tool) => void
  onOpenItem: (path: string) => void
}

function count(summary: ClientSummary, t: Tool, live: boolean): { small: string; say: string } {
  if (!live) return { small: 'Soon', say: 'coming soon' }
  const n = summary.perTool[t.id].open
  if (n === 0) return { small: 'Start', say: 'none open, start one' }
  const tally = summary.perTool[t.id]
  let say = `${n} open`
  if (tally.needsYou) say += ', needs you'
  else if (tally.failed) say += ', failed'
  else if (tally.running) say += `, ${tally.running} running`
  return { small: `${n} open`, say }
}

export function ClientPage({ summary, items, live, onStart, onOpenItem }: Props) {
  const c = summary.client
  return (
    <div className="lc-page" data-testid="client-page" data-client={c.id}>
      <header className="lc-phead">
        <div className="lc-phl">
          <p className="eyebrow">Client</p>
          <h1 className="lc-h1 lc-h1-left" tabIndex={-1}>{c.name}</h1>
          <p className="lc-lede">{summary.status}</p>
        </div>
      </header>

      <div className="lc-wheel" role="group" aria-label={`Tools for ${c.name}`}>
        <span className="lc-centre" aria-hidden>
          <Circle size={144} material={c.material} initials={c.initials || initialsOf(c.name)} activity={summary.activity} />
        </span>
        {TOOLS.map((t, i) => {
          const on = live.has(t.id)
          const k = count(summary, t, on)
          const angle = (-90 + (360 / TOOLS.length) * i) * (Math.PI / 180)
          return (
            <button
              key={t.id}
              className={`lc-tool${on ? '' : ' lc-soon'}`}
              data-testid={`tool-${t.id}`}
              style={{ '--x': Math.cos(angle).toFixed(3), '--y': Math.sin(angle).toFixed(3) } as React.CSSProperties}
              aria-label={`${t.full} for ${c.name}, ${k.say} (${i + 1} of ${TOOLS.length})`}
              aria-disabled={on ? undefined : true}
              onClick={() => { if (on) onStart(t) }}
            >
              <span className="lc-orb"><Circle size={89} material="pearl" activity={on ? summary.perTool[t.id].needsYou ? 'human' : summary.perTool[t.id].failed ? 'error' : summary.perTool[t.id].running ? 'work' : 'idle' : 'idle'} dim={!on} /></span>
              <span className="lc-tl"><b>{t.name}</b><small>{k.small}</small></span>
            </button>
          )
        })}
      </div>

      <section className="lc-work" aria-label={`Work for ${c.name}`}>
        <h2 className="lc-strip-h">Work{items.length > 0 && <span className="lc-n">{items.length}</span>}</h2>
        {items.length === 0 ? (
          <p className="lc-nothing">Nothing yet. Pick a tool above to start the first piece of work for {c.name}.</p>
        ) : (
          <ul className="lc-cards">
            {items.map(i => {
              const tool = toolOfApp(i.app_id)
              return (
                <li key={i.path}>
                  <button className="lc-card" data-testid="work-item" onClick={() => onOpenItem(i.path)}>
                    <span className="lc-card-t">{i.title || 'Untitled'}</span>
                    {needsYou(i) && <span className="lc-tag lc-tag-need">Needs you</span>}
                    {!needsYou(i) && i.run?.state === 'working' && <span className="lc-tag lc-tag-run">{i.run.label}</span>}
                    {!needsYou(i) && i.run?.state === 'failed' && <span className="lc-tag lc-tag-fail">Failed</span>}
                    <span className="lc-card-m">{tool?.full ?? 'Other'} · {lastTouched(i.updated_at)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
