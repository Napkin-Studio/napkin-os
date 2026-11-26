// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// A client's dial on the desk, as the mock draws it (buildDial, phase 33):
// five segments (Brief, Research, Territories, Production, Deck), each with its icon, its
// name and what is in it ("YOUR CALL", "1 deck", "Agents working", "Nothing
// yet"), a rim arc for what needs you or runs, and the client's own colour in
// the hub, which opens the client. 1 to 5 pick a quadrant, Escape closes it.

import { readableInk } from '../agency/palette'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { LibraryItem } from '../../host'
import { activityOfItem, needsYou, strongest } from '../landing/model'
import { toolById, toolOfApp, type Tool } from '../landing/tools'
import { ToolPaths } from './icons'
import type { ClientLook } from './deskData'
import { R, arcD, f1, pol, sector, sectorBox } from './dialGeometry'

/** The dial's five tools, in the mock's order round from the top. */
const QUADRANTS = [
  { id: 'brief', name: 'Brief', noun: ['brief', 'briefs'] },
  { id: 'research', name: 'Research', noun: ['question', 'questions'] },
  { id: 'territories', name: 'Territories', noun: ['exploration', 'explorations'] },
  { id: 'prod', name: 'Production', noun: ['film', 'films'] },
  { id: 'deck', name: 'Deck', noun: ['deck', 'decks'] },
] as const

type AreaState = 'needs' | 'working' | 'done' | ''

function areaState(items: readonly LibraryItem[]): AreaState {
  if (items.some(needsYou)) return 'needs'
  if (items.some(i => i.run?.state === 'working')) return 'working'
  if (items.length && items.every(i => i.state?.locked || i.run?.state === 'done')) return 'done'
  return ''
}

interface Props {
  client: { id: string; name: string; sector: string | null; look: ClientLook }
  /** This client's work. */
  items: readonly LibraryItem[]
  live: ReadonlySet<string>
  /** Where the dial sits in the row (the mock's openClient placement). */
  place: { left: number; top: number; origin: string }
  onOpenTool: (tool: Tool) => void
  onSoon: (tool: Tool) => void
  onOpenClient: () => void
  onClose: () => void
  /** Opened from the keyboard: the focus goes to the first quadrant (a mouse open leaves it on the circle). */
  focusFirst?: boolean
}

