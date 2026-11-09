// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The one OS bar, as the approved mock draws it (design/new-ui
// napkin-app-v1.html, phases 26 to 36; gaps.md §3 and §13.1, §13.4). Left,
// who and where: the medallion (the way home, and the one mark that changes
// when the document you are IN needs you), the agency's pill (its account
// menu: who you are, All tools, the crew, Offline copies, Install, Flat
// circles, Sign out), and the client chip (back to the client, or on the
// client page a switcher). Then the document, left-aligned (phase 36): its
// tool's icon and its name in serif with "saved · valid ✓" under it and the
// document menu on it, what it was made from, Continue in ▾ and Share. Right:
// the app's own chips and buttons, Client review, the beta badge, the theme,
// the crew in the document, and Decisions, the bar's one needs-your-call
// signal (amber with the count). No state pill (phase 26: state lives in the
// app's own side tab).
//
// Pure: everything it shows comes in as props, so a test can draw every state
// with no host.

import { Fragment, useCallback, useRef, useState, type ReactNode } from 'react'
import { LogoSpinner } from '../brand/LogoSpinner'
import { accountItems, continueItems, docMenuItems, shareItems, type Account, type BarPlace, type ClientChip, type Crew, type DocBar, type MenuItem } from './barMenus'
import { MedallionMark } from './Medallion'
import { markOf } from '../shell/agency/palette'
import ThemeToggle from './ThemeToggle'
import { DogfoodBadge } from '../dogfood/Dogfood'
import { BarButtons, BarChips } from './AppBarItems'
import { Pop } from '../shell/nui/Pop'
import { usePop } from '../shell/nui/popKit'
import { ToolIcon } from '../shell/nui/icons'
import { gateOf } from '../shell/appBar'
import './chrome.css'

export type { Account, ClientChip, Crew, DocBar, DocState, MenuItem, ToolBrand } from './barMenus'

interface Props {
  /** The signed-in agency's name, on the pill. */
  agency: string
  /** Kept for callers; the pill opens the account menu now (mock phase 33). */
  onAgency?: () => void
  /** The medallion: back to the studio. */
  onHome: () => void
  /** The medallion's colours: the agency's base and accent (shell/agency/palette.ts), else Napkin's. */
  mark?: { base: string; accent: string }
  /** "Open…" (a .clan from this computer), in the account menu where a caller has no desk menu of its own. */
  onOpenFile?: () => void
  /**
   * The medallion's state: the app the person is IN needs them (the open
   * document has something blocking its lock). Never shown on the desk, and
   * never from another client's work: that is the Decisions count's job.
   */
  attention?: boolean
  /** The client chip after the pill: in a document, back to its client; on the client page, the switcher. */
  client?: ClientChip | null
  /** The needs-your-call count beside Decisions. Desk: across all clients; document: needsOf(view) less what was set aside. */
  needs: number
  /** Decisions: the drawer in a document; on the desk, the calls across clients. */
  onDecisions?: () => void
  decisionsOpen?: boolean
  /** Extra tools at the end of the bar (the desk's, when a caller has any). */
  tools?: ReactNode
  /** Who is signed in, and the way out; absent where there are no accounts. */
  user?: string | null
  onSignOut?: () => void
  /** The account menu on the pill. */
  account?: Account
  /** The open document; absent on the desk. */
  doc?: DocBar
  /** A tool's home for the client (no document): named in the app slot, as the mock's "Briefs". */
  place?: BarPlace | null
}

type PopKey = 'account' | 'client' | 'doc' | 'cont' | 'share'

/** A popover's rows: a button per item, with its hint; a rule above `apart`; disabled ones say why. */
function Rows({ items, close }: { items: MenuItem[]; close: (refocus: boolean) => void }) {
  return <>{items.map(item => (
    <Fragment key={item.label}>
      {item.apart && <hr />}
      <button
        type="button"
        role="menuitem"
        aria-disabled={item.disabled || undefined}
        data-dogfood={`menu: ${item.label}`}
        onClick={() => { if (item.disabled) return; close(true); item.run() }}
      >
        {item.label}
        {item.hint && <small>{item.hint}</small>}
      </button>
    </Fragment>
  ))}</>
}

