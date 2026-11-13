// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The desk, as the approved mock draws it (phase 33; gaps.md §1): the
// greeting, Find a client, Archived and the desk's ⋯ menu, one row of client
// circles (each in the client's colour, with a needs badge and a line that
// names the work), the dial a circle opens in place, then Pick up where you
// left off (Everyone / Me) and Worth a look. It replaces the agency home and
// the clients wheel: their Needs you and Running strips live on as the pick-up
// rows' state and the circles' lines, the Decisions drawer lists the calls.
//
// Keyboard: the circles are one tab stop (arrows, Home and End rove them),
// Enter opens a circle's dial, 1 to 4 pick a quadrant, Escape closes it.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { ClientRecord, LegacyName } from '../../host'
import { ACTIVITY_WORD, adoptLabel, agencySummary, countsLine, matches, pageOf } from '../landing/model'
import type { Tool } from '../landing/tools'
import type { Manage } from '../landing/useLanding'
import { AdoptPanel } from '../landing/Registry'
import type { LandingData } from '../landing/store'
import { greeting } from '../when'
import { clientName, deskClients, pickRows, sectorOf, worthItems, type DeskClient, type Facts } from './deskData'
import { Dial } from './Dial'
import { ToolIcon, SearchIcon } from './icons'
import { Pop } from './Pop'
import { usePop } from './popKit'
import { changedBriefs } from '../gate/words'
import { Ask } from '../../timesheet/Ask'
import { useConsent } from '../../timesheet/consent'
import '../gate/gate.css'

interface Props {
  data: LandingData
  facts: Facts
  /** Which tools have an installed app. */
  live: ReadonlySet<string>
  /** The person's first name, for the greeting. */
  first: string | null
  manage?: Manage
  /** Add a client, with the sector typed (kept in this browser). Resolves with the host's words on a refusal. */
  onAdd: (name: string, sector: string) => Promise<string | null>
  onOpenClient: (id: string) => void
  onOpenTool: (clientId: string, tool: Tool) => void
  onSoon: (tool: Tool) => void
  onOpenDocument: (path: string) => void
  onOpenFile?: () => void
  onOffline?: () => void
  /** How many offline copies this device holds, when known. */
  offlineCount?: number | null
  /** Said in the polite live region (a restore, an adoption). */
  onSay: (words: string) => void
  /** What a role adds under the greeting: the Your pages row (shell/nui/PagesRow.tsx). Absent for a person with no role. */
  roleSlot?: ReactNode
  /** What a role adds under the client circles, before Pick up where you left off: Needs you, until align-needs-lock-people replaces it. */
  needsSlot?: ReactNode
  /**
   * The tools the person's role is offered (the server's list); null offers all, as for a person with no role. A tool
   * not in it is absent from the dial. The dial's quadrants are Brief, Research, Deck and Production.
   */
  offered?: ReadonlySet<string> | null
  /** Opens the person's own timesheet day (the consent card's "What is captured"). */
  onTimesheet?: () => void
}

type PopKey = 'archived' | 'more'

/** Where the dial sits over its circle: the mock's openClient placement, kept inside the row. */
function placeOf(row: HTMLElement, circle: HTMLElement): { left: number; top: number; origin: string } {
  const W = 360
  const rr = row.getBoundingClientRect(), dr = (circle.querySelector('.cl-disc') ?? circle).getBoundingClientRect()
  const cx = dr.left + dr.width / 2 - rr.left
  const left = Math.max(-8, Math.min(cx - W / 2, rr.width - W + 8))
  const top = dr.top - rr.top - 12
  return { left, top, origin: `${cx - left}px ${dr.height / 2 + 12}px` }
}

