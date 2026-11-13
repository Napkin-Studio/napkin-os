// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The bar's panel, mounted once beside the shell's overlays (App.tsx), so it is the same on every screen: the keys that
// open it (Cmd K or Ctrl K, and ? for the shortcuts), the results under the field (a full-width sheet at a phone's
// width), the empty bar (the person's doors and the last five things they opened), a person's card, and the
// shortcuts sheet. It asks the providers for results and does nothing else itself: no model, no decision.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { HomeView } from '../../host/http'
import { parseRoute, type Route } from '../route'
import { BarList } from './BarList'
import { flatten, optionId } from './listModel'
import { BarInput, FIELD_NAME } from './BarField'
import { ShortcutsSheet } from './Shortcuts'
import { barKeyOf } from './keys'
import { commandsFor, isMac, matchCommands, type Command } from './commands'
import { closeBar, closeShortcuts, openBar, openShortcuts, setActiveId, setCard, setKeyHandler, useBar } from './barStore'
import { barProviders, commandResult, GROUP_LABEL, runProviders, type BarGroup } from './providers'

export interface RecentDoc { path: string; title: string }

interface Props {
  /** Only where the shell has a server to ask and a person signed in to ask for. */
  enabled: boolean
  home: HomeView | null
  go: (r: Route) => void
  openPath: (path: string) => void
  /** What the person opened last, newest first: the empty bar lists five. */
  recent: readonly RecentDoc[]
  signedIn: boolean
  onSignOut?: () => void
  /** The panel's own slot, under the results: where Ask Nap's answer will sit. Empty today. */
  panelSlot?: ReactNode
}