/** The tba-menu's rows (Continue in, Share): an icon disc, then the name and what it does. */
function TbaRows({ items, close, icon }: { items: MenuItem[]; close: (refocus: boolean) => void; icon?: (i: MenuItem) => ReactNode }) {
  return <>{items.map(item => (
    <button
      key={item.label}
      type="button"
      role="menuitem"
      className={icon ? undefined : 'p36-mi'}
      aria-disabled={item.disabled || undefined}
      data-dogfood={`menu: ${item.label}`}
      onClick={() => { if (item.disabled) return; close(true); item.run() }}
    >
      {icon ? <><span className="tba-mi">{icon(item)}</span><span><b>{item.label}</b>{item.hint && <small>{item.hint}</small>}</span></>
        : <><b>{item.label}</b>{item.hint && <small>{item.hint}</small>}</>}
    </button>
  ))}</>
}

/** The medallion: the mock's satin mark in a raised circle; it warms and rings when the app you are in needs you. */
function Medallion({ onHome, attention, mark }: { onHome: () => void; attention?: boolean; mark: { base: string; accent: string } }) {
  return (
    <button
      type="button"
      className="m1-medallion"
      id="header-medallion"
      data-attention={attention || undefined}
      data-testid="medallion"
      onClick={onHome}
      title={attention ? 'Back to the studio. This document needs you.' : 'Back to the studio'}
      aria-label={attention ? 'Back to the studio (this document needs you)' : 'Back to the studio'}
    >
      <MedallionMark base={mark.base} accent={mark.accent} state={attention ? 'needs' : 'awake'} size={54} />
    </button>
  )
}

/** Beside the document's name: what it was made from, what was made from it, and what is linked to it. */
function Lineage({ doc }: { doc: DocBar }) {
  const from = doc.madeFrom
  const open = (path?: string) => (path && doc.onOpenDocument ? () => doc.onOpenDocument!(path) : undefined)
  const chips: ReactNode[] = []
  if (from) {
    const go = open(from.path)
    chips.push(
      <button key="from" type="button" className="tba-line" onClick={go} disabled={!go} data-testid="lineage-from"
        title={from.changed ? `Made from ${from.title}, which has changed since` : `Made from ${from.title}`}>
        from <b>{from.title}</b>{from.changed && <i className="ch-line-dot" aria-label="changed since" />}
      </button>,
    )
  }
  if (doc.madeInto && doc.madeInto.count > 0) {
    const n = doc.madeInto.count, noun = doc.madeInto.noun ?? 'document'
    const go = open(doc.madeInto.path)
    chips.push(
      <button key="into" type="button" className="tba-line" onClick={go} disabled={!go} data-testid="lineage-into"
        title={`${n} ${n === 1 ? noun : noun + 's'} made from this`}>
        → <b>{n} {n === 1 ? noun : `${noun}s`}</b>
      </button>,
    )
  }
  for (const l of doc.linked ?? []) {
    const go = open(l.path)
    const said = l.dir === 'in'
      ? `Linked: ${l.title}${l.taken ? `, v${l.taken} kept here` : ''}${l.changed ? ', which has changed since' : ''}`
      : `Linked into ${l.title}`
    chips.push(
      <button key={`l:${l.dir}:${l.documentId}`} type="button" className="tba-line tba-line-link" onClick={go} disabled={!go} title={said}
        data-testid={l.dir === 'in' ? 'lineage-linked' : 'lineage-linked-in'}>
        ↔ {l.dir === 'out' && 'in '}<b>{l.title}</b>{l.dir === 'in' && l.taken ? <small className="ch-line-v"> v{l.taken}</small> : null}
        {l.changed && <i className="ch-line-dot" aria-label="changed since" />}
      </button>,
    )
  }
  return chips.length ? <>{chips}</> : null
}