export function Desk({ data, facts, live, first, manage, onAdd, onOpenClient, onOpenTool, onSoon, onOpenDocument, onOpenFile, onOffline, offlineCount, onSay, roleSlot, needsSlot, offered = null, onTimesheet }: Props) {
  // Asked once, at the person's first sign-in: only a signed-in person has a timesheet to ask about.
  const consent = useConsent()
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [adding, setAdding] = useState(false)
  const [from, setFrom] = useState<'all' | 'me'>('all')
  const [dial, setDial] = useState<string | null>(null)
  const [place, setPlace] = useState<{ left: number; top: number; origin: string } | null>(null)
  const [at, setAt] = useState(0)
  const pop = usePop<PopKey>()
  const row = useRef<HTMLDivElement>(null)
  const top = useRef<HTMLDivElement>(null)

  // What the registry can still be asked to do: read when the desk opens and after a change.
  const [offer, setOffer] = useState<LegacyName[]>([])
  const [archived, setArchived] = useState<ClientRecord[]>([])
  const [adopting, setAdopting] = useState(false)
  const stamp = `${data.clients.length}:${data.unassigned}`
  useEffect(() => {
    if (!manage) return
    let fresh = true
    manage.legacy().then(o => { if (fresh) setOffer(o) }, () => { if (fresh) setOffer([]) })
    manage.archived().then(a => { if (fresh) setArchived(a) }, () => { if (fresh) setArchived([]) })
    return () => { fresh = false }
  }, [manage, stamp])

  // The heading takes focus on arrival, so a keyboard or a screen reader lands on it.
  useEffect(() => { top.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true }) }, [])

  const all = useMemo(() => deskClients(data.clients, data.items), [data])
  const page = useMemo(() => {
    const summaries = all.map(c => c.summary)
    const p = pageOf(summaries, query, showAll)
    const ids = new Set(p.shown.map(s => s.client.id))
    return { shown: all.filter(c => ids.has(c.id)), hidden: p.hidden, total: all.filter(c => matches(c.name, query)).length }
  }, [all, query, showAll])
  const shownIds = page.shown.map(c => c.id).join(',')
  const atNow = Math.min(at, Math.max(0, page.shown.length - 1))

  // Whether the dial was opened from the keyboard (a click with no pointer): then its first quadrant takes the focus.
  const [byKey, setByKey] = useState(false)
  const dialTools = useMemo(() => (offered ? ['brief', 'research', 'deck', 'prod'].filter(t => offered.has(t)) : null), [offered])
  const openDial = useCallback((id: string, el: HTMLElement, key = false) => {
    // A role offered none of the dial's tools goes straight to the client's page, which lists what it may open.
    if (dialTools && dialTools.length === 0) { onOpenClient(id); return }
    setByKey(key)
    setDial(d => (d === id ? null : id))
    if (row.current) setPlace(placeOf(row.current, el))
  }, [dialTools, onOpenClient])
  // Escape closes the dial and gives the focus back to its circle.
  const dialRef = useRef<string | null>(null)
  useEffect(() => { dialRef.current = dial })
  const closeDial = useCallback(() => {
    const id = dialRef.current
    setDial(null)
    // After the dial has gone: an open circle is hidden behind it, and a hidden button takes no focus.
    if (id) requestAnimationFrame(() => row.current?.querySelector<HTMLElement>(`.cl-circle[data-client="${CSS.escape(id)}"]`)?.focus())
  }, [])
  // A click anywhere off the circles closes the dial (the mock's document listener).
  useEffect(() => {
    if (!dial) return
    const off = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest?.('.cl-circle, .dial')) setDial(null) }
    document.addEventListener('pointerdown', off)
    return () => document.removeEventListener('pointerdown', off)
  }, [dial])
  // Placed again when the row reflows (a search, Show all, a resize).
  useLayoutEffect(() => {
    if (!dial || !row.current) return
    const el = row.current.querySelector<HTMLElement>(`.cl-circle[data-client="${CSS.escape(dial)}"]`)
    if (!el) { setDial(null); return }
    const again = () => { if (row.current) setPlace(placeOf(row.current, el)) }
    again()
    window.addEventListener('resize', again)
    return () => window.removeEventListener('resize', again)
  }, [dial, shownIds])

  const onRowKey = (e: React.KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    // Only the circles rove here; the dial (inside the row) keeps its own arrows.
    if (!(e.target as HTMLElement).closest?.('.cl-circle')) return
    const n = page.shown.length
    if (!n) return
    const k = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>
    let to: number | null = null
    if (e.key in k) to = (atNow + k[e.key] + n) % n
    if (e.key === 'Home') to = 0
    if (e.key === 'End') to = n - 1
    if (to === null) return
    e.preventDefault()
    setAt(to)
    row.current?.querySelectorAll<HTMLElement>('.cl-circle[data-client]')[to]?.focus()
  }

  const hello = first ? `${greeting().replace(/\.$/, '')}, ${first}.` : greeting()
  const picks = useMemo(() => pickRows(data.items, facts, from, data.person?.id ?? null), [data.items, facts, from, data.person?.id])
  const worth = useMemo(() => worthItems(data.items, facts), [data.items, facts])
  const open = dial ? all.find(c => c.id === dial) ?? null : null
  const none = data.clients.length === 0
  // The eyebrow counts the desk: clients, open work, and what needs you, runs or failed (the old agency home's line).
  const counts = countsLine(agencySummary(data.clients, data.items, data.unassigned))

  return (
    <div className="nui nui-page" ref={top} data-testid="desk">
      <div className="studio-shell">
        <section className="app-head">
          <div className="app-head-text">
            <div className="eyebrow" id="hero-eyebrow" data-testid="counts" aria-label={`Your desk: ${counts}`}>YOUR DESK · {counts.toUpperCase()}</div>
            <h1 className="hero-title" id="hero-title" tabIndex={-1}>Clients<span className="period-dot" aria-hidden /></h1>
            <p className="hero-sub" id="hero-sub" data-testid="greeting">
              {hello} {none ? 'Add your first client to start their desk.' : 'Pick a client to open their work, or add a new one.'}
            </p>
          </div>
        </section>

        <main id="view-desk">
          {roleSlot}
          {data.registryError && (
            <p className="nui-banner" role="alert" data-testid="registry-error">
              The client list could not be read, so names shown are the documents’ own. {data.registryError}
            </p>
          )}
          {changedBriefs(data.items).map(i => (
            <div key={i.path} className="gate-alert" role="status" data-testid="alert">
              <i aria-hidden />
              <span><b>Changed brief</b> {i.title}{i.client ? `, ${clientName(i.client)}` : ''}. The signed version stays as it was; the new one needs signing.</span>
              <button type="button" className="ch-btn" onClick={() => onOpenDocument(i.path)}>Open the brief</button>
            </div>
          ))}
          <section className="cl-row-wrap" aria-label="Clients">
            <div className="p33-desk-tools">
              <label className="p33-search">
                <SearchIcon />
                <input type="search" id="p33-csearch" placeholder="Find a client" aria-label="Find a client" value={query}
                  data-testid="client-search" onChange={e => { setQuery(e.target.value); setDial(null) }} />
              </label>
              <span className="sp" />
              {manage && (
                <button type="button" className="side-link" id="p33-archived" aria-haspopup="menu" aria-expanded={pop.open?.key === 'archived'}
                  data-testid="archived-link" onClick={e => pop.toggle('archived', e.currentTarget)}>Archived · {archived.length}</button>
              )}
              <button type="button" className="p33-more" id="p33-desk-more" title="More" aria-label="More for the desk"
                aria-haspopup="menu" aria-expanded={pop.open?.key === 'more'} data-testid="desk-more"
                onClick={e => pop.toggle('more', e.currentTarget)}>⋯</button>
            </div>

            {adopting && manage && offer.length > 0 && (
              <div className="nui-panel">
                <AdoptPanel offer={offer} onAdopt={async names => {
                  const r = await manage.adopt(names)
                  if ('words' in r) onSay(r.words)
                  return r
                }} onClose={() => setAdopting(false)} />
              </div>
            )}

            <div className="cl-row" id="cl-row" ref={row} role="group" aria-label="Your clients" onKeyDown={onRowKey}>
              {page.shown.map((c, i) => (
                <ClientCircle key={c.id} c={c} tab={i === atNow} open={dial === c.id}
                  onFocus={() => setAt(i)} onClick={(el, key) => openDial(c.id, el, key)} />
              ))}
              <button type="button" className="cl-circle cl-add" id="cl-add-btn" data-testid="add-client" aria-expanded={adding}
                onClick={() => setAdding(true)}>
                <span className="cl-disc"><b aria-hidden>+</b></span>
                <span className="cl-name">{none ? 'Add your first client' : 'New client'}</span>
                <span className="cl-line">Start a client desk</span>
              </button>
              {open && place && (
                <Dial
                  client={{ id: open.id, name: open.name, sector: sectorOf(open.id), look: open.look }}
                  items={data.items.filter(i => i.client?.id === open.id)}
                  live={live}
                  offered={offered}
                  place={place}
                  onOpenTool={t => { setDial(null); onOpenTool(open.id, t) }}
                  onSoon={onSoon}
                  onOpenClient={() => { setDial(null); onOpenClient(open.id) }}
                  onClose={closeDial}
                  focusFirst={byKey}
                />
              )}
            </div>
            {data.unassigned > 0 && (
              <p className="nui-empty" data-testid="unassigned">
                {data.unassigned === 1 ? '1 piece of work is' : `${data.unassigned} pieces of work are`} not attached to a client yet.
              </p>
            )}
            {query.trim() && page.total === 0 && (
              <p className="nui-empty" data-testid="no-match">No client matches “{query.trim()}”.</p>
            )}
            {page.hidden > 0 && (
              <p className="nui-more"><button type="button" className="side-link" data-testid="show-all" onClick={() => setShowAll(true)}>
                Show all {all.length}
              </button></p>
            )}
            {adding && <AddForm onAdd={onAdd} onClose={() => setAdding(false)} />}

            {needsSlot}
            {none && consent === 'not_asked' && (
              <section className="p33-desk" id="p33-desk"><div><h3>Worth a look</h3><div className="p33-worth-list" data-testid="worth-a-look"><Ask variant="card" onTimesheet={onTimesheet} /></div></div></section>
            )}
            {!none && (
              <section className="p33-desk" id="p33-desk">
                <div>
                  <h3>Pick up where you left off
                    <span className="seg-row" id="p33-from" role="group" aria-label="Whose work">
                      <button type="button" aria-pressed={from === 'all'} onClick={() => setFrom('all')}>Everyone</button>
                      <button type="button" aria-pressed={from === 'me'} onClick={() => setFrom('me')}>Me</button>
                    </span>
                  </h3>
                  <div className="p33-pick-list" id="p33-pick" data-testid="pick-up">
                    {picks.map(p => (
                      <button key={p.path} type="button" className="p33-pk" data-testid="pick-row" onClick={() => onOpenDocument(p.path)}>
                        <span className="pk-ico"><ToolIcon tool={p.icon} /></span>
                        <span><b>{p.title}</b><small>{p.sub}</small></span>
                        <span className={`pk-st ${p.needs ? 'needs' : ''}`}>{p.state}</span>
                      </button>
                    ))}
                    {picks.length === 0 && (
                      <p className="nui-empty">{from === 'me'
                        ? 'Nothing you touched last yet. What others changed is under Everyone.'
                        : 'Nothing to pick up yet. Open a client to start the first piece of work.'}</p>
                    )}
                  </div>
                </div>
                <div>
                  <h3>Worth a look</h3>
                  <div className="p33-worth-list" id="p33-worth" data-testid="worth-a-look">
                    {consent === 'not_asked' && <Ask variant="card" onTimesheet={onTimesheet} />}
                    {worth.map(w => (
                      <button key={w.key} type="button" className="p33-wl" onClick={() => onOpenDocument(w.path)}>
                        <b>{w.title}</b><small>{w.sub}</small>
                      </button>
                    ))}
                    {worth.length === 0 && consent !== 'not_asked' && <p className="nui-empty">Nothing new since you last looked.</p>}
                  </div>
                </div>
              </section>
            )}
          </section>
        </main>
      </div>

      {pop.open?.key === 'archived' && manage && (
        <Pop anchor={pop.open.anchor} align="right" onClose={pop.close} label="Archived clients" testid="archived">
          <div className="pp-h">Archived clients · {archived.length}</div>
          {archived.length === 0
            ? <p className="pp-sub" style={{ padding: '4px 10px 8px' }}>Nothing archived. Archive a client from its page (⋯).</p>
            : archived.map(c => <ArchivedRow key={c.id} c={c} onRestore={async () => {
              const refused = await manage.restore(c.id)
              if (!refused) { onSay('Restored.'); setArchived(a => a.filter(x => x.id !== c.id)) }
              return refused
            }} />)}
          {archived.length > 0 && <p className="pp-sub" style={{ padding: '4px 10px 8px' }}>Their work is kept and comes back with them.</p>}
        </Pop>
      )}
      {pop.open?.key === 'more' && (
        <Pop anchor={pop.open.anchor} align="right" onClose={pop.close} label="More for the desk" testid="desk-menu">
          <button type="button" role="menuitem" aria-disabled={!manage || offer.length === 0 || undefined}
            onClick={() => { if (!manage || offer.length === 0) return; pop.close(false); setAdopting(true) }}>
            {offer.length ? adoptLabel(offer.length) : 'Adopt clients'}
            <small>{offer.length ? 'Names in your documents that no client has yet' : 'Nothing to adopt: every document has its client'}</small>
          </button>
          {onOpenFile && (
            <button type="button" role="menuitem" onClick={() => { pop.close(false); onOpenFile() }}>
              Open a .clan file…<small>Or drop one on the desk</small>
            </button>
          )}
          {onOffline && (
            <button type="button" role="menuitem" onClick={() => { pop.close(false); onOffline() }}>
              Offline copies<small>{offlineCount != null ? `${offlineCount} on this device` : 'Kept on this device'}</small>
            </button>
          )}
        </Pop>
      )}
    </div>
  )
}

