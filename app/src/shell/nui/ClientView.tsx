// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// One client's page, as the approved mock draws it (renderClientPage, phase
// 33; gaps.md §2): the client's disc, "CLIENT · SINCE MAR 2025", the name and
// a line naming the work, the ⋯ menu (Rename, Archive); then Needs you, the
// work by tool (Briefs, Research, Decks, Production, each with its +), the
// Brand Clan card and the decisions on record. No tool wheel: 1 to 4 open a
// tool's own page, as the wheel's number keys did.

import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ClientRecord, LibraryItem } from '../../host'
import { needsYou } from '../landing/model'
import { toolById, toolOfApp, type Tool } from '../landing/tools'
import { isTyping } from '../landing/keys'
import { BRAND_APP } from '../landing/BrandClanCard'
import { clientLine, clientLook, monogramOf, stateWords, callsIn, type Facts } from './deskData'
import { ToolIcon } from './icons'
import { Pop } from './Pop'
import { usePop } from './popKit'

const GROUPS = [
  { tool: 'brief', label: 'Briefs', kind: 'Brief', icon: 'brief' },
  { tool: 'research', label: 'Research', kind: 'Research', icon: 'research' },
  { tool: 'deck', label: 'Decks', kind: 'Deck', icon: 'deck' },
  { tool: 'prod', label: 'Production', kind: 'Production', icon: 'production' },
] as const

/** "2d", "1w", "4m", "3h": how long ago, the mock's short way. */
function short(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000)
  if (Number.isNaN(s)) return ''
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  if (s < 7 * 86400) return `${Math.round(s / 86400)}d`
  return `${Math.round(s / (7 * 86400))}w`
}

interface Props {
  client: ClientRecord
  /** This client's work, newest first. */
  items: LibraryItem[]
  facts: Facts
  live: ReadonlySet<string>
  onOpenItem: (path: string) => void
  /** Start a document of a live tool for this client. */
  onNew: (tool: Tool) => void
  /** A tool's own page for this client (the number keys). */
  onOpenTool: (tool: Tool) => void
  onSoon: (tool: Tool) => void
  /** The decisions on record: the Decisions drawer. */
  onDecisions?: () => void
  /** Rename and archive, when the host lets this screen look after the registry. */
  onRename?: (name: string) => Promise<string | null>
  onArchive?: () => Promise<string | null>
}