/** Where the bar's panel sits: under the field, at the field's left edge, or the whole width at a phone's. */
function usePlace(on: boolean, phone: boolean) {
  const [place, setPlace] = useState<{ top: number; left: number; width: number } | null>(null)
  // The bar's box is read after layout (it is the shell's, not ours): a measurement, not derived state.
  useLayoutEffect(() => {
    if (!on) return
    const measure = () => {
      const bar = document.querySelector('[data-testid="os-bar"]')?.getBoundingClientRect()
      const field = document.querySelector('[data-testid="bar-field"]')?.getBoundingClientRect()
      const top = Math.max(0, Math.round((bar?.bottom ?? 62) + 2))
      if (phone || !field) { setPlace({ top, left: 0, width: window.innerWidth }); return }
      const width = Math.min(560, window.innerWidth - 16)
      setPlace({ top: Math.round(field.bottom + 8), left: Math.round(Math.max(8, Math.min(field.left, window.innerWidth - width - 8))), width })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [on, phone])
  return place
}

export function BarMount({ enabled, home, go, openPath, recent, signedIn, onSignOut, panelSlot }: Props) {
  const bar = useBar()
  // The bar carries no field (owner, 13 Nov): the search is one panel at every width, opened by Cmd or Ctrl K or the account menu.
  const phone = true
  const mac = isMac()
  const commands = useMemo(() => commandsFor({
    home, go, signedIn,
    undo: bar.history?.canUndo ? bar.history.undo : null,
    redo: bar.history?.canRedo ? bar.history.redo : null,
    signOut: onSignOut ?? null,
    openBar: () => openBar(), openShortcuts,
  }), [home, go, signedIn, onSignOut, bar.history])

  // The keys: Cmd or Ctrl K from anywhere, even in a field; ? only where no field owns it.
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      const k = barKeyOf(e)
      if (!k) return
      e.preventDefault()
      if (k === 'open') openBar()
      else openShortcuts()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])

  const query = bar.query
  const q = query.trim()
  const [answer, setAnswer] = useState<{ q: string; groups: BarGroup[] } | null>(null)
  useEffect(() => {
    if (!enabled || !bar.open || !q) return
    const ctl = new AbortController()
    const t = setTimeout(() => {
      void runProviders(q, { commands }, ctl.signal, barProviders().filter(p => p.id !== 'commands')).then(groups => { if (!ctl.signal.aborted) setAnswer({ q, groups }) })
    }, 90)
    return () => { ctl.abort(); clearTimeout(t) }
  }, [enabled, bar.open, q, commands])
  const searching = !!q && answer?.q !== q

  const groups: BarGroup[] = useMemo(() => {
    if (!q) {
      const go_ = commands.filter(c => c.available && (c.id.startsWith('door-') || c.id === 'home'))
      const out: BarGroup[] = []
      if (go_.length) out.push({ id: 'go', label: GROUP_LABEL.go, items: go_.map(commandResult) })
      if (recent.length) out.push({ id: 'recent', label: GROUP_LABEL.recent, items: recent.slice(0, 5).map(d => ({ key: `recent:${d.path}`, kind: 'recent', title: d.title || 'Untitled', line: '', act: { type: 'document' as const, path: d.path } })) })
      return out
    }
    const mine = matchCommands(commands, q)
    const out: BarGroup[] = mine.length ? [{ id: 'command', label: GROUP_LABEL.command, items: mine.map(commandResult) }] : []
    return [...out, ...(answer?.q === q ? answer.groups : [])]
  }, [q, commands, recent, answer])
  const flat = flatten(groups)

  // The active result, and the command waiting on its second Enter.
  const [at, setAt] = useState<{ q: string; i: number }>({ q: '', i: 0 })
  const active = flat.length ? Math.min(at.q === q ? at.i : 0, flat.length - 1) : -1
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const activeCmd = active >= 0 && flat[active].act.type === 'command' ? flat[active].act.command : null
  const confirm = activeCmd && !activeCmd.undoable && confirmId === activeCmd.id ? activeCmd.warns ?? 'This cannot be undone.' : null
  const card = bar.card
  useEffect(() => { setActiveId(bar.open && active >= 0 ? optionId(active) : null) }, [bar.open, active])

  const pick = (i: number) => {
    const r = flat[i]
    if (!r) return
    const a = r.act
    if (a.type === 'person') { setCard({ name: a.name, line: a.line, jobs: a.jobs }); return }
    if (a.type === 'command') {
      const c: Command = a.command
      if (!c.undoable && confirmId !== c.id) { setConfirmId(c.id); return }
      closeBar(false)
      c.run()
      return
    }
    closeBar(false)
    if (a.type === 'route') go(parseRoute(a.hash))
    else openPath(a.path)
  }
  const move = (to: number) => { setAt({ q, i: to }); setConfirmId(null) }
  const onKey = (e: { key: string; preventDefault: () => void }) => {
    const n = flat.length
    if (e.key === 'ArrowDown') { e.preventDefault(); if (n) move((active + 1) % n) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (n) move((active - 1 + n) % n) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(active) }
  }
  const keys = useRef(onKey)
  useEffect(() => { keys.current = onKey })
  useEffect(() => { setKeyHandler(e => keys.current(e)); return () => setKeyHandler(null) }, [])

  // Escape closes a card, then the bar, from wherever focus is; a press outside closes it.
  useEffect(() => {
    if (!bar.open) return
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      if (card) setCard(null)
      else closeBar()
    }
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null
      if (t?.closest?.('[data-bar-panel], [data-testid="bar-field"], [data-testid="bar-search-button"]')) return
      closeBar(false)
    }
    // In the capture phase, before the page's own Escape (which goes up a level): the bar closes first and the page sees the key handled.
    document.addEventListener('keydown', onEsc, true)
    document.addEventListener('pointerdown', onDown, true)
    return () => { document.removeEventListener('keydown', onEsc, true); document.removeEventListener('pointerdown', onDown, true) }
  }, [bar.open, card])

  const place = usePlace(bar.open, phone)
  if (!enabled) return null

  const status = searching ? 'Searching' : q && !flat.length ? `Nothing matches \u201c${q}\u201d.` : q ? `${flat.length} ${flat.length === 1 ? 'result' : 'results'}` : ''
  const panel = bar.open && place ? createPortal(
    <div className="nui">
      <div
        className={phone ? 'bar-panel bar-sheet' : 'bar-panel'}
        data-bar-panel
        data-testid="bar-panel"
        role={phone ? 'dialog' : undefined}
        aria-label={phone ? FIELD_NAME : undefined}
        style={phone ? { top: place.top } : { top: place.top, left: place.left, width: place.width }}
      >
        {phone && (
          <div className="bar-sheet-row">
            <div className="bar-field bar-field-sheet"><BarInput autoFocus /></div>
            <button type="button" className="bar-close" onClick={() => closeBar()} aria-label="Close the search">Close</button>
          </div>
        )}
        {card ? (
          <div className="bar-card" data-testid="bar-person-card">
            <div className="bar-card-name"><b>{card.name}</b><small>{card.line}</small></div>
            {card.jobs.length > 0 && <div className="bar-card-jobs">
              <span className="bar-gh">Jobs</span>
              {card.jobs.map(j => <button key={j} type="button" className="bar-chip" onClick={() => { closeBar(false); go({ level: 'job', number: j }) }}>{j}</button>)}
            </div>}
            <button type="button" className="bar-chip bar-back" onClick={() => setCard(null)}>Back to the results</button>
          </div>
        ) : flat.length > 0 ? (
          <BarList groups={groups} active={active} onPick={pick} onHover={move} confirm={confirm} />
        ) : q && !searching ? (
          <div className="bar-none" data-testid="bar-none">
            <b>Nothing matches {'\u201c'}{q}{'\u201d'}.</b>
            <small>Try a job number, a client, a person, a tool, or a month.</small>
          </div>
        ) : null}
        <div className="bar-status" role="status" aria-live="polite" data-testid="bar-status">{status}</div>
        {panelSlot && <div className="bar-panel-slot" data-slot="panel">{panelSlot}</div>}
        <div className="bar-foot">
          <span className="bar-foot-hint">Up and down to move, Enter to open, Esc to close</span>
          <button type="button" className="bar-link" data-testid="bar-shortcuts-link" onMouseDown={e => e.preventDefault()} onClick={() => { closeBar(false); openShortcuts() }}>Keyboard shortcuts</button>
        </div>
      </div>
    </div>,
    document.body,
  ) : null
  return (
    <>
      {panel}
      {bar.shortcuts && <ShortcutsSheet commands={commands} mac={mac} onClose={() => closeShortcuts()} />}
    </>
  )
}