/** One client circle: its flat colour disc, monogram and needs badge; the name and a line naming the work. */
function ClientCircle({ c, tab, open, onFocus, onClick }: {
  c: DeskClient; tab: boolean; open: boolean; onFocus: () => void; onClick: (el: HTMLElement, byKey: boolean) => void
}) {
  // What its ring would say, in words: a quiet verb (reading, thinking, checking, working) or idle.
  const verb = c.summary.activity === 'human' || c.summary.activity === 'error' ? '' : `, ${ACTIVITY_WORD[c.summary.activity]}`
  const said = `${c.name}: ${c.line}${verb}${c.badge ? `. ${c.badge} need${c.badge === 1 ? 's' : ''} you` : ''}. Opens its tools`
  return (
    <button type="button" className={`cl-circle${open ? ' is-open' : ''}`} data-client={c.id} aria-pressed={open} tabIndex={tab ? 0 : -1}
      aria-description={said} data-testid="client-circle" data-activity={c.summary.activity} onFocus={onFocus} onClick={e => onClick(e.currentTarget, e.detail === 0)}>
      <span className="cl-disc" style={{ ['--cl' as string]: c.look.cl, ['--cl-ink' as string]: c.look.ink }}>
        <svg viewBox="0 0 116 116" aria-hidden><circle cx="58" cy="58" r="52" className="cl-track" /></svg>
        <b>{c.mono}</b>
        {c.badge > 0 && <span className="cl-badge" data-testid="needs-badge">{c.badge}</span>}
      </span>
      <span className="cl-name">{c.name}</span>
      <span className="cl-line">{c.line}</span>
    </button>
  )
}