export function ClientView({ client: c, items, facts, live, onOpenItem, onNew, onOpenTool, onSoon, onDecisions, onRename, onArchive }: Props) {
  const pop = usePop<'more' | 'deck'>()
  const [mode, setMode] = useState<'idle' | 'rename' | 'archive'>('idle')
  const look = clientLook(c.id)
  const work = items.filter(i => i.app_id !== BRAND_APP)
  const brand = items.filter(i => i.app_id === BRAND_APP)
  const needing = work.filter(needsYou)
  const calls = work.reduce((n, i) => n + callsIn(i), 0)
  const since = new Date(c.created_at)
  const sinceWords = Number.isNaN(since.getTime()) ? '' : ` · SINCE ${since.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }).toUpperCase()}`
  const lead = clientLine(work)
  const line = work.length === 0 ? 'No work yet'
    : calls ? `${lead.split(' · ')[0]} live · ${calls} call${calls === 1 ? '' : 's'} need${calls === 1 ? 's' : ''} you` : lead
  const decisions = work.reduce((n, i) => n + (facts[i.path]?.decisions ?? 0), 0)
  const read = work.filter(i => facts[i.path]).length

  // The number keys open a tool's own page, wherever the focus is on this page, except in a field.
  const pick = useRef<(i: number) => void>(() => {})
  useEffect(() => {
    pick.current = (i: number) => {
      const t = toolById(GROUPS[i].tool)
      if (!t) return
      if (live.has(t.id)) onOpenTool(t)
      else onSoon(t)
    }
  })
  useEffect(() => {
    const onNumber = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isTyping(e.target)) return
      if (!/^[1-4]$/.test(e.key)) return
      e.preventDefault()
      pick.current(Number(e.key) - 1)
    }
    document.addEventListener('keydown', onNumber)
    return () => document.removeEventListener('keydown', onNumber)
  }, [])

  const row = (i: LibraryItem) => {
    const t = toolOfApp(i.app_id)
    const g = GROUPS.find(x => x.tool === t?.id)
    const st = stateWords(i)
    return (
      <button key={i.path} type="button" className="cp-row" data-testid="work-item" onClick={() => onOpenItem(i.path)}>
        <span className={`cp-ico k-${g?.icon ?? 'production'}`}><ToolIcon tool={g?.icon ?? 'production'} /></span>
        <span className="cp-t"><b>{i.title || 'Untitled'}</b><small>{g?.kind ?? 'Other'}</small></span>
        <span className={`cp-st ${st.needs ? 'needs' : st.working ? 'working' : ''}`}>{st.text}</span>
        <span className="cp-d">{short(i.updated_at)}</span>
      </button>
    )
  }

  const groups = GROUPS.map(g => ({ ...g, docs: work.filter(i => toolOfApp(i.app_id)?.id === g.tool) }))
    // A new client lists Briefs and Research; Decks and Production once there is one (the mock's client page).
    .filter(g => g.docs.length > 0 || g.tool === 'brief' || g.tool === 'research')
  const other = work.filter(i => !toolOfApp(i.app_id) || !GROUPS.some(g => g.tool === toolOfApp(i.app_id)!.id))
  const sources = work.filter(i => ['brief', 'research'].includes(toolOfApp(i.app_id)?.id ?? ''))

  return (
    <div className="nui nui-page" data-testid="client-page" data-client={c.id}>
      <div className="studio-shell">
        <main id="view-client">
          <header className="cp-head">
            <span className="cl-disc cp-disc" style={{ ['--cl' as string]: look.cl, ['--cl-ink' as string]: look.ink }}><b>{monogramOf(c)}</b></span>
            <div>
              <div className="eyebrow">CLIENT{sinceWords}</div>
              <h1 className="hero-title" tabIndex={-1}>{c.name}<span className="period-dot" aria-hidden /></h1>
              <p className="hero-sub" data-testid="client-line">{line}</p>
            </div>
            {(onRename || onArchive) && (
              <button type="button" className="p33-more cp-more-btn" id="p33-cp-more" title="Client options" aria-label={`Options for ${c.name}`}
                aria-haspopup="menu" aria-expanded={pop.open?.key === 'more'} data-testid="client-more"
                onClick={e => pop.toggle('more', e.currentTarget)}>⋯</button>
            )}
          </header>
          {mode === 'rename' && onRename && <RenameForm name={c.name} onRename={onRename} onClose={() => setMode('idle')} />}
          {mode === 'archive' && onArchive && <ArchiveConfirm name={c.name} onArchive={onArchive} onClose={() => setMode('idle')} />}

          {needing.length > 0 && (
            <section className="cp-sec" aria-label={`Needs you for ${c.name}`} data-testid="client-needs">
              <h2 className="cp-h">Needs you</h2>
              <div className="cp-box">{needing.map(row)}</div>
            </section>
          )}

          {work.length === 0 && <p className="cp-none" data-testid="no-work">No work yet. Start the first brief or research for {c.name} with its +.</p>}

          {groups.map(g => {
            const t = toolById(g.tool)!
            const on = live.has(t.id)
            return (
              <section key={g.tool} className={`cp-sec cp-group k-${g.icon}`} data-testid={`group-${g.tool}`} aria-label={`${g.label} for ${c.name}`}>
                <div className="cp-hrow">
                  <h2 className="cp-h"><span className={`cp-ico k-${g.icon}`}><ToolIcon tool={g.icon} /></span>{g.label}<small>{g.docs.length}</small></h2>
                  <span className="cp-new">
                    <button type="button" className="cp-plus" data-new={g.tool} data-testid={`new-${g.tool}`}
                      title={on ? `New ${t.noun[0]}` : `${t.full} is coming soon`} aria-label={on ? `New ${t.noun[0]} for ${c.name}` : `${t.full} is coming soon`}
                      aria-disabled={on ? undefined : true}
                      onClick={e => {
                        if (!on) { onSoon(t); return }
                        if (g.tool === 'deck' && sources.length) pop.toggle('deck', e.currentTarget)
                        else onNew(t)
                      }}>+</button>
                  </span>
                </div>
                <div className="cp-box">{g.docs.length ? g.docs.map(row) : <p className="cp-empty">Nothing here yet.</p>}</div>
              </section>
            )
          })}
          {other.length > 0 && (
            <section className="cp-sec cp-group" data-testid="group-other">
              <div className="cp-hrow"><h2 className="cp-h">Other<small>{other.length}</small></h2></div>
              <div className="cp-box">{other.map(row)}</div>
            </section>
          )}

          <section className="cp-sec" aria-label={`Brand Clan for ${c.name}`} data-testid="brand-clan">
            <h2 className="cp-h">Brand Clan</h2>
            {brand.length > 0 ? <div className="cp-box">{brand.map(row)}</div> : (
              <div className="cp-box cp-clan">
                <div>
                  <b>Brand Clan · not started</b>
                  <p>Its logos, colours and voice will live here, and every document for {c.name} can use them.</p>
                  <p className="mono">voice 0 · rules 0 · assets 0 · approved work 0</p>
                </div>
                <div>
                  <span className="cp-sw" aria-hidden><i style={{ background: look.cl }} /><i style={{ background: look.ink }} /><i style={{ background: '#141413' }} /><i style={{ background: '#FFFDF8' }} /></span>
                  <p id="cp-clan-why">Brand Clan is not in this studio yet; it arrives with the Brand Clan app.</p>
                  <button type="button" className="side-link" id="cp-kit" aria-disabled aria-describedby="cp-clan-why" data-testid="brand-start">Open kit</button>
                </div>
              </div>
            )}
          </section>

          {read > 0 && (
            <p className="cp-record">
              <button type="button" className="side-link" onClick={onDecisions} data-testid="client-record">
                {decisions} decision{decisions === 1 ? '' : 's'} on the record · {read} document{read === 1 ? '' : 's'}
              </button>
            </p>
          )}
        </main>
      </div>

      {pop.open?.key === 'more' && (
        <Pop anchor={pop.open.anchor} align="right" onClose={pop.close} label={`Options for ${c.name}`} testid="client-menu">
          {onRename && <button type="button" role="menuitem" onClick={() => { pop.close(false); setMode('rename') }}>Rename<small>How the client shows across the studio</small></button>}
          {onArchive && <button type="button" role="menuitem" onClick={() => { pop.close(false); setMode('archive') }}>Archive<small>Off the desk; restore it any time</small></button>}
        </Pop>
      )}
      {pop.open?.key === 'deck' && (
        <Pop anchor={pop.open.anchor} align="right" onClose={pop.close} label="Start a deck from" testid="deck-from">
          <div className="pp-h">Start a deck from</div>
          {sources.map(s => (
            <button key={s.path} type="button" role="menuitem" onClick={() => { pop.close(false); onOpenItem(s.path) }}>
              {s.title || 'Untitled'}<small>{toolOfApp(s.app_id)?.id === 'brief' ? 'Brief' : 'Research'} · opens it; Continue in ▾ makes the deck</small>
            </button>
          ))}
          <button type="button" role="menuitem" onClick={() => { pop.close(false); onNew(toolById('deck')!) }}>A blank deck<small>Start from nothing</small></button>
        </Pop>
      )}
    </div>
  )
}

