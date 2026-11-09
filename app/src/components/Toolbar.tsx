// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The one OS bar (features/new-ui-shell.clan): the same bar on the desk and in
// a document, in three groups spread across its width (owner, 9 Nov 2026).
// Left, who and where: the medallion (the way home, and the one mark that
// changes when the app you are IN needs you), the agency's pill in the
// agency's colours, and where you are (Clients › client › tool). Centre, the
// document: the OS app slot (the tool, the document's name, what it was made
// from and what was made from it, its state, Continue in ▾, Share ▾ and
// More ▾). Right, the tools: the app's own chips and buttons, Saved, the beta
// badge, the theme, the crew in the document, and Decisions, the bar's one
// needs-your-call signal (amber with the count).
//
// Pure: everything it shows comes in as props (the spin-off targets, who is
// signed in, the Saved status), so a test can draw every state with no host.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { LogoSpinner } from '../brand/LogoSpinner'
import { continueItems, deskItems, moreItems, shareItems, type Crew, type DocBar, type DocState, type MenuItem, type ToolBrand } from './barMenus'
import { MedallionMark } from './Medallion'
import { markOf } from '../shell/agency/palette'
import ThemeToggle from './ThemeToggle'
import { DogfoodBadge } from '../dogfood/Dogfood'
import { BarButtons, BarChips } from './AppBarItems'
import { gateOf } from '../shell/appBar'
import './chrome.css'

export type { Crew, DocBar, DocState, MenuItem, ToolBrand } from './barMenus'

interface Props {
  /** The signed-in agency's name, on the pill. */
  agency: string
  /** The pill: the agency's own page. */
  onAgency: () => void
  /** The medallion: back to the studio. */
  onHome: () => void
  /** The medallion's colours: the agency's base and accent (shell/agency/palette.ts), else Napkin's. */
  mark?: { base: string; accent: string }
  /** The desk's More ▾ "Open…": a .clan from this computer. */
  onOpenFile?: () => void
  /**
   * The medallion's state: the app the person is IN needs them (the open
   * document has something blocking its lock). Never shown on the desk, and
   * never from another client's work: that is the Decisions count's job.
   */
  attention?: boolean
  /** Where you are below the agency: Clients › client › tool (Trail without its agency level). */
  crumbs?: ReactNode
  /** The needs-your-call count beside Decisions. Desk: across all clients; document: needsOf(view) less what was set aside. */
  needs: number
  /** Decisions: the drawer in a document; on the desk, the drawer of every document across clients that needs a call. */
  onDecisions?: () => void
  decisionsOpen?: boolean
  /** Desk-only tools at the end (Offline). */
  tools?: ReactNode
  /** Who is signed in, and the way out; absent where there are no accounts. */
  user?: string | null
  onSignOut?: () => void
  /** The open document; absent on the desk. */
  doc?: DocBar
}

