// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// A client's dial on the desk, as the mock draws it (buildDial, phase 33):
// four quadrants (Brief, Research, Deck, Production), each with its icon, its
// name and what is in it ("YOUR CALL", "1 deck", "Agents working", "Nothing
// yet"), a rim arc for what needs you or runs, and the client's own colour in
// the hub, which opens the client. 1 to 4 pick a quadrant, Escape closes it.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { LibraryItem } from '../../host'
import { activityOfItem, needsYou, strongest } from '../landing/model'
import { toolById, toolOfApp, type Tool } from '../landing/tools'
import { ToolPaths } from './icons'
import type { ClientLook } from './deskData'

const R = { o0: 100, o1: 300, rim: 308 }
const pol = (r: number, a: number): [number, number] => [320 + r * Math.cos(a), 320 + r * Math.sin(a)]
const f1 = (n: number) => n.toFixed(1)
function sector(r0: number, r1: number, a0: number, a1: number): string {
  const L = a1 - a0 > Math.PI ? 1 : 0
  const [x0, y0] = pol(r1, a0), [x1, y1] = pol(r1, a1), [x2, y2] = pol(r0, a1), [x3, y3] = pol(r0, a0)
  return `M${f1(x0)} ${f1(y0)}A${r1} ${r1} 0 ${L} 1 ${f1(x1)} ${f1(y1)}L${f1(x2)} ${f1(y2)}A${r0} ${r0} 0 ${L} 0 ${f1(x3)} ${f1(y3)}Z`
}
function arcD(r: number, a0: number, a1: number): string {
  const [x0, y0] = pol(r, a0), [x1, y1] = pol(r, a1)
  return `M${f1(x0)} ${f1(y0)}A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${f1(x1)} ${f1(y1)}`
}

/** The dial's four tools, in the mock's order round from the top. */
const ALL_QUADRANTS = [
  { id: 'brief', name: 'Brief', noun: ['brief', 'briefs'] },
  { id: 'research', name: 'Research', noun: ['question', 'questions'] },
  { id: 'deck', name: 'Deck', noun: ['deck', 'decks'] },
  { id: 'prod', name: 'Production', noun: ['film', 'films'] },
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
  /** The tools the person's role is offered; null offers all. A tool not in it is not a quadrant. */
  offered?: ReadonlySet<string> | null
  /** Where the dial sits in the row (the mock's openClient placement). */
  place: { left: number; top: number; origin: string }
  onOpenTool: (tool: Tool) => void
  onSoon: (tool: Tool) => void
  onOpenClient: () => void
  onClose: () => void
  /** Opened from the keyboard: the focus goes to the first quadrant (a mouse open leaves it on the circle). */
  focusFirst?: boolean
}

export function Dial({ client, items, live, offered = null, place, onOpenTool, onSoon, onOpenClient, onClose, focusFirst }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  // One tab stop for the four quadrants (roving): the arrows move it, and it starts on the first.
  const [at, setAt] = useState(0)
  const quads = useRef<(SVGGElement | null)[]>([])
  const QUADRANTS = offered ? ALL_QUADRANTS.filter(q => offered.has(q.id)) : ALL_QUADRANTS
  const n = QUADRANTS.length, span = (2 * Math.PI) / n, start = -Math.PI / 2 - span / 2
  const choose = (i: number) => {
    const t = QUADRANTS[i] ? toolById(QUADRANTS[i].id) : undefined
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
      if (/^[1-4]$/.test(e.key)) { e.preventDefault(); pick.current(Number(e.key) - 1) }
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

  const parts = QUADRANTS.map((q, i) => {
    const mine = items.filter(it => toolOfApp(it.app_id)?.id === q.id)
    const st = areaState(mine)
    const on = live.has(q.id)
    const a0 = start + i * span, a1 = a0 + span, am = (a0 + a1) / 2
    const [lx, ly] = pol(212, am)
    const c = mine.length
    const sub = !on ? 'Soon' : st === 'needs' ? '' : st === 'working' ? 'Agents working' : c ? `${c} ${q.noun[c > 1 ? 1 : 0]}` : 'Nothing yet'
    const t = toolById(q.id)
    const said = `${t?.full ?? q.name} for ${client.name}, ${!on ? 'coming soon' : st === 'needs' ? 'needs your call' : sub.toLowerCase()} (${i + 1} of ${n})`
    const move = (to: number) => { const k = (to + n) % n; setAt(k); quads.current[k]?.focus() }
    return (
      <g key={q.id}>
        <g className={`dz dz-out${st === 'needs' ? ' dz-needs' : ''}`} data-i={i} style={{ ['--d' as string]: `${i * 55}ms` }}
          role="button" tabIndex={i === at ? 0 : -1} aria-label={said} aria-keyshortcuts={String(i + 1)} data-testid={`quadrant-${q.id}`}
          data-activity={strongest(mine.map(activityOfItem))}
          ref={el => { quads.current[i] = el }}
          aria-disabled={on ? undefined : true}
          onFocus={() => setAt(i)}
          onClick={e => { e.stopPropagation(); choose(i) }}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(i) }
            else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(i + 1) }
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(i - 1) }
            else if (e.key === 'Home') { e.preventDefault(); move(0) }
            else if (e.key === 'End') { e.preventDefault(); move(n - 1) }
          }}>
          <title>{q.name}</title>
          <path d={sector(R.o0, R.o1, a0, a1)} />
          <g className="dz-ico" transform={`translate(${f1(lx - 22)} ${f1(ly - 64)}) scale(1.83)`}>
            <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><ToolPaths tool={q.id} /></g>
          </g>
          <text x={f1(lx)} y={f1(ly + 4)} className="dz-name">{q.name}</text>
          {sub && <text x={f1(lx)} y={f1(ly + 30)} className="dz-sub">{sub}</text>}
          {st === 'needs' && <>
            <rect className="dz-tagbg" x={f1(lx - 58)} y={f1(ly + 16)} width="116" height="24" rx="3" />
            <text x={f1(lx)} y={f1(ly + 34)} className="dz-tag">YOUR CALL</text>
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
        style={{ ['--cl' as string]: client.look.cl, ['--cl-ink' as string]: client.look.ink }}
        title={`Open ${client.name}`} aria-label={`Open ${client.name}`} onClick={e => { e.stopPropagation(); onOpenClient() }}>
        <b>{hub.big}</b><small>{hub.small}</small>
      </button>
      <svg className="dial-svg" viewBox="0 0 640 640" aria-hidden={false}>{parts}</svg>
    </div>
  )
}