function RenameForm({ name, onRename, onClose }: { name: string; onRename: (name: string) => Promise<string | null>; onClose: () => void }) {
  const [value, setValue] = useState(name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const v = value.trim()
    if (!v || v === name) return
    setBusy(true); setError(null)
    const refused = await onRename(v)
    setBusy(false)
    if (refused) setError(refused)
    else onClose()
  }
  return (
    <form className="cl-add-form" aria-label={`Rename ${name}`} data-testid="rename-form" onSubmit={submit}
      onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }}>
      <label>New name<input autoFocus autoComplete="off" maxLength={60} value={value} onChange={e => setValue(e.target.value)} aria-invalid={error ? true : undefined} /></label>
      <button type="submit" className="btn-rect primary" disabled={busy || !value.trim() || value.trim() === name}>{busy ? 'Saving…' : 'Rename'}</button>
      <button type="button" className="btn-rect" onClick={onClose}>Cancel</button>
      <p className="cl-add-err" role={error ? 'alert' : undefined}>{error ?? 'Its work keeps its link: documents follow the client, not the name.'}</p>
    </form>
  )
}

function ArchiveConfirm({ name, onArchive, onClose }: { name: string; onArchive: () => Promise<string | null>; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="cl-add-form" role="group" aria-label={`Archive ${name}`} data-testid="archive-confirm"
      onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }}>
      <p className="cl-add-msg">Archive {name}? It leaves the desk. Its work is kept, and Archived on the desk brings it back.</p>
      <button type="button" className="btn-rect primary" autoFocus disabled={busy}
        onClick={async () => { setBusy(true); const r = await onArchive(); setBusy(false); if (r) setError(r) }}>{busy ? 'Archiving…' : `Archive ${name}`}</button>
      <button type="button" className="btn-rect" onClick={onClose}>Keep it</button>
      {error && <p className="cl-add-err" role="alert">{error}</p>}
    </div>
  )
}
