// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The dial (features/new-ui-shell.clan): a client's circle on the desk opens
// its apps in place, around the circle: Brief, Research, Deck, Production, and
// a "More tools" petal that lists the rest (Idea, Ads and every Soon tool), so
// no tool loses its place. The hub opens the client's page. It is view state,
// not a route: back, forward and every link stay as they were.
//
// Keys: the petals are one tab stop (roving tabindex); arrows, Home and End
// move round, 1 to 5 pick one, Enter or Space press the focused one, Escape
// closes the dial and gives the focus back to the circle.

import { useEffect, useRef, useState } from 'react'
import { activityOf, type ClientSummary } from './model'
import type { Tool } from './tools'
import { wheelKey } from './keys'
import { moreTools, petalWords, petalsOf } from './dialPetals'

interface Props {
  summary: ClientSummary
  /** Which tools have an installed app. */
  live: ReadonlySet<string>
  /** Where the client's circle stands in the row, so the dial opens around it. */
  at: { x: number; y: number; r: number }
  onOpenTool: (tool: Tool) => void
  onSoon: (tool: Tool) => void
  onOpenClient: () => void
  /** Close it; `refocus` gives the focus back to the circle. */
  onClose: (refocus: boolean) => void
}

export function Dial({ summary, live, at, onOpenTool, onSoon, onOpenClient, onClose }: Props) {
  const c = summary.client
  const petals = petalsOf(live)
  const [focus, setFocus] = useState(0)
  const [moreOpen, setMoreOpen] = useState(false)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const root = useRef<HTMLDivElement>(null)

  // The first petal takes the focus when the dial opens, so the keys work at once.
  useEffect(() => { buttons.current[0]?.focus({ preventScroll: true }) }, [])

  // A press anywhere else closes it (the circle's own click toggles it).
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      const t = e.target as Element | null
      if (root.current?.contains(t) || t?.closest?.(`[data-client="${CSS.escape(c.id)}"]`)) return
      onClose(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [c.id, onClose])

  const press = (i: number) => {
    const p = petals[i]
    if (p.kind === 'more') { setMoreOpen(o => !o); return }
    if (p.live) onOpenTool(p.tool)
    else onSoon(p.tool)
  }
  const choose = (t: Tool) => (live.has(t.id) ? onOpenTool(t) : onSoon(t))

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    if (e.key === 'Escape') {
      // Ours, not the page's "up one level".
      e.preventDefault()
      e.stopPropagation()
      if (moreOpen) { setMoreOpen(false); buttons.current[petals.length - 1]?.focus(); return }
      onClose(true)
      return
    }
    if ((e.target as HTMLElement).closest?.('.lc-dial-more')) return
    const i = buttons.current.findIndex(b => b === document.activeElement)
    const m = wheelKey(e.key, i < 0 ? focus : i, petals.length)
    if (!m) return
    e.preventDefault()
    if (m.kind === 'move') { setFocus(m.to); buttons.current[m.to]?.focus() } else press(m.index)
  }

  const radius = at.r + 46
  const more = moreTools(live)
  return (
    <div
      className="lc-dial"
      ref={root}
      role="group"
      aria-label={`Apps for ${c.name}`}
      data-testid="dial"
      data-client={c.id}
      style={{ left: at.x, top: at.y, '--dial-r': `${radius}px` } as React.CSSProperties}
      onKeyDown={onKeyDown}
    >
      <button className="lc-dial-hub" data-testid="dial-open-client" onClick={onOpenClient} title={`${c.name}: its page, its work and its Brand Clan`}>
        Open {c.name}
      </button>
      {petals.map((p, i) => {
        const angle = (-90 + (360 / petals.length) * i) * (Math.PI / 180)
        const style = { '--x': Math.cos(angle).toFixed(3), '--y': Math.sin(angle).toFixed(3) } as React.CSSProperties
        const common = {
          ref: (el: HTMLButtonElement | null) => { buttons.current[i] = el },
          tabIndex: i === focus ? 0 : -1,
          onFocus: () => setFocus(i),
          'aria-keyshortcuts': String(i + 1),
          style,
          onClick: () => press(i),
        }
        if (p.kind === 'more') {
          return (
            <button key="more" {...common} className="lc-petal lc-petal-more" data-testid="dial-more"
              aria-expanded={moreOpen} aria-label={`More tools for ${c.name} (${i + 1} of ${petals.length})`}>
              <span className="lc-petal-disc" aria-hidden>+</span>
              <span className="lc-petal-l"><b>More tools</b><small>{more.length}</small></span>
            </button>
          )
        }
        const words = petalWords(summary, p.tool, p.live)
        const act = p.live ? activityOf(summary.perTool[p.tool.id]) : 'idle'
        return (
          <button key={p.tool.id} {...common} className={`lc-petal${p.live ? '' : ' lc-soon'}`} data-testid={`dial-${p.tool.id}`}
            data-activity={act} aria-disabled={p.live ? undefined : true}
            aria-label={`${p.tool.full} for ${c.name}, ${words} (${i + 1} of ${petals.length})`}>
            <span className="lc-petal-disc" aria-hidden>{p.tool.name.slice(0, 1)}</span>
            <span className="lc-petal-l"><b>{p.tool.id === 'prod' ? 'Production' : p.tool.name}</b><small>{words}</small></span>
          </button>
        )
      })}
      {moreOpen && (
        <ul className="lc-dial-more" aria-label="More tools" data-testid="dial-more-list">
          {more.map(t => {
            const on = live.has(t.id)
            return (
              <li key={t.id}>
                <button className={on ? '' : 'lc-soon'} data-testid={`dial-more-${t.id}`} aria-disabled={on ? undefined : true} onClick={() => choose(t)}>
                  <b>{t.full}</b><small>{petalWords(summary, t, on)}</small>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
