// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// One client: its circle, its six tools around it, and its work. Idea and Prod
// are dimmed "Soon". A live tool starts a document that is already the client's.

import { useEffect, useRef, useState } from 'react'
import type { LibraryItem } from '../../host'
import { Circle } from './Circle'
import { ACTIVITY_WORD, activityOf, initialsOf, needsYou, type ClientSummary } from './model'
import { lastTouched } from '../when'
import { TOOLS, toolOfApp, type Tool } from './tools'
import { isTyping, wheelKey } from './keys'

interface Props {
  summary: ClientSummary
  /** This client's work, newest first. */
  items: LibraryItem[]
  /** Which tools have an installed app. */
  live: ReadonlySet<string>
  /** A live tool was chosen: go to that tool for this client. */
  onOpenTool: (tool: Tool) => void
  /** A tool that is not here yet was chosen (Idea, Prod): say so, go nowhere. */
  onSoon: (tool: Tool) => void
  onOpenItem: (path: string) => void
  /** Rename and archive, when the host lets this screen look after the registry. */
  actions?: React.ReactNode
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
  // The ring's verb is said in words under the tool as well.
  const act = activityOf(tally)
  return { small: act === 'idle' ? `${n} open` : `${n} open · ${ACTIVITY_WORD[act]}`, say }
}

export function ClientPage({ summary, items, live, onOpenTool, onSoon, onOpenItem, actions }: Props) {
  const c = summary.client
  // One tab stop for the six tools (roving tabindex): the arrows move it.
  const [at, setAt] = useState(0)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const choose = (i: number) => {
    const t = TOOLS[i]
    if (live.has(t.id)) onOpenTool(t)
    else onSoon(t)
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    const i = buttons.current.findIndex(b => b === document.activeElement)
    const m = wheelKey(e.key, i < 0 ? at : i, TOOLS.length)
    if (m?.kind !== 'move') return
    e.preventDefault()
    setAt(m.to)
    buttons.current[m.to]?.focus()
  }
  // The number keys pick a tool wherever the focus is on this page, except in a field.
  const pick = useRef(choose)
  useEffect(() => { pick.current = choose })
  useEffect(() => {
    const onNumber = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isTyping(e.target)) return
      const m = wheelKey(e.key, 0, TOOLS.length)
      if (m?.kind !== 'pick') return
      e.preventDefault()
      pick.current(m.index)
    }
    document.addEventListener('keydown', onNumber)
    return () => document.removeEventListener('keydown', onNumber)
  }, [])
  return (
    <div className="lc-page" data-testid="client-page" data-client={c.id}>
      <header className="lc-phead">
        <div className="lc-phl">
          <p className="eyebrow">Client</p>
          <h1 className="lc-h1 lc-h1-left" tabIndex={-1}>{c.name}</h1>
          <p className="lc-lede">{summary.status}</p>
        </div>
        {actions}
      </header>

      <div className="lc-wheel" role="group" aria-label={`Tools for ${c.name}`} onKeyDown={onKeyDown}>
        <span className="lc-centre" aria-hidden>
          <Circle size={144} material={c.material} initials={c.initials || initialsOf(c.name)} activity={summary.activity} slot={`client:${c.id}`} orb />
        </span>
        {TOOLS.map((t, i) => {
          const on = live.has(t.id)
          const k = count(summary, t, on)
          const angle = (-90 + (360 / TOOLS.length) * i) * (Math.PI / 180)
          return (
            <button
              key={t.id}
              ref={el => { buttons.current[i] = el }}
              tabIndex={i === at ? 0 : -1}
              aria-keyshortcuts={String(i + 1)}
              onFocus={() => setAt(i)}
              className={`lc-tool${on ? '' : ' lc-soon'}`}
              data-testid={`tool-${t.id}`}
              style={{ '--x': Math.cos(angle).toFixed(3), '--y': Math.sin(angle).toFixed(3) } as React.CSSProperties}
              aria-label={`${t.full} for ${c.name}, ${k.say} (${i + 1} of ${TOOLS.length})`}
              aria-disabled={on ? undefined : true}
              onClick={() => choose(i)}
            >
              <span className="lc-orb"><Circle size={89} material="pearl" initials={t.name.slice(0, 1)} activity={on ? activityOf(summary.perTool[t.id]) : 'idle'} dim={!on} slot={`tool:${c.id}:${t.id}`} orb /></span>
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
