// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Toolbar, { type Account, type ClientChip, type Crew, type ToolBrand } from '../components/Toolbar'
import SaveStatus from '../components/SaveStatus'
import { useLinks, useMadeFrom, useSpinoffTargets, useWakeTick } from '../components/ContinueIn'
import { linksOf } from '../components/barMenus'
import Sidebar from '../components/Sidebar'
import AppRuntime from './AppRuntime'
import { DecisionsDrawer, type DrawerView } from './nui/DecisionsDrawer'
import { openInApp, setBeforeOpen } from './appExport'
import { refOfAddress } from './decisions/words'
import { lockWords } from './nui/drawerData'
import { setScreen } from '../dogfood/recorder'
import { docStateOf, needsOf, useDecisions } from './decisions/useDecisions'
import { splitAside } from './decisions/needs'
import { useSetAside } from './decisions/useSetAside'
import ClientReviewPanel from './clientReview/ClientReviewPanel'
import ClientReviewBand from './clientReview/ClientReviewBand'
import { assetNameOf, bodyOf, canReview, emptyDraft, knownClients, markedOf, nounOf, problemOf } from './clientReview/review'
import type { Draft, Mark } from './clientReview/review'
import { barAction, refreshApp } from './appExport'
import { modeOf, statusOf, type BarItem } from './appBar'
import { host } from '../host'
import type { ClientPartRef, ClientWho, InstalledApp, LibraryItem, RunInfo } from '../host'
import { useEngaged } from '../components/markStore'
import type { AgencyLogo } from './agency/palette'
import { isProductApp, markTarget, pageRunOf } from '../components/medallionMotion'
import { listedTitle, othersStamp, listedUpdated } from './docFreshness'
import { PoweredByClan } from '../brand/PoweredByClan'
import type { RunningApp } from './types'
import { docTitle } from './docTitle'
import '../components/chrome.css'
import './clientReview/ClientReview.css'
import { afterLock, editOn, setEditFor, type EditState } from './editMode'

interface Props {
  /** The installed tool this document belongs to, when it is one (its app.home names it). */
  tool?: InstalledApp | null
  running: RunningApp
  onHome: () => void
  onOpenFile: () => void
  onSave: () => void
  onKeepOffline?: () => void
  /** Shown under the toolbar — what a document open on the device says about itself. */
  banner?: ReactNode
  onExport: (kind: 'html' | 'pdf') => void
  onSpinoff: (appId: string) => void
  /** The document's client, after the agency's pill: the way back to its page; absent for a document with no client. */
  client?: ClientChip | null
  /** The account menu on the pill. */
  account?: Account
  /** The tool's key, for its icon and face in the bar. */
  toolKey?: string | null
  /** Continue in › Start fresh: a new document of this app for this client. */
  onStartFresh?: () => void
  /** The document menu's way to its tool's page for its client. */
  onToolPage?: { label: string; run: () => void } | null
  /** The signed-in agency, on the bar's pill, and its page. */
  agency: string
  /** The agency's marks for the pill (palette.ts pillLogoOf). */
  agencyLogo?: AgencyLogo
  onAgency: () => void
  /** Who is signed in, and the way out (the slot's More menu). */
  user?: string | null
  onSignOut?: () => void
  /** Each change is kept as it is made, so the bar may say "Saved" (Toolbar). */
  saved?: boolean
  /** Open another document of the store (the sidebar's "Made from" link, the bar's lineage chips). */
  onOpenDocument?: (path: string) => void
  /** The medallion's colours (the agency's base and accent). */
  mark?: { base: string; accent: string }
  /** Share ▾ "Copy link"; absent where there is no server to open a link from. */
  onCopyLink?: () => void
  /** Who is in the document (the bar's crew). */
  crew?: Crew
  /** The library as the shell last read it: the document's current name, and when others changed. */
  library?: LibraryItem[] | null
  /** The open document's run, as the host tracks it: what the medallion shows while it works. */
  run?: RunInfo | null
}