/** Colours for a person's avatar, from their name: the mock's crew reds and greens. */
const CREW_COLOURS = ['#C9462A', '#2F6B3A', '#1E3A8A', '#7A1E1E', '#5B2A86']
const crewColour = (name: string) => CREW_COLOURS[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % CREW_COLOURS.length]

/** Who is in the document: the people, then an agent orb with a spinning ring only while one works. */
function CrewHere({ crew }: { crew: Crew }) {
  const names = crew.people.map(p => (p.you ? `${p.name} (you)` : p.name))
  const said = `In this document: ${names.join(', ') || 'nobody yet'}${crew.working ? `; an agent is ${crew.working}` : ''}`
  return (
    <span className="tb-crew" id="tb-crew" role="group" aria-label={said} title={said} data-testid="crew">
      {crew.people.map(p => <i key={p.name} className="cw" style={{ ['--c' as string]: p.you ? '#C9462A' : crewColour(p.name) }} aria-hidden>{p.initials}</i>)}
      {crew.working && <i className="cw ag" data-testid="agent-working" aria-hidden />}
    </span>
  )
}

/** Decisions, with the needs-your-call count. */
function DecisionsButton({ needs, onDecisions, open, waiting }: { needs: number; onDecisions?: () => void; open?: boolean; waiting?: boolean }) {
  // A question the crew stopped on is answered in the document; it counts as one call here (gaps.md X8).
  const count = needs + (waiting ? 1 : 0)
  const asked = waiting ? 'the crew is waiting on your answer in the document' : ''
  const said = needs ? `${needs} need${needs === 1 ? 's' : ''} your call${asked ? `, and ${asked}` : ''}` : asked || 'nothing needs your call'
  return (
    <button
      type="button"
      id="tb-decisions-btn"
      className={count ? 'tb-decisions-btn has-needs' : 'tb-decisions-btn'}
      onClick={onDecisions}
      disabled={!onDecisions}
      aria-expanded={open}
      aria-label={`Decisions: ${said}`}
      title={said}
      data-testid="decisions"
    >
      <span>Decisions</span>
      <span className="cnt" id="tb-decisions-cnt" data-testid="needs-count">{count}</span>
    </button>
  )
}

/** The doc's name: its tool's icon, the name in serif, "saved · valid ✓" under it, the menu on it; double-click renames. */
function DocName({ doc, onMenu, open, renaming, setRenaming }: {
  doc: DocBar; onMenu: (el: HTMLElement) => void; open: boolean; renaming: boolean; setRenaming: (on: boolean) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const title = doc.loading ? null : (doc.title ?? 'No file open')
  const finish = (ok: boolean) => {
    const v = input.current?.value.trim() ?? ''
    setRenaming(false)
    if (ok && v && v !== title) doc.onRename?.(v)
  }
  const invalid = !!doc.validation && doc.validation !== 'OK'
  const check = invalid ? 'not valid' : doc.trusted ? 'signed ✓' : 'valid ✓'
  return (
    <span
      className={`tba-name tba-${doc.toolKey ?? 'brief'}`}
      role="button"
      tabIndex={0}
      aria-haspopup="menu"
      aria-expanded={open}
      title="Document menu · double-click to rename"
      data-testid="doc-name"
      onClick={e => { if (!renaming && !(e.target as HTMLElement).closest('input')) onMenu(e.currentTarget) }}
      onKeyDown={e => { if (!renaming && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) { e.preventDefault(); onMenu(e.currentTarget) } }}
      onDoubleClick={() => { if (doc.onRename) setRenaming(true) }}
    >
      <ToolIcon tool={doc.toolKey} />
      <span className="tba-n2">
        {renaming ? (
          <input
            ref={input}
            className="tba-rename"
            defaultValue={title ?? ''}
            aria-label="New name"
            autoFocus
            onClick={e => e.stopPropagation()}
            onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false) }}
            onBlur={() => finish(true)}
          />
        ) : <b title={title ?? undefined}>{title ?? <LogoSpinner size="xs" label="Loading…" />}</b>}
        <small className="tba-saved" data-testid="saved-line">{doc.saved ? <>{doc.saved} · {check}</> : check}</small>
      </span>
      <i className="tba-caret" aria-hidden>▾</i>
    </span>
  )
}