export function Dial({ client, items, live, place, onOpenTool, onSoon, onOpenClient, onClose, focusFirst }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  // One tab stop for the five quadrants (roving): the arrows move it, and it starts on the first.
  const [at, setAt] = useState(0)
  const quads = useRef<(HTMLButtonElement | null)[]>([])
  // The quadrant under the pointer, or the one the keyboard is on: its fill shows it (the button above the picture takes the pointer).
  const [lit, setLit] = useState<number | null>(null)
  const n = QUADRANTS.length, span = (2 * Math.PI) / n, start = -Math.PI / 2 - span / 2
  const choose = (i: number) => {
    const t = toolById(QUADRANTS[i].id)
    if (!t) return
    if (live.has(t.id)) onOpenTool(t)
    else onSoon(t)
  }
  const pick = useRef(choose)
  useEffect(() => { pick.current = choose })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
      if (/^[1-5]$/.test(e.key)) { e.preventDefault(); pick.current(Number(e.key) - 1) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  // It opens from the circle: scaled from the disc's size (the mock's 320ms ease); the focus goes to its first quadrant.
  useLayoutEffect(() => {
    if (focusFirst) quads.current[0]?.focus({ preventScroll: true })
    const el = ref.current
    if (!el || typeof el.animate !== 'function' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    el.animate([{ transform: `scale(${116 / 360})`, opacity: 0.5 }, { transform: 'none', opacity: 1 }], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' })
    // Once, as it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Each button is just its quadrant's box, so its middle (where a click or Playwright aims) lies in its own quadrant, not on the hub.
  const boxes = QUADRANTS.map((_, i) => sectorBox(R.o0, R.o1, start + i * span, start + (i + 1) * span))
  const parts = QUADRANTS.map((q, i) => {
    const mine = items.filter(it => toolOfApp(it.app_id)?.id === q.id)
    const st = areaState(mine)
    const on = live.has(q.id)
    const a0 = start + i * span, a1 = a0 + span, am = (a0 + a1) / 2
    const [lx, ly] = pol(212, am)
    const c = mine.length
    // The count is what every slice says; what needs you is a small mark under it (never in its place).
    const count = c ? `${c} ${q.noun[c > 1 ? 1 : 0]}` : 'Nothing yet'
    const sub = !on ? 'Soon' : st === 'needs' ? count : st === 'working' ? 'Agents working' : count
    return (
      <g key={q.id}>
        <g className={`dz dz-out${st === 'needs' ? ' dz-needs' : ''}${lit === i ? ' dz-lit' : ''}`} data-i={i} style={{ ['--d' as string]: `${i * 55}ms` }}
          aria-disabled={on ? undefined : true} data-activity={strongest(mine.map(activityOfItem))}>
          <path d={sector(R.o0, R.o1, a0, a1)} />
          <g className="dz-ico" transform={`translate(${f1(lx - 22)} ${f1(ly - 64)}) scale(1.83)`}>
            <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><ToolPaths tool={q.id} /></g>
          </g>
          <text x={f1(lx)} y={f1(ly + 4)} className="dz-name">{q.name}</text>
          {sub && <text x={f1(lx)} y={f1(ly + (st === 'needs' ? 24 : 30))} className="dz-sub">{sub}</text>}
          {st === 'needs' && <>
            <rect className="dz-tagbg" x={f1(lx - 40)} y={f1(ly + 34)} width="80" height="16" rx="3" />
            <text x={f1(lx)} y={f1(ly + 45.5)} className="dz-tag dz-tag-sm">YOUR CALL</text>
          </>}
        </g>
        {st && <path className={`dz-rim ${st}`} d={arcD(R.rim, a0 + 0.03, a0 + 0.03 + (span - 0.06) * (st === 'done' ? 1 : st === 'needs' ? 0.8 : 0.45))} />}
      </g>
    )
  })

  // The hub says the name and, under it, the sector; with no sector, the name's last word goes under it (the mock's "McDonald's / IRELAND").
  const words = client.name.split(/\s+/).filter(Boolean)
  const hub = client.sector ? { big: client.name, small: client.sector }
    : words.length > 1 ? { big: words.slice(0, -1).join(' '), small: words[words.length - 1] } : { big: client.name, small: '' }

  return (
    <div className="dial" id="dial" ref={ref} role="group" aria-label={`${client.name}: its tools`} data-testid="dial"
      style={{ left: place.left, top: place.top, transformOrigin: place.origin }}
      onClick={e => e.stopPropagation()}>
      {/* The hub comes first in the tab order: Shift+Tab from the first quadrant reaches it. */}
      <button type="button" className="dial-hub" id="dial-hub" data-testid="dial-hub"
        style={{ ['--cl' as string]: client.look.cl, ['--cl-ink' as string]: readableInk(client.look.cl, client.look.ink) }}
        title={`Open ${client.name}`} aria-label={`Open ${client.name}`} onClick={e => { e.stopPropagation(); onOpenClient() }}>
        <b>{hub.big}</b><small>{hub.small}</small>
      </button>
      <svg className="dial-svg" viewBox="0 0 640 640" aria-hidden="true" focusable="false">
        <defs>{QUADRANTS.map((q, i) => (
          <clipPath key={q.id} id={`dz-clip-${q.id}`} clipPathUnits="objectBoundingBox"><path d={sector(R.o0, R.o1, start + i * span, start + (i + 1) * span, boxes[i])} /></clipPath>
        ))}</defs>
        {parts}
      </svg>
      {/* One real button per quadrant, over the picture and cut to its shape: a name for a screen reader (and getByRole), the keys 1 to 5, the arrows. */}
      {QUADRANTS.map((q, i) => {
        const mine = items.filter(it => toolOfApp(it.app_id)?.id === q.id)
        const st = areaState(mine), on = live.has(q.id), c = mine.length
        // The count is what every slice says; what needs you is a small mark under it (never in its place).
    const count = c ? `${c} ${q.noun[c > 1 ? 1 : 0]}` : 'Nothing yet'
    const sub = !on ? 'Soon' : st === 'needs' ? count : st === 'working' ? 'Agents working' : count
        const t = toolById(q.id)
        const state = !on ? 'coming soon' : st === 'needs' ? 'needs your call' : sub.toLowerCase()
        const move = (to: number) => { const k = (to + n) % n; setAt(k); quads.current[k]?.focus() }
        return (
          <button key={q.id} type="button" className="dz-hit" style={{ clipPath: `url(#dz-clip-${q.id})`, left: `${f1(boxes[i].x / 6.4)}%`, top: `${f1(boxes[i].y / 6.4)}%`, width: `${f1(boxes[i].w / 6.4)}%`, height: `${f1(boxes[i].h / 6.4)}%` }}
            tabIndex={i === at ? 0 : -1} aria-label={`${q.name}, ${state}`} title={`${t?.full ?? q.name} for ${client.name} (${i + 1} of ${n})`}
            aria-keyshortcuts={String(i + 1)} data-testid={`quadrant-${q.id}`} data-i={i}
            data-activity={strongest(mine.map(activityOfItem))} aria-disabled={on ? undefined : true}
            ref={el => { quads.current[i] = el }}
            onFocus={e => { setAt(i); if (e.currentTarget.matches(':focus-visible')) setLit(i) }}
            onBlur={() => setLit(l => (l === i ? null : l))}
            onMouseEnter={() => setLit(i)} onMouseLeave={() => setLit(l => (l === i ? null : l))}
            onClick={e => { e.stopPropagation(); choose(i) }}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(i) }
              else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(i + 1) }
              else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(i - 1) }
              else if (e.key === 'Home') { e.preventDefault(); move(0) }
              else if (e.key === 'End') { e.preventDefault(); move(n - 1) }
            }} />
        )
      })}
    </div>
  )
}