/** Chrome for one running app: toolbar + (collapsible) sidebar + render surface + panels. */
export default function AppHost({ running, onHome, onOpenFile, onSave, onKeepOffline, banner, onExport, onSpinoff, saved, onOpenDocument, tool, client, account, toolKey, onStartFresh, onToolPage, agency, agencyLogo, onAgency, user, onSignOut, mark, onCopyLink, crew, library, run }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false) // collapsed by default
  const { open } = running
  const docPath = open.path
  // Edit mode is the OS's: the app's fields become editable while it is on.
  // It is kept with the document it was turned on in: another document (a
  // spin-off, a link) opens out of it, and a lock ends it.
  const [edit, setEdit] = useState<EditState>({ docPath, on: running.editMode })
  const editMode = editOn(edit, docPath)
  const setEditMode = useCallback((v: boolean | ((was: boolean) => boolean)) => {
    setEdit(e => setEditFor(e, docPath, v))
  }, [docPath])
  // The host's view of the document, read once: the panel renders it, and
  // the bar and client review read the lock and the client's answers from it.
  const decisions = useDecisions(docPath)
  // The needs-your-call count, from the one selector the drawer lists from,
  // less what this person set aside (it still blocks the lock).
  const aside = useSetAside(docPath)
  const needs = useMemo(() => splitAside(needsOf(decisions.view), aside.keys).open.length, [decisions.view, aside.keys])
  // The medallion (the mock's headerMark): working during this document's run, done once a run
  // ended here with nothing open, needs when it needs you, else awake (or asleep before you engage).
  const runState = run?.state ?? null
  const [runSeen, setRunSeen] = useState({ docPath, last: runState, finished: false })
  if (runSeen.docPath !== docPath || runSeen.last !== runState) {
    const same = runSeen.docPath === docPath
    const ended = same && runSeen.last === 'working' && (runState === null || runState === 'idle' || runState === 'done')
    setRunSeen({ docPath, last: runState, finished: ended || (same && runSeen.finished && runState !== 'working') })
  }
  const engaged = useEngaged()
  // Only a product's document (Brief, Research, Deck, Production) moves the mark; any other app keeps it at rest.
  const product = isProductApp(open.manifest.app?.app_id)
  // The Decisions drawer, opened from the bar. Kept with the document it was opened on.
  const [drawer, setDrawer] = useState<{ docPath: string; open: boolean }>({ docPath, open: false })
  const decisionsOpen = drawer.docPath === docPath && drawer.open
  const setDecisionsOpen = useCallback((o: boolean | ((was: boolean) => boolean)) => {
    setDrawer(d => {
      const was = d.docPath === docPath && d.open
      return { docPath, open: typeof o === 'function' ? o(was) : o }
    })
  }, [docPath])
  // Showing an item in the document (Open, Show in document, a source or fact chip) closes the drawer:
  // the document shows it in its own side panel.
  useEffect(() => { setBeforeOpen(() => setDecisionsOpen(false)); return () => setBeforeOpen(null) }, [setDecisionsOpen])
  // "Approve all and lock": the document's own /approve, refused in the host's words while its lock list holds.
  const approveDoc = useCallback(async () => {
    if (typeof host.docOps !== 'function') throw new Error('Lock it from the document itself here.')
    await (await host.docOps(docPath)).approve('Approved every open call in Decisions')
  }, [docPath])
  // Which view the drawer shows: Graph, By part, By time or Lineage.
  const [drawerView, setDrawerView] = useState<DrawerView>('graph')
  const targets = useSpinoffTargets(docPath)
  const noun = nounOf(open.manifest.app?.app_id)
  // The tool, as its manifest names it (app.home.brand, else its name); a
  // document made before tools named themselves still finds its tool.
  const brand: ToolBrand | null = open.manifest.app ? {
    name: tool?.home?.brand || tool?.name || open.manifest.app.name,
    colour: tool?.home?.colour ?? null,
    font: tool?.home?.brand_font ?? null,
  } : null
  // The name the library has now: the app may have renamed it since it opened.
  const barTitle = open.is_template ? open.manifest.title
    : docTitle(listedTitle(library, docPath) ?? open.manifest.title, open.manifest.app?.app_id, open.manifest.app?.name, tool?.home?.untitled).text
  // Read links and the source again when another document changes, or the page is back in view.
  const wake = useWakeTick()
  const others = othersStamp(library, docPath)
  const stamp = `${wake}:${others}`
  // The tab says it too: "Napkin Studio Research — Bulmers · Ireland".
  const brandName = brand?.name
  // the dogfood build records where people go (a no-op elsewhere)
  const appId = open.manifest.app?.app_id ?? null
  useEffect(() => { setScreen({ screen: 'app', doc: docPath, app: appId }) }, [docPath, appId])
  useEffect(() => {
    document.title = brandName ? `Napkin Studio ${brandName} — ${barTitle}` : `${barTitle} — Napkin Studio`
    return () => { document.title = 'Napkin Studio' }
  }, [brandName, barTitle])
  const fontUrl = tool?.home?.brand_font_url
  useEffect(() => {
    // A tool's own face loads once, from Google Fonts only (the shell's own source).
    if (!fontUrl || !/^https:\/\/fonts\.googleapis\.com\/css2\?/.test(fontUrl)) return
    if (document.querySelector(`link[data-tool-font="${CSS.escape(fontUrl)}"]`)) return
    const l = document.createElement('link')
    l.rel = 'stylesheet'; l.href = fontUrl; l.dataset.toolFont = fontUrl
    document.head.appendChild(l)
  }, [fontUrl])

  // ── client review (OS-layer contract §7.5) ──────────────────────────────
  // The shell's second mode, like edit mode: on only while the document is
  // locked with nothing reopened; the app's fields mark the parts. What was
  // not saved is dropped when it ends. Each piece is kept against the
  // document it was for, so another document never sees it.
  const [review, setReview] = useState<{ docPath: string; draft: Draft; marks: Record<string, Mark>; known: ClientWho[] } | null>(null)
  const [declared, setDeclared] = useState<{ docPath: string; parts: ClientPartRef[] }>({ docPath, parts: [] })
  const [saving, setSaving] = useState<'no' | 'saving'>('no')
  const [saveError, setSaveError] = useState<string | null>(null)
  // What the host's matcher said on the last Save here: why it could not
  // look, or that it looked and no part was named.
  const [matched, setMatched] = useState<{ docPath: string; review: string; reason: string | null; none: boolean } | null>(null)
  // Who answered last, per document, for this session: the next review starts
  // from them, or from the client the document last recorded. Memory only.
  const lastWho = useRef(new Map<string, ClientWho>())

  const clientOn = review?.docPath === docPath
  const parts = useMemo(() => (declared.docPath === docPath ? declared.parts : []), [declared, docPath])
  const reviewable = canReview(decisions.view)
  // Locked (nothing reopened): there is nothing left to edit, so edit mode ends.
  const [lockSeen, setLockSeen] = useState(reviewable)
  if (lockSeen !== reviewable) {
    setLockSeen(reviewable)
    setEdit(e => afterLock(e, docPath, lockSeen, reviewable))
  }

  const startReview = useCallback(() => {
    setEditMode(false)
    setSaveError(null)
    // The clients on record, offered as picks; the one the draft starts from is preselected.
    const known = knownClients(decisions.view, [...lastWho.current.values()])
    const who = lastWho.current.get(docPath) ?? decisions.view?.client?.answer?.client ?? known[0] ?? null
    setReview({ docPath, draft: emptyDraft(who), marks: {}, known })
  }, [docPath, decisions.view, setEditMode])

  const endReview = useCallback(() => {
    setReview(null)
    setSaveError(null)
  }, [])

  const onDraft = useCallback((change: (d: Draft) => Draft) => {
    setReview(r => (r ? { ...r, draft: change(r.draft) } : r))
  }, [])

  // Marks count only while the mode is on; one posted after it ended is dropped.
  const onPartMark = useCallback((m: { address: string; marked: boolean; words: string }) => {
    setReview(r => (r ? { ...r, marks: { ...r.marks, [m.address]: { marked: m.marked, words: m.words } } } : r))
  }, [])

  const onParts = useCallback((list: ClientPartRef[]) => setDeclared({ docPath, parts: list }), [docPath])

  // Something the host wrote changed the chain: read it again here, and have
  // the app's fields read it again too.
  const { reload } = decisions
  const changed = useCallback(() => {
    reload()
    refreshApp()
  }, [reload])

  // What it was made from, and taking that document's newer version (a
  // spin-off may, owner 2026-11-09). A refusal is said where the bar is.
  const [upError, setUpError] = useState<{ docPath: string; message: string } | null>(null)
  const onUpError = useCallback((message: string) => setUpError({ docPath, message }), [docPath])
  const onUpTaken = useCallback(() => { setUpError(null); changed() }, [changed])
  const { madeFrom, update: updateFromUpstream, upstream } = useMadeFrom(docPath, onUpTaken, onUpError, stamp)

  // Links (os-layer §5.7): link an existing document, take a linked one's
  // newer version, let go of one. A refusal (a locked document) is said where
  // the bar is, in the host's words.
  const [linkError, setLinkError] = useState<{ docPath: string; message: string } | null>(null)
  const onLinkError = useCallback((message: string) => setLinkError({ docPath, message }), [docPath])
  const onLinked = useCallback(() => { setLinkError(null); changed() }, [changed])
  const links = useLinks(docPath, onLinked, onLinkError, stamp)
  const { linked, madeInto } = linksOf(links.related)
  const changedLinks = linked.filter(l => l.dir === 'in' && l.changed)

  const save = useCallback(async () => {
    if (!review || review.docPath !== docPath || problemOf(review.draft)) return
    const { draft, marks } = review
    setSaving('saving')
    setSaveError(null)
    try {
      // The client's file is stored only now, under a name of its own.
      let asset: string | undefined
      if (draft.answer !== 'accepted' && draft.how === 'file' && draft.file) {
        asset = (await host.uploadAsset(assetNameOf(draft.file.name, new Date()), draft.file.bytes)).internal_path
      }
      const reply = await host.clientReview(bodyOf(draft, parts, marks, asset))
      const email = draft.email.trim()
      lastWho.current.set(docPath, { name: draft.name.trim(), ...(email ? { email } : {}) })
      const sg = reply.suggestions
      setMatched(sg ? {
        docPath, review: reply.decision,
        reason: sg.status === 'unavailable' && sg.reason ? sg.reason : null,
        none: sg.status === 'found' && !sg.decisions?.length,
      } : null)
      setReview(null)
      changed()
    } catch (e) {
      setSaveError(String(e instanceof Error ? e.message : e))
    } finally {
      setSaving('no')
    }
  }, [review, docPath, parts, changed])

  // "Make this change" in the app reopened a part: it opens in edit mode.
  const onEditRequest = useCallback(() => {
    setReview(null)
    setEditMode(true)
  }, [setEditMode])

  const marked = review ? markedOf(review.draft, parts, review.marks).length : 0
  const authored = open.render_model === 'authored'

  // ── glass chrome ──────────────────────────────────────────────────────────
  // An app may ask to be shown under glass (`clan:chrome`): the bar, footer
  // and rail lie over it, frosted, so the document shows through them, and it
  // is told what they cover. Client review keeps the solid layout (its panel
  // and band are part of the page's flow).
  // What the open document asked for, kept with the document that asked: a
  // document opened next starts solid until it asks. The glass takes the
  // document's own ground as its tint, when the app gives one the chrome's ink
  // still reads on (4.5:1); never any other colour.
  const docRef = useRef(docPath)
  useEffect(() => { docRef.current = docPath }, [docPath])
  const [chrome, setChrome] = useState<{ doc: string | null; mode: 'glass' | 'solid'; tint: string | null }>(
    { doc: null, mode: 'solid', tint: null })
  const onChrome = useCallback((mode: 'glass' | 'solid', tint: string | null) => {
    setChrome({ doc: docRef.current, mode, tint: tint && readsWithChromeInk(tint) ? tint : null })
  }, [])
  // What the open document asked the OS bar to show (`clan:bar`), kept with the
  // document that asked like the chrome above: the next document starts with an
  // empty bar until it sends its own. Client review keeps the bar to itself.
  const [barState, setBarState] = useState<{ doc: string | null; items: BarItem[] }>({ doc: null, items: [] })
  const onBar = useCallback((items: BarItem[]) => setBarState({ doc: docRef.current, items }), [])
  const barItems = barState.doc === docPath && !clientOn ? barState.items : []
  // The app's own word for its state wins over the shell's, where it sends one.
  const appStatus = statusOf(barItems)
  // The page says its agents are at work (the bar's working chip) before the host's run catches up:
  // the medallion follows the same signal as the chip, with the step it names (owner, 2026-11-10).
  const pageRun = pageRunOf(modeOf(barItems))
  const mark_ = markTarget({ inDoc: product, needs, run: run?.state === 'working' || !pageRun ? run : pageRun, finished: runSeen.finished, engaged })
  const asked = chrome.doc === docPath
  const glass = asked && chrome.mode === 'glass' && !clientOn
  const glassTint = asked ? chrome.tint : null
  const topRef = useRef<HTMLDivElement>(null)
  const workRef = useRef<HTMLDivElement>(null)
  const footRef = useRef<HTMLElement>(null)
  const [insets, setInsets] = useState<{ top: number; right: number; bottom: number } | null>(null)
  useEffect(() => {
    if (!glass) return
    const measure = () => {
      const top = topRef.current?.getBoundingClientRect().height ?? 0
      const bottom = footRef.current?.getBoundingClientRect().height ?? 0
      // The rail (or the open panel) on the right; on a narrow screen it floats
      // in the footer instead, and covers nothing.
      const side = workRef.current?.querySelector(DRAWER_SEL) as HTMLElement | null
      const pos = side ? getComputedStyle(side).position : ''
      const right = side && (pos === 'absolute' || pos === 'fixed') ? side.getBoundingClientRect().width : 0
      setInsets(i => (i && i.top === Math.round(top) && i.right === Math.round(right) && i.bottom === Math.round(bottom)
        ? i : { top: Math.round(top), right: Math.round(right), bottom: Math.round(bottom) }))
    }
    const first = requestAnimationFrame(measure)
    const ro = new ResizeObserver(measure)
    if (topRef.current) ro.observe(topRef.current)
    if (footRef.current) ro.observe(footRef.current)
    if (workRef.current) ro.observe(workRef.current)
    const mo = new MutationObserver(() => {
      measure()
      workRef.current?.querySelectorAll(DRAWER_SEL).forEach(el => ro.observe(el))
    })
    if (workRef.current) mo.observe(workRef.current, { childList: true })
    workRef.current?.querySelectorAll(DRAWER_SEL).forEach(el => ro.observe(el))
    window.addEventListener('resize', measure)
    return () => { cancelAnimationFrame(first); ro.disconnect(); mo.disconnect(); window.removeEventListener('resize', measure) }
  }, [glass])
  // What the glass covers, only while there is glass.
  const shown = glass ? insets : null

  return (
    <div className={glass ? 'ch-doc ch-doc-glass' : 'ch-doc'} style={{ display: 'flex', flexDirection: 'column', height: '100vh',
      ...(shown ? { ['--glass-top' as string]: shown.top + 'px', ['--glass-bottom' as string]: shown.bottom + 'px' } : {}),
      ...(glass && glassTint ? { ['--glass-tint' as string]: glassTint } : {}) }}>
      <div className="ch-top" ref={topRef}>
      {/* Accent strip — recolors with a trusted app's theme (clan://set-theme). */}
      <div className="ch-strip" />
      <Toolbar
        agency={agency}
        agencyLogo={agencyLogo}
        mark={mark}
        onAgency={onAgency}
        onHome={onHome}
        client={client}
        account={account}
        // The medallion lights only for the document the person is IN (owner, 9 Nov 2026).
        attention={product && (needs > 0 || !!crew?.waiting)}
        markTarget={mark_}
        needs={needs}
        onDecisions={clientOn ? undefined : () => setDecisionsOpen(o => !o)}
        decisionsOpen={decisionsOpen && !clientOn}
        user={user}
        onSignOut={onSignOut}
        doc={{
          title: barTitle,
          tool: brand,
          state: appStatus ?? docStateOf(decisions.view),
          bar: barItems,
          onBarAction: barAction,
          isTemplate: open.is_template,
          trusted: open.trusted,
          validation: open.validation,
          onOpenFile,
          onToggleSidebar: () => setSidebarOpen(o => !o),
          sidebarOpen,
          onLineage: () => { setDrawerView('lineage'); setDecisionsOpen(true) },
          toolKey,
          onRename: host.setTitle && !open.is_template ? (t: string) => { void host.setTitle!(t).then(() => refreshApp()).catch(e => setLinkError({ docPath, message: String(e instanceof Error ? e.message : e) })) } : undefined,
          onStartFresh,
          onToolPage,
          onSave,
          onCopyLink: open.is_template ? undefined : onCopyLink,
          locked: !!decisions.view?.lock.locked && !decisions.view.lock.reopened?.length,
          onOpenDocument,
          crew,
          onKeepOffline,
          onExport,
          targets,
          onSpinoff,
          madeFrom,
          madeInto,
          linked,
          linkTargets: links.targets,
          onLink: open.is_template ? undefined : links.link,
          onUpdateLinked: decisions.view?.lock.locked || open.is_template ? undefined : links.update,
          onUnlink: decisions.view?.lock.locked || open.is_template ? undefined : links.unlink,
          // A locked version keeps what it was made from; the host refuses it too.
          onUpdateFromUpstream: decisions.view?.lock.locked || open.is_template ? undefined : updateFromUpstream,
          loading: false,
          saved: saved ? <SaveStatus docPath={docPath} updatedAt={listedUpdated(library, docPath) ?? open.manifest.updated_at} /> : undefined,
          editMode,
          // A locked document with nothing reopened takes no edit: Client
          // review stands where Edit was.
          onToggleEdit: authored && (editMode || !reviewable) ? () => setEditMode(e => !e) : undefined,
          onClientReview: reviewable && !open.is_template ? startReview : undefined,
          clientAnswered: !!decisions.view?.client?.answer?.current,
          clientMode: clientOn ? { onCancel: endReview, busy: saving !== 'no' } : undefined,
        }}
      />
      {banner}
      {upError?.docPath === docPath && (
        <div className="ch-banner" role="alert">
          <span className="ch-banner-dot" aria-hidden />
          <span className="ch-banner-text"><strong>Could not update from {madeFrom?.title ?? 'what it was made from'}.</strong>{upError.message}</span>
          <button type="button" className="ch-link" onClick={() => setUpError(null)}>Dismiss</button>
        </div>
      )}
      {linkError?.docPath === docPath && (
        <div className="ch-banner" role="alert" data-testid="link-error">
          <span className="ch-banner-dot" aria-hidden />
          <span className="ch-banner-text"><strong>Could not change the link.</strong>{linkError.message}</span>
          <button type="button" className="ch-link" onClick={() => setLinkError(null)}>Dismiss</button>
        </div>
      )}
      {!decisions.view?.lock.locked && !open.is_template && changedLinks.map(l => (
        <div key={l.documentId} className="ch-banner ch-banner-note" role="status" data-testid="link-changed">
          <span className="ch-banner-dot" aria-hidden />
          <span className="ch-banner-text"><strong>Linked {l.noun ?? ''}{l.noun ? ' ' : ''}{l.title}{l.taken ? ` · v${l.taken}` : ''} · changed.</strong>It changed since this took it. Your own work here stays when you update.</span>
          <button type="button" className="ch-link" onClick={() => links.update(l.documentId)}>Update</button>
          <button type="button" className="ch-link" onClick={() => links.unlink(l.documentId)}>Unlink</button>
        </div>
      ))}
      </div>
      <div className={`ch-work ${clientOn ? 'ch-work-review' : ''}`} ref={workRef}>
        {sidebarOpen && <Sidebar manifest={open.manifest} path={open.path} onOpenDocument={onOpenDocument} />}
        <main className="ch-work-main">
          {!clientOn && decisions.view && (
            <ClientReviewBand
              view={decisions.view}
              noun={noun}
              matched={matched?.docPath === docPath ? matched : null}
              onChanged={changed}
            />
          )}
          <AppRuntime
            htmlContent={running.htmlContent}
            hasHumanView={open.has_human_view}
            manifest={open.manifest}
            renderModel={authored ? 'authored' : 'legacy'}
            editMode={editMode}
            clientMode={{ on: clientOn, answer: clientOn ? review!.draft.answer : null }}
            onParts={onParts}
            onPartMark={onPartMark}
            onEditRequest={onEditRequest}
            onChrome={onChrome}
            onBar={onBar}
            insets={shown}
          />
        </main>
        {clientOn ? (
          <ClientReviewPanel
            draft={review!.draft}
            onDraft={onDraft}
            parts={parts}
            marked={marked}
            known={review!.known}
            noun={noun}
            saving={saving}
            error={saveError}
            onSave={save}
          />
        ) : decisionsOpen ? (
          <DecisionsDrawer
            title={`${client?.name ? `${client.name} · ` : ''}${barTitle}`}
            groups={[{
              key: docPath,
              title: barTitle,
              noun,
              calls: needsOf(decisions.view),
              aside: aside.keys,
              onToggleAside: aside.toggle,
              locked: !!decisions.view?.lock.locked && !decisions.view.lock.reopened?.length,
              verify: async finding => { await host.verify(finding, 'Looks right (from the Decisions card)'); refreshApp() },
              approve: async () => { await approveDoc(); refreshApp() },
              open: item => openInApp(refOfAddress(item.address), String(item.address ?? '').split('#')[1]),
              lock: lockWords(decisions.view),
            }]}
            focus={{
              title: barTitle,
              noun,
              view: decisions.view,
              error: decisions.error,
              related: links.related,
              onShow: (ref, path) => openInApp(ref, path),
              onOpenPath: onOpenDocument,
              acknowledge: id => host.acknowledge(id),
              manifest: open.manifest,
              upstream: upstream?.upstream ?? null,
            }}
            view={drawerView}
            onView={setDrawerView}
            onClose={() => setDecisionsOpen(false)}
            onChanged={changed}
          />
        ) : null}
      </div>
      <footer className="ch-footer" ref={footRef}>
        <PoweredByClan />
      </footer>
    </div>
  )
}

/** The Decisions drawer over the document: what the glass insets keep clear on the right. */
const DRAWER_SEL = ':scope > .nui > .dtree-drawer'

/** Whether the chrome's own ink reads on `hex` (WCAG contrast 4.5:1 or more). */
function readsWithChromeInk(hex: string): boolean {
  const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim()
  const lum = (h: string) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(h)
    if (!m) return null
    const [r, g, b] = [0, 2, 4].map(i => {
      const v = parseInt(m[1].slice(i, i + 2), 16) / 255
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const a = lum(hex), b = lum(ink)
  if (a == null || b == null) return false
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5
}