export default function Toolbar({
  agency, onHome, mark = markOf(null), onOpenFile, attention, client, needs, onDecisions, decisionsOpen, tools, user, onSignOut, account, doc, place,
}: Props) {
  const pop = usePop<PopKey>()
  const appRef = useRef<HTMLDivElement>(null)
  // Renaming the document in place: the name's double-click, or Rename in its menu.
  const [renaming, setRenaming] = useState(false)
  // The tba-menu sits 40px under the app slot, at the button's own left (the mock's .tba-menu).
  const underSlot = useCallback((r: DOMRect) => {
    const slot = appRef.current?.getBoundingClientRect()
    return { top: (slot?.top ?? r.top) + 40, left: r.left }
  }, [])

  const acct = accountItems(account, user, onSignOut, onOpenFile)
  const lead = (
    <>
      <div className="dock-connected">
        <Medallion onHome={onHome} attention={!!doc && attention} mark={mark} />
        <button
          type="button"
          className="name-pill pill-accent"
          id="header-name-pill"
          title="Your account and studio"
          aria-label={`${agency}, Napkin Studio: your account and studio`}
          aria-haspopup="menu"
          aria-expanded={pop.open?.key === 'account'}
          data-testid="agency-pill"
          onClick={e => pop.toggle('account', e.currentTarget)}
        >
          <span className="stacked-lockup" id="header-lockup">
            <span className="sl-big">{agency}</span>
            <span className="sl-mono"><i className="ag-dot" aria-hidden />Napkin Studio</span>
          </span>
        </button>
      </div>
      <span className="tb-vsep" aria-hidden />
      <nav className="tb-trail" id="tb-trail" aria-label="Where you are">
        {client && (
          <button
            type="button"
            className="tb-client"
            id={client.switcher ? 'p33-cswitch' : undefined}
            title={client.switcher ? 'Switch client' : `Back to ${client.name}`}
            aria-label={client.switcher ? `Switch client: ${client.name}` : client.name}
            aria-current={client.current ? 'page' : undefined}
            aria-haspopup={client.switcher ? 'menu' : undefined}
            aria-expanded={client.switcher ? pop.open?.key === 'client' : undefined}
            data-testid="client-chip"
            onClick={e => { if (client.switcher) pop.toggle('client', e.currentTarget); else client.onOpen?.() }}
          >
            <span className="tb-cdot" style={{ background: client.look.cl, color: client.look.ink }}>{client.mono}</span>
            <span className="tb-cname">{client.name}</span>
            {client.switcher && <span style={{ color: 'var(--muted)', fontSize: 10, marginLeft: 2 }} aria-hidden>▾</span>}
          </button>
        )}
      </nav>
    </>
  )

  const popovers = (
    <>
      {pop.open?.key === 'account' && (
        <Pop anchor={pop.open.anchor} onClose={pop.close} label="Your account" testid="account-menu">
          {account && (
            <div className="pp-me">
              <span className="pp-av" aria-hidden>{account.initials}</span>
              <span><b>{account.name}</b><small>{account.line}</small></span>
            </div>
          )}
          {account && <hr />}
          <Rows items={acct} close={pop.close} />
          {account?.flat && (
            <button type="button" className="pp-opt" aria-pressed={account.flat.on} data-testid="flat-circles" onClick={account.flat.toggle}>
              <span className="pp-box" aria-hidden>{account.flat.on ? '✓' : ''}</span>Flat circles
            </button>
          )}
        </Pop>
      )}
      {pop.open?.key === 'client' && client?.switcher && (
        <Pop anchor={pop.open.anchor} onClose={pop.close} label="Switch client" testid="client-switcher">
          <div className="pp-h">Switch client</div>
          {client.switcher.map(c => (
            <button key={c.id} type="button" role="menuitem" onClick={() => { pop.close(false); client.onSwitch?.(c.id) }}>
              {c.name}{c.sub && <small>{c.sub}</small>}
            </button>
          ))}
        </Pop>
      )}
    </>
  )

  const right = (
    <>
      <DogfoodBadge variant="nui" />
      <ThemeToggle variant="nui" />
    </>
  )

  // ── the desk and the client page: no document ─────────────────────────────
  if (!doc) {
    return (
      <div className="nui ch-bar-os" data-testid="os-bar" data-where="desk">
        <div className="topbar-outer">
          <header className="tb-locked" aria-label="Napkin Studio Top Bar">
            {lead}
            <div className="tb-app" id="tb-app" aria-label="App">
              {place && (
                <span className={`tba-name tba-static tba-${place.tool}`} data-testid="bar-place">
                  <ToolIcon tool={place.tool} /><span className="tba-n2"><b>{place.label}</b></span>
                </span>
              )}
            </div>
            <span className="tb-spacer" />
            {tools}
            {right}
            <DecisionsButton needs={needs} onDecisions={onDecisions} open={decisionsOpen} />
          </header>
        </div>
        {popovers}
      </div>
    )
  }

  const invalid = !!doc.validation && doc.validation !== 'OK'

  // ── client review: the bar is the mode's ──────────────────────────────────
  if (doc.clientMode) {
    return (
      <div className="nui ch-bar-os ch-bar-mode" role="region" aria-label="Client review" data-testid="os-bar" data-where="client-review">
        <div className="topbar-outer">
          <header className="tb-locked" aria-label="Napkin Studio Top Bar">
            {lead}
            <div className="tb-app" id="tb-app" aria-label="App">
              <span className={`tba-name tba-static tba-${doc.toolKey ?? 'brief'}`}>
                <ToolIcon tool={doc.toolKey} />
                <span className="tba-n2"><b title={doc.title ?? undefined}>{doc.title ?? 'No file open'}</b></span>
              </span>
              <span className="ch-modetag"><span className="ch-modetag-dot" aria-hidden />Client review</span>
            </div>
            <span className="tb-spacer" />
            <button type="button" className="tba-btn tba-cont" onClick={doc.clientMode.onCancel} disabled={doc.clientMode.busy}
              title="Leave client review. Nothing you have not saved is kept.">
              Cancel
            </button>
            <ThemeToggle variant="nui" />
          </header>
        </div>
        {popovers}
      </div>
    )
  }

  const cont = continueItems(doc)
  const fresh = cont.fresh
  // The research's gate line ("Not brief-ready yet: …"), first in Continue in, when the app sends one.
  const gate = gateOf(doc.bar ?? [])?.label ?? null
  const contIcon = (i: MenuItem) => {
    if (i.label.startsWith('↔')) return '↔'
    if (i.label.startsWith('New ')) return '+'
    if (i.label.startsWith('Update ') || i.label.startsWith('Unlink ')) return '↻'
    const l = i.label.toLowerCase()
    return <ToolIcon tool={/research/.test(l) ? 'research' : /deck/.test(l) ? 'deck' : /brief/.test(l) ? 'brief' : 'production'} />
  }
  return (
    <div className="nui ch-bar-os" data-testid="os-bar" data-where="document">
      <div className="topbar-outer">
        <header className="tb-locked" aria-label="Napkin Studio Top Bar">
          {lead}
          <div className="tb-app" id="tb-app" aria-label="App" ref={appRef}>
            <DocName doc={doc} open={pop.open?.key === 'doc'} onMenu={el => pop.toggle('doc', el)} renaming={renaming} setRenaming={setRenaming} />
            <Lineage doc={doc} />
            <span className="tba-acts">
              <button type="button" className="tba-btn tba-cont" data-tba="b-cont" aria-haspopup="menu" aria-expanded={pop.open?.key === 'cont'}
                onClick={e => pop.toggle('cont', e.currentTarget)}>Continue in ▾</button>
              <button type="button" className="tba-btn tba-share" data-p36-share aria-haspopup="menu" aria-expanded={pop.open?.key === 'share'}
                onClick={e => pop.toggle('share', e.currentTarget)}>Share</button>
            </span>
          </div>
          <span className="tb-spacer" />
          <span className="tb-tools">
            {doc.isTemplate && <span className="ch-chip ch-chip-accent">Template</span>}
            {doc.trusted && (
              <span className="ch-chip ch-chip-ok" title="Signed by Napkin — scoped host capabilities enabled">Trusted</span>
            )}
            {invalid && (
              <span className="ch-chip ch-chip-warn" title={doc.validation}>
                <span className="ch-chip-dot" />Something’s wrong with this file
              </span>
            )}
            <BarChips bar={doc.bar ?? []} />
            <BarButtons bar={doc.bar ?? []} onAction={doc.onBarAction} />
            {doc.onClientReview && !doc.editMode && (
              <button
                type="button"
                className={doc.clientAnswered ? 'tba-btn tba-cont' : 'tba-btn tba-cont tba-primary'}
                onClick={doc.onClientReview}
                title={doc.clientAnswered ? 'Record another answer from the client about the locked version' : 'Record what the client said about the locked version'}
              >
                {doc.clientAnswered ? 'New client answer' : 'Client review'}
              </button>
            )}
            {doc.onToggleEdit && doc.editMode && (
              <button type="button" className="tba-btn tba-cont tba-primary" onClick={doc.onToggleEdit} aria-pressed title="Stop editing">
                Done editing
              </button>
            )}
          </span>
          {right}
          {doc.crew && <CrewHere crew={doc.crew} />}
          <DecisionsButton needs={needs} onDecisions={onDecisions} open={decisionsOpen} waiting={!!doc.crew?.waiting} />
        </header>
      </div>
      {popovers}
      {pop.open?.key === 'doc' && (
        <Pop anchor={pop.open.anchor} onClose={pop.close} label="Document" testid="doc-menu">
          <div className="pp-h">{doc.title ?? 'This document'}</div>
          <Rows items={docMenuItems(doc, () => setRenaming(true))} close={pop.close} />
        </Pop>
      )}
      {pop.open?.key === 'cont' && (
        <Pop anchor={pop.open.anchor} onClose={pop.close} label="Continue in" className="tba-menu" at={underSlot} testid="continue-menu">
          {gate && <p className="tba-gate" data-testid="continue-gate">{gate}</p>}
          <div className="tba-mh">Turn it into</div>
          {cont.spin.length ? <TbaRows items={cont.spin} close={pop.close} icon={contIcon} /> : <p className="tba-empty">No app here takes this as a source yet.</p>}
          <div className="tba-mh">Link to an existing one</div>
          {cont.link.length ? <TbaRows items={cont.link} close={pop.close} icon={contIcon} /> : <p className="tba-empty">Nothing in this workspace to link this to yet.</p>}
          {doc.madeFrom && <>
            <div className="tba-mh">Made from</div>
            {cont.update.length ? <TbaRows items={cont.update} close={pop.close} icon={contIcon} />
              : <p className="tba-empty">{doc.madeFrom.changed
                ? `${doc.madeFrom.title} changed. A locked version keeps what it was made from.`
                : `Up to date with ${doc.madeFrom.title}.`}</p>}
          </>}
          {fresh.length > 0 && <>
            <div className="tba-mh">Start fresh</div>
            <TbaRows items={fresh} close={pop.close} icon={contIcon} />
          </>}
        </Pop>
      )}
      {pop.open?.key === 'share' && (
        <Pop anchor={pop.open.anchor} onClose={pop.close} label="Share" className="tba-menu" at={underSlot} testid="share-menu">
          <div className="pp-h">Share</div>
          <TbaRows items={shareItems(doc)} close={pop.close} />
        </Pop>
      )}
    </div>
  )
}