/** The menu's items, in order, and focus on the i-th (wrapping round). */
const entries = (menu: HTMLElement | null) =>
  Array.from(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
function focusAt(menu: HTMLElement | null, i: number) {
  const els = entries(menu)
  if (els.length) els[(i + els.length) % els.length].focus()
}

interface Group { label?: string; items: MenuItem[]; empty?: string }

/**
 * A menu button in the bar: arrows move through it, Home and End jump, Escape
 * or Tab or a click anywhere else closes it. Clicks inside the app frame never
 * reach this page, so leaving the window (a click into the frame) closes it too.
 */
function BarMenu({ id, label, groups, className }: { id: string; label: string; groups: Group[]; className?: string }) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  // Which item takes focus when the menu opens: the first, or the last (ArrowUp).
  const startAt = useRef(0)

  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) button.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    focusAt(menu.current, startAt.current < 0 ? entries(menu.current).length - 1 : startAt.current)
    const outside = (e: PointerEvent) => {
      if (!anchor.current?.contains(e.target as Node)) setOpen(false)
    }
    const left = () => setOpen(false)
    document.addEventListener('pointerdown', outside)
    window.addEventListener('blur', left)
    return () => {
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('blur', left)
    }
  }, [open])

  const openAt = (i: number) => { startAt.current = i; setOpen(true) }

  const onButtonKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); openAt(0) }
    if (e.key === 'ArrowUp') { e.preventDefault(); openAt(-1) }
  }

  const onMenuKey = (e: React.KeyboardEvent) => {
    const els = entries(menu.current)
    const i = els.indexOf(document.activeElement as HTMLButtonElement)
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); focusAt(menu.current, i + 1); break
      case 'ArrowUp': e.preventDefault(); focusAt(menu.current, i - 1); break
      case 'Home': e.preventDefault(); focusAt(menu.current, 0); break
      case 'End': e.preventDefault(); focusAt(menu.current, els.length - 1); break
      case 'Escape': e.preventDefault(); close(true); break
      case 'Tab': close(false); break
    }
  }

  return (
    <div className="ch-menu-anchor" ref={anchor}>
      <button
        ref={button}
        className={className ?? 'ch-btn'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => (open ? close(false) : openAt(0))}
        onKeyDown={onButtonKey}
      >
        {label} <span aria-hidden>▾</span>
      </button>
      {open && (
        <div className="ch-menu" role="menu" id={id} aria-label={label} ref={menu} onKeyDown={onMenuKey}>
          {groups.map((g, gi) => (
            <div key={g.label ?? gi} role="none" className={gi > 0 ? 'ch-menu-apart' : undefined}>
              {g.label && <div className="ch-menu-group" role="presentation">{g.label}</div>}
              {g.items.length === 0 && g.empty && <div className="ch-menu-empty" role="presentation">{g.empty}</div>}
              {g.items.map(item => (
                <div key={item.label} role="none" className={item.apart ? 'ch-menu-apart' : undefined}>
                  <button
                    className="ch-menu-item"
                    role="menuitem"
                    aria-disabled={item.disabled || undefined}
                    data-dogfood={`menu: ${item.label}`}
                    tabIndex={-1}
                    // Shown so it can be found and its hint read; it does nothing yet.
                    onClick={() => { if (item.disabled) return; close(true); item.run() }}
                  >
                    {item.label}
                    {item.hint && <small>{item.hint}</small>}
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** The medallion: the mock's satin mark in a raised circle; it warms and rings when the app you are in needs you. */
function Medallion({ onHome, attention, mark }: { onHome: () => void; attention?: boolean; mark: { base: string; accent: string } }) {
  return (
    <button
      className="ch-medallion"
      data-attention={attention || undefined}
      data-testid="medallion"
      onClick={onHome}
      title={attention ? 'Back to the studio. This document needs you.' : 'Back to the studio'}
      aria-label={attention ? 'Back to the studio (this document needs you)' : 'Back to the studio'}
    >
      <MedallionMark base={mark.base} accent={mark.accent} state={attention ? 'needs' : 'awake'} />
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
      <button key="from" type="button" className="ch-line" onClick={go} disabled={!go} data-testid="lineage-from"
        title={from.changed ? `Made from ${from.title}, which has changed since` : `Made from ${from.title}`}>
        from <b>{from.title}</b>{from.changed && <i className="ch-line-dot" aria-label="changed since" />}
      </button>,
    )
  }
  if (doc.madeInto && doc.madeInto.count > 0) {
    const n = doc.madeInto.count, noun = doc.madeInto.noun ?? 'document'
    const go = open(doc.madeInto.path)
    chips.push(
      <button key="into" type="button" className="ch-line" onClick={go} disabled={!go} data-testid="lineage-into"
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
      <button key={`l:${l.dir}:${l.documentId}`} type="button" className="ch-line ch-line-link" onClick={go} disabled={!go} title={said}
        data-testid={l.dir === 'in' ? 'lineage-linked' : 'lineage-linked-in'}>
        ↔ {l.dir === 'out' && 'in '}<b>{l.title}</b>{l.dir === 'in' && l.taken ? <small className="ch-line-v"> v{l.taken}</small> : null}
        {l.changed && <i className="ch-line-dot" aria-label="changed since" />}
      </button>,
    )
  }
  return chips.length ? <span className="ch-lineage">{chips}</span> : null
}

/** Who is in the document: the people, then an agent with a status dot only while one works. */
function CrewHere({ crew }: { crew: Crew }) {
  const names = crew.people.map(p => (p.you ? `${p.name} (you)` : p.name))
  const said = `In this document: ${names.join(', ') || 'nobody yet'}${crew.working ? `; an agent is ${crew.working}` : ''}`
  return (
    <span className="ch-crew" role="group" aria-label={said} title={said} data-testid="crew">
      {crew.people.map(p => <i key={p.name} className="ch-crew-p" aria-hidden>{p.initials}</i>)}
      {crew.working && <i className="ch-crew-agent" data-testid="agent-working" aria-hidden />}
    </span>
  )
}

/** The agency's name on its own colours (--agency, --agency-fg), "Napkin Studio" under it. */
function AgencyPill({ agency, onAgency }: { agency: string; onAgency: () => void }) {
  return (
    <button className="ch-agency" onClick={onAgency} title={`${agency}: its clients and what needs you`} data-testid="agency-pill">
      <span className="ch-agency-name">{agency}</span>
      <span className="ch-agency-os"><i aria-hidden />Napkin Studio</span>
    </button>
  )
}

/** The document's state, in words, with a dot; the tone is never the only signal. */
function StatePill({ state }: { state: DocState }) {
  return (
    <span className={`ch-state${state.tone ? ` ch-state-${state.tone}` : ''}`} data-testid="state-pill">
      <i aria-hidden />{state.label}
    </span>
  )
}

/** The tool's name in its own colour and face. */
function ToolName({ tool }: { tool: ToolBrand }) {
  return (
    <span className="ch-slot-tool" style={{
      ...(tool.colour ? { ['--tool' as string]: tool.colour } : {}),
      ...(tool.font ? { fontFamily: tool.font } : {}),
    }}>{tool.name}</span>
  )
}

/** Decisions, with the needs-your-call count. */
function DecisionsButton({ needs, onDecisions, open, waiting }: { needs: number; onDecisions?: () => void; open?: boolean; waiting?: boolean }) {
  // A question the crew stopped on is answered in the document, not here, so
  // it is not counted; but the bar must not say nothing needs you.
  const asked = waiting ? 'the crew is waiting on your answer in the document' : ''
  const said = needs ? `${needs} need${needs === 1 ? 's' : ''} your call${asked ? `, and ${asked}` : ''}` : asked || 'nothing needs your call'
  return (
    <button
      className={needs || waiting ? 'ch-decisions ch-decisions-needs' : 'ch-decisions'}
      onClick={onDecisions}
      disabled={!onDecisions}
      aria-expanded={open}
      aria-label={`Decisions: ${said}`}
      title={said}
      data-testid="decisions"
    >
      <span>Decisions</span>
      <span className={`ch-decisions-n${needs ? '' : ' ch-decisions-n-zero'}`} data-testid="needs-count">{needs}</span>
    </button>
  )
}

export default function Toolbar({
  agency, onAgency, onHome, mark = markOf(null), onOpenFile, attention, crumbs, needs, onDecisions, decisionsOpen, tools, user, onSignOut, doc,
}: Props) {
  const lead = (
    <span className="ch-bar-l">
      <span className="ch-dock">
        <Medallion onHome={onHome} attention={!!doc && attention} mark={mark} />
        <AgencyPill agency={agency} onAgency={onAgency} />
      </span>
      {crumbs && <span className="ch-crumbs">{crumbs}</span>}
    </span>
  )

  // ── the desk: no document ─────────────────────────────────────────────────
  if (!doc) {
    const desk = deskItems(user, onSignOut, onOpenFile)
    return (
      <div className="ch-bar ch-bar-os" data-testid="os-bar" data-where="desk">
        {lead}
        <span className="ch-bar-r">
          {tools}
          {desk.length > 0 && <BarMenu id="ch-desk-menu" label="More" groups={[{ items: desk }]} />}
          <DogfoodBadge />
          <ThemeToggle />
          <DecisionsButton needs={needs} onDecisions={onDecisions} open={decisionsOpen} />
        </span>
      </div>
    )
  }

  const invalid = !!doc.validation && doc.validation !== 'OK'
  const title = doc.loading ? <LogoSpinner size="xs" label="Loading…" /> : (doc.title ?? 'No file open')

  // ── client review: the bar is the mode's ──────────────────────────────────
  if (doc.clientMode) {
    return (
      <div className="ch-bar ch-bar-os ch-bar-mode" role="region" aria-label="Client review" data-testid="os-bar" data-where="client-review">
        {lead}
        <span className="ch-bar-c">
          <span className="ch-slot">
            {doc.tool && <ToolName tool={doc.tool} />}
            <span className="ch-slot-title" title={doc.loading ? undefined : doc.title ?? undefined}>{title}</span>
          </span>
          <span className="ch-modetag"><span className="ch-modetag-dot" aria-hidden />Client review</span>
        </span>
        <span className="ch-bar-r">
          <button className="ch-btn" onClick={doc.clientMode.onCancel} disabled={doc.clientMode.busy} title="Leave client review. Nothing you have not saved is kept.">
            Cancel
          </button>
          <ThemeToggle />
        </span>
      </div>
    )
  }

  const cont = continueItems(doc)
  return (
    <div className="ch-bar ch-bar-os" data-testid="os-bar" data-where="document">
      {lead}
      <span className="ch-bar-c">
        <span className="ch-slot" role="group" aria-label="App">
          {doc.tool && <ToolName tool={doc.tool} />}
          <span className="ch-slot-title" title={doc.loading ? undefined : doc.title ?? undefined}>{title}</span>
          <Lineage doc={doc} />
          {doc.state && <StatePill state={doc.state} />}
          <BarMenu
            id="ch-continue-menu"
            label="Continue in"
            className="ch-btn ch-btn-slot"
            groups={[
              ...(gateOf(doc.bar ?? []) ? [{ items: [], empty: gateOf(doc.bar ?? [])!.label }] : []),
              { label: 'Turn it into', items: cont.spin, empty: 'No app here takes this as a source yet.' },
              { label: 'Link to an existing one', items: cont.link, empty: 'Nothing in this workspace to link this to yet.' },
              ...(doc.madeFrom
                ? [{
                    label: 'Made from',
                    items: cont.update,
                    empty: doc.madeFrom.changed
                      ? `${doc.madeFrom.title} changed. A locked version keeps what it was made from.`
                      : `Up to date with ${doc.madeFrom.title}.`,
                  }]
                : []),
              ...(cont.fresh.length ? [{ label: 'Start fresh', items: cont.fresh }] : []),
            ]}
          />
          <BarMenu id="ch-share-menu" label="Share" className="ch-btn ch-btn-slot" groups={[{ items: shareItems(doc) }]} />
          <BarMenu id="ch-more-menu" label="More" className="ch-btn ch-btn-slot" groups={[{ items: moreItems(doc, user, onSignOut) }]} />
        </span>
      </span>
      <span className="ch-bar-r">
        {doc.isTemplate && <span className="ch-chip ch-chip-accent">Template</span>}
        {doc.trusted && (
          <span className="ch-chip ch-chip-ok" title="Signed by Napkin — scoped host capabilities enabled">
            Trusted
          </span>
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
            className={doc.clientAnswered ? 'ch-btn ch-btn-big' : 'ch-btn ch-btn-primary ch-btn-big'}
            onClick={doc.onClientReview}
            title={doc.clientAnswered ? 'Record another answer from the client about the locked version' : 'Record what the client said about the locked version'}
          >
            {doc.clientAnswered ? 'New client answer' : 'Client review'}
          </button>
        )}
        {doc.onToggleEdit && doc.editMode && (
          <button className="ch-btn ch-btn-editing" onClick={doc.onToggleEdit} aria-pressed title="Stop editing">
            Done editing
          </button>
        )}
        {doc.saved}
        <DogfoodBadge />
        <ThemeToggle />
        {doc.crew && <CrewHere crew={doc.crew} />}
        <DecisionsButton needs={needs} onDecisions={onDecisions} open={decisionsOpen} waiting={!!doc.crew?.waiting} />
      </span>
    </div>
  )
}