function ArchivedRow({ c, onRestore }: { c: ClientRecord; onRestore: () => Promise<string | null> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const when = c.archived_at ? new Date(c.archived_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''
  return (
    <div className="pp-row">
      <span><b>{clientName(c)}</b><span className="pp-sub">{error ?? (when ? `Archived ${when}` : 'Archived')}</span></span>
      <button type="button" className="sp-btn" disabled={busy} aria-label={`Restore ${clientName(c)}`}
        onClick={async () => { setBusy(true); setError(await onRestore()); setBusy(false) }}>{busy ? 'Restoring…' : 'Restore'}</button>
    </div>
  )
}

/** The mock's add form: Client name and Sector, its own validation, the host's words on a refusal. */
export function AddForm({ onAdd, onClose }: { onAdd: (name: string, sector: string) => Promise<string | null>; onClose: () => void }) {
  const [name, setName] = useState('')
  const [sector, setSector] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('Give the client a name.'); return }
    setBusy(true); setError(null)
    const refused = await onAdd(name.trim(), sector)
    setBusy(false)
    if (refused) setError(refused)
    else onClose()
  }
  return (
    <form className="cl-add-form" id="cl-add-form" noValidate data-testid="add-form" aria-label="Add a client"
      onSubmit={submit} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }}>
      <label>Client name<input id="cl-add-name" type="text" placeholder="e.g. Kerrygold" required autoFocus autoComplete="off" maxLength={60}
        value={name} onChange={e => setName(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? 'cl-add-err' : undefined} /></label>
      <label>Sector<input id="cl-add-sector" type="text" placeholder="e.g. Dairy · Export" autoComplete="off" maxLength={60}
        value={sector} onChange={e => setSector(e.target.value)} /></label>
      <button type="submit" className="btn-rect primary" disabled={busy}>{busy ? 'Adding…' : 'Add client'}</button>
      <button type="button" className="btn-rect" id="cl-add-cancel" onClick={onClose}>Cancel</button>
      {error && <p className="cl-add-err" id="cl-add-err" role="alert">{error}</p>}
    </form>
  )
}
