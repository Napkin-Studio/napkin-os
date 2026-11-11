// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { useEffect, useState, useCallback, useRef } from 'react'
import { hasServer, host, onDevice, openOnDevice, serverless, switchToDevice, switchToServer } from './host'
import type { InstalledApp, OpenResult } from './host'
import DeviceBanner from './offline/DeviceBanner'
import DeviceHome from './offline/DeviceHome'
import OfflineDialog from './offline/OfflineDialog'
import AgencyLookPanel from './shell/agency/AgencyLookPanel'
import { applyAgencyLook, getAgencyLook } from './shell/agency/look'
import { isClanFile, keepOffline, pickFile, type DeviceSource } from './offline/actions'
import { copyBytes, type OfflineCopy } from './offline/store'
import { useFileDrop } from './offline/useFileDrop'
import { applyUpdate, onLaunchFiles, useUpdateReady } from './pwa/pwa'
import { askAppToExport } from './shell/appExport'
import Launcher from './shell/Launcher'
import { LandingHome } from './shell/landing/LandingHome'
import { useLanding } from './shell/landing/useLanding'
import { initialsOf, jobOf, routeOfDocument, whoIs } from './shell/landing/model'
import { toolById, toolOfApp } from './shell/landing/tools'
import Toolbar from './components/Toolbar'
import { signedInUser } from './host/http'
import { signOut } from './shell/signOut'
import { docEntry, isDocEntryState, isNotFound, launchIsMine } from './shell/lastOpen'
import { spinoffTitle } from './shell/docTitle'
import { agencyIdOf, agencyNameOf, applyAgency, coloursOf, markOf, pillLogoOf } from './shell/agency/palette'
import { rememberAgency } from './shell/agency/lastAgency'
import { DeskDrawer } from './shell/nui/DeskDrawer'
import { useDeskFacts } from './shell/nui/useDeskFacts'
import { callsIn, clientLook, clientName, monogramOf, sectorOf, setSector } from './shell/nui/deskData'
import { setClientAgency } from './shell/agency/clients'
import type { Account, ClientChip } from './components/barMenus'
import { useOfflineCopies } from './offline/useOfflineCopies'
import { useRoute } from './shell/useRoute'
import { useHomeView } from './shell/home/useHomeView'
import { formatRoute, type Route } from './shell/route'
import AppHost from './shell/AppHost'
import InstallPrompt from './shell/InstallPrompt'
import type { RunningApp, Screen } from './shell/types'
import StudioShell from './studio/StudioShell'
import { LogoSpinnerFill, LogoSpinnerVeil } from './brand/LogoSpinner'
import './index.css'
import './components/chrome.css'
import './shell/nui/tokens.css'
import './shell/nui/modes.css'
import './shell/nui/nui.css'
import './shell/nui/shell.css'
import { roles } from './shell/agents/engine'

// Theme keys an immersive app may recolor → CSS variables on the shell root.
// These are the design tokens; the legacy names (--bg, --surface, --text,
// --border, --muted) alias onto them in index.css, so both follow. The accent
// is --accent, not --create: an app may recolour the chrome's accent but not
// the Create department.
const THEME_VARS: Record<string, string> = {
  accent: '--accent', bg: '--paper', surface: '--card',
  text: '--ink', border: '--line', muted: '--ink2',
}
function applyTheme(colors: Record<string, string> | null | undefined) {
  if (!colors) return
  const root = document.documentElement
  for (const [k, v] of Object.entries(colors)) {
    if (THEME_VARS[k] && typeof v === 'string') root.style.setProperty(THEME_VARS[k], v)
  }
}
function resetTheme() {
  const root = document.documentElement
  for (const v of Object.values(THEME_VARS)) root.style.removeProperty(v)
}

/** The history entry an open document stands on, so Back leaves it and lands where it was opened. */
const isDocEntry = () => isDocEntryState(window.history.state)
/**
 * The URL of an open studio document: `?open=<path>` (what Share's Copy link
 * gives, read back by host/http.ts takeLaunchFile), so a reload reopens it, and
 * the hash of its own client and tool, so the URL says where it belongs after
 * a spin-off. A document on the device has no such link.
 */
function docUrl(path: string | null, hash: string | null): string {
  const params = new URLSearchParams(window.location.search)
  if (path) params.set('open', path)
  else params.delete('open')
  const q = params.toString()
  return window.location.pathname + (q ? `?${q}` : '') + (hash ?? window.location.hash)
}
/** The document's entry becomes the page it leaves to: no stale entry left to Back into. */
const retireDocEntry = () => { if (isDocEntry()) window.history.replaceState(null, '', docUrl(null, null)) }

export default function App() {
  const [screen, setScreen] = useState<Screen>('home')
  // Where the landing is (the URL hash).
  const [route, go] = useRoute()
  const [running, setRunning] = useState<RunningApp | null>(null)
  const [installed, setInstalled] = useState<InstalledApp[]>([])
  const [pendingLaunch, setPendingLaunch] = useState<OpenResult | null>(null)
  const [loading, setLoading] = useState(false)
  // Something the shell is preparing that is not opening a document (an
  // export, an install): its label, shown on the loading veil.
  const [busy, setBusy] = useState<string | null>(null)
  // False until the first attempt to load home has settled, so the native
  // launcher does not flash up before the home app arrives.
  const [booted, setBooted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Toast raised by a trusted app via window.napkin.notify → clan://notify.
  const [toast, setToast] = useState<{ title: string; body: string; error?: boolean } | null>(null)
  // On the device: the public viewer, a file opened here, an offline copy, or
  // a signed-in page that could not reach the studio.
  const [device, setDevice] = useState(onDevice)
  const [unreachable, setUnreachable] = useState(false)
  const [offlineOpen, setOfflineOpen] = useState(false)
const [lookOpen, setLookOpen] = useState(false)
  const updateReady = useUpdateReady()
  // The landing's data, read through the host. Not on the device's own home.
  // In a document too: the crew in the bar shows an agent while one works on it (its run, from the same listing).
  const landing = useLanding(host, screen === 'home' || screen === 'app', !(device && !serverless),
    screen === 'app' ? running?.artifactPath ?? null : null)
  // The person's home, from the roles in their session; none for a person with no role, who keeps the desk.
  const home = useHomeView(hasServer && !(device && !serverless), route.level === 'home' ? route.as : null)
  // On a server with accounts: who is signed in, for the bar's way out.
  const [user, setUser] = useState<string | null>(null)
  // Who the history entries the shell writes are for (lastOpen.ts).
  const person = useRef<string | null>(null)
  // A read from the server: the state is set when it answers.
  useEffect(() => { void signedInUser().then(u => { person.current = u ? u.username : null; setUser(person.current) }) }, [])
  // The agency's admin-set colours on the chrome (shell/agency/palette.ts), or
  // the neutral pair; a layer of its own that resetTheme never clears.
  const personId = landing.data?.person?.id ?? null
  // Whose client registry applies (agency/clients.ts): set before anything below reads a client's look.
  setClientAgency(personId)
  // Not before the first read settles: until then the boot screen's layer (brand/bootLook.ts, the agency
  // this browser last signed in to) stays, so a reload never shows Napkin's kit on the way to the agency's.
  const personKnown = personId != null || landing.state !== 'loading' || (device && !serverless)
  useEffect(() => { if (personKnown) { applyAgency(personId); rememberAgency(personId) } }, [personId, personKnown])
  // The accent sampled from the agency's logo (shell/agency/look.ts), once the server says whose it is.
  useEffect(() => { if (personKnown && hasServer && !device) void getAgencyLook().then(applyAgencyLook) }, [personId, personKnown, device])
  // The medallion in the agency's own base and accent, else Napkin's.
  const mark = markOf(personId)
  // The agency's wordmark on its pill (and its icon on a narrow bar), where the registry has them.
  const agencyLogo = pillLogoOf(coloursOf(agencyIdOf(personId)))
  // Decisions on the desk: every call across the documents it has read.
  const [deskDecisions, setDeskDecisions] = useState(false)
  // What the desk reads of recent documents' own chains: last editor, calls, thin findings, upstream changes.
  const { facts, refresh: refreshFacts } = useDeskFacts(landing.data?.items ?? null, landing.state === 'ready' && !(device && !serverless))
  const offlineCopies = useOfflineCopies()

  const notify = useCallback((title: string, body: string, ms = 5000) => {
    setToast({ title, body })
    setTimeout(() => setToast(null), ms)
  }, [])

  // Every open — home, a document, a new or spun-off one, a file on the
  // device — takes a number, and only the latest may change what is on screen.
  // Opens overlap: on load the shell asks for home and for a `?open=` document
  // at once, and whichever answered last used to win, sometimes painting one
  // document's view over the other's host session.
  const openSeq = useRef(0)
  const nextOpen = () => ++openSeq.current
  const isLatest = (n: number) => n === openSeq.current

  const refreshApps = useCallback(async () => {
    try { setInstalled(await host.listApps()) } catch (e) { console.error(e) }
  }, [])
  // Once at start too: a document opened straight from a link (or a reload)
  // names its tool in the bar from this list, without the home ever showing.
  // A load from the host: the state is set when it answers, not in the effect.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refreshApps() }, [refreshApps])

  // Go home. The host still opens its home document, so its session stands
  // where it always has between documents, but the shell draws the home itself
  // (Launcher): the crew stands on it in React, from the same figures the apps
  // use. The host's own home app (napkin-host assets/home_app.html) is no longer
  // shown here.
  const openHome = useCallback(async () => {
    const n = nextOpen()
    resetTheme() // home and other apps use the default Napkin theme
    // The web app on the device has its own home: open a file, or a copy.
    if (onDevice() && !serverless) {
      setScreen('home')
      return
    }
    try {
      await host.openHome()
      if (!isLatest(n)) return
      refreshApps()
    } catch (e) {
      if (!isLatest(n)) return
      console.error('open_home failed', e)
      if (hasServer && (e instanceof TypeError || !navigator.onLine)) {
        // The studio is out of reach, not broken: carry on as the viewer, so
        // offline copies and files on this device still open.
        switchToDevice()
        setDevice(true)
        setUnreachable(true)
      } else {
        refreshApps() // the home still lists what is installed
      }
    }
    setBooted(true)
    setScreen('home')
  }, [refreshApps])

  const runArtifact = useCallback(async (n: number, open: OpenResult, source?: DeviceSource) => {
    const html = open.has_human_view ? await host.getHumanHtml() : ''
    if (!isLatest(n)) return
    resetTheme() // clear any prior app's theme before this one (re)applies its own
    setRunning({ artifactPath: open.path, open, htmlContent: html, editMode: false, source })
    setScreen('app')
    // The browser's Back leaves the document for where it was opened from: the
    // document takes one history entry of its own (once, however many it opens).
    const route = routeOfDocument(open.manifest)
    const url = hasServer && !source && !open.is_template && !onDevice()
      ? docUrl(open.path, route ? formatRoute(route) : null) : window.location.href
    if (!isDocEntry()) window.history.pushState(docEntry(person.current), '', url)
    else window.history.replaceState(docEntry(person.current), '', url)
  }, [])

  // A .clan from this device — dropped, chosen, handed over by the OS, or an
  // offline copy. It opens in the tab and is never uploaded, whichever host
  // the page was using before.
  const openDeviceBytes = useCallback(async (bytes: Uint8Array, label: string, source: DeviceSource) => {
    const n = nextOpen()
    setLoading(true); setError(null); setBusy('Opening on this device…')
    try {
      const result = await openOnDevice(bytes, label)
      setDevice(true)
      if (!isLatest(n)) return
      if (result.is_template) setPendingLaunch(result)
      else await runArtifact(n, result, source)
    } catch (e) { setError(String(e)) } finally { setLoading(false); setBusy(null) }
  }, [runArtifact])

  const openLocalFile = useCallback(async (file: File) => {
    if (!isClanFile(file)) {
      setError(`${file.name} is not a .clan file.`)
      return
    }
    await openDeviceBytes(new Uint8Array(await file.arrayBuffer()), file.name, { kind: 'file', name: file.name })
  }, [openDeviceBytes])

  const openOfflineCopy = useCallback(async (copy: OfflineCopy) => {
    try {
      await openDeviceBytes(await copyBytes(copy.id), `offline-${copy.id}`, { kind: 'offline', copy })
    } catch (e) { setError(String(e)) }
  }, [openDeviceBytes])

  const chooseDeviceFile = useCallback(async () => {
    const file = await pickFile()
    if (file) await openLocalFile(file)
  }, [openLocalFile])

  const dragging = useFileDrop(openLocalFile)

  // Chrome and Edge, installed: a .clan double-clicked in the OS.
  const openLocalRef = useRef(openLocalFile)
  useEffect(() => { openLocalRef.current = openLocalFile }, [openLocalFile])
  useEffect(() => { onLaunchFiles(file => { openLocalRef.current(file) }) }, [])

  const backToStudio = useCallback(() => {
    switchToServer()
    setDevice(false)
    setUnreachable(false)
    setRunning(null)
    openHome()
  }, [openHome])

  // Open a .clan path: templates → install prompt; documents → run.
  // `remembered`: the document the page's URL named on load. One that is not
  // there (another person's, or gone) is let go quietly, and home stays.
  const openPathAs = useCallback(async (path: string, remembered: boolean) => {
    const n = nextOpen()
    setLoading(true); setError(null)
    try {
      const result = await host.openClan(path)
      if (!isLatest(n)) return
      if (result.is_template) setPendingLaunch(result)
      else await runArtifact(n, result)
    } catch (e) {
      if (remembered && isNotFound(e)) retireDocEntry()
      else setError(String(e))
    } finally { setLoading(false) }
  }, [runArtifact])
  const openPath = useCallback((path: string) => openPathAs(path, false), [openPathAs])

  const handleOpenFile = useCallback(async () => {
    // On the device, "Open" never means upload.
    if (onDevice() && !serverless) return chooseDeviceFile()
    const selected = await host.pickClanToOpen()
    if (selected) await openPath(selected)
  }, [openPath, chooseDeviceFile])

  const launchApp = useCallback(async (appId: string, clientId?: string) => {
    const n = nextOpen()
    setLoading(true); setError(null)
    try {
      const result = await host.newDocumentFromApp(appId, null, clientId)
      await runArtifact(n, result)
    } catch (e) { setError(String(e)) } finally { setLoading(false) }
  }, [runArtifact])

  // The latest running app, for callbacks registered once.
  const runningRef = useRef<RunningApp | null>(null)
  useEffect(() => { runningRef.current = running }, [running])

  // Branch the open document into another app. The source is untouched — this
  // opens a new document that carries its data and its decisions.
  const spinOff = useCallback(async (appId: string) => {
    const n = nextOpen()
    setLoading(true); setError(null)
    try {
      const src = runningRef.current?.open.manifest
      const result = await host.spinoffDocument(appId, spinoffTitle(src?.title, src?.app?.app_id, appId), null)
      await runArtifact(n, result)
    } catch (e) { setError(String(e)) } finally { setLoading(false) }
  }, [runArtifact])

  // Continue in › Start fresh: the same app, for the same client, from new notes.
  const startFresh = useCallback(() => {
    const m = runningRef.current?.open.manifest
    if (m?.app?.app_id) void launchApp(m.app.app_id, m.client?.id)
  }, [launchApp])

  // Save/export the open .clan. Shared by the toolbar Save As button and the
  // in-app "lock also saves" request. Reads the latest running app via a ref so
  // the once-registered event listener never goes stale (runningRef).
  const saveCurrent = useCallback(async () => {
    const r = runningRef.current
    if (!r) return
    const base = (r.open.manifest.title || 'document').replace(/[^\w.-]+/g, '-')
    const path = await host.pickSaveDestination(base, 'clan')
    if (path) await host.saveClanTo(path).catch(console.error)
  }, [])

  // "Present offline": keep the server's current copy of this document here.
  const keepCurrentOffline = useCallback(async () => {
    const r = runningRef.current
    if (!r) return
    setBusy('Saving for offline…')
    try {
      const copy = await keepOffline(r.open.path)
      notify('Saved for offline', `“${copy.title}” now opens from Offline with no network. It is a snapshot: changes made to it there are not sent back.`, 7000)
    } catch (err) {
      notify('Could not save for offline', String(err))
    } finally {
      setBusy(null)
    }
  }, [notify])

  // OS-owned export: the host composes a standalone document from the open
  // file's data via the SDK, then the clan-export-request listener runs the
  // save dialog + finish_export. Works for every app, no in-view builder needed.
  const exportCurrent = useCallback(async (kind: 'html' | 'pdf' = 'pdf') => {
    if (!runningRef.current) return
    // An app that renders its own view knows how it should look on paper; the
    // host can only compose from the markup, which for such an app is empty.
    if (await askAppToExport(kind)) return
    setBusy('Preparing the export…')
    await host.exportCurrent(kind, false, false).then(saved => {
      // a host that delivered the file itself says so here; the desktop's
      // save dialog reports through the clan-export-request listener instead
      if (saved) {
        setToast({ title: 'Exported', body: `Saved ${saved}` })
        setTimeout(() => setToast(null), 5000)
      }
    }).catch(err => {
      setToast({ title: 'Export failed', body: String(err), error: true })
      setTimeout(() => setToast(null), 5000)
    })
    setBusy(null)
  }, [])

  useEffect(() => {
    // openHome is async and sets no state synchronously: everything before its
    // first await is resetTheme(), which only clears CSS custom properties —
    // or, on the device, a setScreen to the screen we are already on. The
    // other setState calls all run after `await host.openHome()` — this is the
    // initial load from the host, i.e. the external-system synchronisation the
    // rule explicitly allows, not derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    openHome()
    // Read before the launch file is taken (taking it rewrites the entry).
    const entry = window.history.state as unknown
    void Promise.all([host.takeLaunchFile(), hasServer ? signedInUser() : Promise.resolve(null)]).then(([p, u]) => {
      if (p && launchIsMine(entry, u ? u.username : null)) void openPathAs(p, true)
    }).catch(() => {})
  }, [openHome, openPathAs])

  useEffect(() => {
    // Re-subscribed whenever the page changes host (`device`): events come
    // from whichever one the open document lives in.
    // The host forwards launch/open requests that originate INSIDE a clan file
    // (e.g. a click in the home CLAN app), plus OS "open with" events.
    const subs = [
      host.on('open-file', path => { if (path) openPath(path) }),
      host.on('clan-open-document', path => { if (path) openPath(path) }),
      host.on('clan-open-file-request', () => { handleOpenFile() }),
      host.on('clan-request-save', () => { saveCurrent() }),
      host.on('clan-export-request', async p => {
        if (!p) return
        const ext = p.kind === 'pdf' ? 'pdf' : 'html'
        const dest = await host.pickSaveDestination(p.filename, ext)
        if (!dest) return
        setBusy(`Saving the ${ext.toUpperCase()}…`)
        try {
          await host.finishExport(p.kind, p.tmpHtml, dest)
          setToast({ title: 'Exported', body: `Saved ${ext.toUpperCase()} to ${dest}` })
        } catch (err) {
          setToast({ title: 'Export failed', body: String(err), error: true })
        }
        setBusy(null)
        setTimeout(() => setToast(null), 5000)
      }),
      host.on('clan-title-changed', title => {
        if (title) setRunning(r => (r ? { ...r, open: { ...r.open, manifest: { ...r.open.manifest, title } } } : r))
      }),
      host.on('napkin-notify', n => {
        if (n) { setToast(n); setTimeout(() => setToast(null), 4000) }
      }),
      host.on('clan-theme-changed', colors => { applyTheme(colors) }),
    ]
    // A host that cannot be reached cannot subscribe either; that is not news.
    subs.forEach(s => s.catch(() => {}))
    return () => { subs.forEach(s => s.then(f => f()).catch(() => {})) }
  }, [device, openPath, handleOpenFile, saveCurrent])


  // A level of the trail, chosen from inside a document: leave the document for it.
  const leaveTo = useCallback((r: Route) => {
    retireDocEntry()
    go(r, true)
    openHome()
  }, [go, openHome])

  // The browser's Back (or a pasted link) while a document is open leaves it.
  const screenRef = useRef(screen)
  useEffect(() => { screenRef.current = screen }, [screen])
  useEffect(() => {
    const leave = () => { if (screenRef.current === 'app' && !isDocEntry()) openHome() }
    window.addEventListener('popstate', leave)
    window.addEventListener('hashchange', leave)
    return () => { window.removeEventListener('popstate', leave); window.removeEventListener('hashchange', leave) }
  }, [openHome])

  const onInstall = useCallback(async () => {
    if (!pendingLaunch) return
    setBusy('Installing…')
    try { await host.installApp(pendingLaunch.path); await refreshApps() } catch (e) { setError(String(e)) }
    setBusy(null)
    setPendingLaunch(null); openHome()
  }, [pendingLaunch, refreshApps, openHome])

  const onRunNew = useCallback(async () => {
    if (!pendingLaunch?.manifest.app) return
    const appId = pendingLaunch.manifest.app.app_id
    try { await host.installApp(pendingLaunch.path) } catch { /* maybe already installed */ }
    setPendingLaunch(null)
    await launchApp(appId)
  }, [pendingLaunch, launchApp])

  const onViewTemplate = useCallback(async () => {
    if (!pendingLaunch) return
    const result = pendingLaunch
    setPendingLaunch(null)
    await runArtifact(nextOpen(), result)
  }, [pendingLaunch, runArtifact])

  // Home: the device's own on the device; elsewhere the launcher, once the
  // first open has settled.
  // A sector typed with a new client: kept in this browser once the client exists (deskData.setSector).
  const addClient = useCallback(async (name: string, sector: string) => {
    const before = new Set((landing.data?.clients ?? []).map(c => c.id))
    const refused = await landing.add(name)
    if (!refused && sector.trim()) {
      const made = (await host.clients.list(false).catch(() => [])).find(c => !before.has(c.id) && c.name === name)
      if (made) setSector(made.id, sector)
    }
    return refused
  }, [landing])

  // The studio is opening: the loading sign alone, on the desk, with no bar half filled in round it.
  const opening = !(device && !serverless) && (!booted || landing.state === 'loading' || home.state === 'loading')
  const apps = device && !serverless ? (
    <DeviceHome
      onChooseFile={chooseDeviceFile}
      onOpenCopy={openOfflineCopy}
      onBackToStudio={hasServer ? backToStudio : undefined}
      offline={unreachable}
    />
  ) : !booted ? (
    <LogoSpinnerFill label="Opening the studio…" />
  ) : landing.state === 'ready' && landing.data && home.state === 'ready' ? (
    <LandingHome
      route={route}
      data={landing.data}
      go={go}
      onAdd={addClient}
      manage={landing.manage}
      onStart={launchApp}
      onOpenDocument={openPath}
      onRefresh={landing.reload}
      facts={facts}
      onOpenFile={handleOpenFile}
      onOffline={hasServer && !device ? () => setOfflineOpen(true) : undefined}
      onDecisions={() => setDeskDecisions(true)}
      home={home.view}
      agencyName={agencyNameOf(landing.data.person?.id, whoIs(landing.data.person ?? null).agency)}
      agencyLogo={agencyLogo}
    />
  ) : landing.state === 'loading' || (landing.state === 'ready' && home.state === 'loading') ? (
    <LogoSpinnerFill label="Opening the studio…" />
  ) : (
    // Where the host cannot list the library, the Launcher is the home as it was.
    <Launcher
      installed={installed}
      loading={loading}
      onLaunchApp={launchApp}
      onOpenFile={handleOpenFile}
      onOpenDocument={openPath}
    />
  )

  // Where you are, after the agency's pill: the client chip on a client's page (a switcher) and in its documents (the way back).
  const onLanding = landing.state === 'ready' && landing.data && !(device && !serverless)
  const who = whoIs(landing.data?.person ?? null)
  const agency = agencyNameOf(landing.data?.person?.id, who.agency)
  const chipOf = (c: { id?: string; name: string; initials?: string }): Omit<ClientChip, 'onOpen'> => ({
    name: c.id ? clientName({ id: c.id, name: c.name }) : c.name, mono: monogramOf({ name: c.name, initials: c.initials ?? '' }), look: clientLook(c.id ?? c.name, c.name),
  })
  const pageClient = onLanding && landing.data && (route.level === 'client' || route.level === 'tool')
    ? landing.data.clients.find(c => c.id === route.client) ?? null
    : null
  const deskChip: ClientChip | null = pageClient && landing.data ? {
    ...chipOf(pageClient),
    ...(route.level === 'tool' ? { onOpen: () => go({ level: 'client', client: pageClient.id }) } : {
      switcher: landing.data.clients.map(c => ({ id: c.id, name: clientName(c), sub: sectorOf(c.id) ?? `${landing.data!.items.filter(i => i.client?.id === c.id).length} open` })),
      onSwitch: (id: string) => go({ level: 'client', client: id }),
      current: true,
    }),
  } : null

  // The same chip in the bar of an open document, from the document's own client
  // (so it is right for a document opened from the desk, and after a spin-off).
  const docRoute = running && !device ? routeOfDocument(running.open.manifest) : null
  const docClientRef = running?.open.manifest.client ?? null
  const docClient = docRoute && docClientRef
    ? landing.data?.clients.find(c => c.id === docClientRef.id) ?? { id: docClientRef.id, name: docClientRef.name, initials: initialsOf(docClientRef.name) }
    : null
  const docChip: ClientChip | null = docClient ? { ...chipOf(docClient), onOpen: () => leaveTo({ level: 'client', client: docClient.id }) } : null

  // The desk's needs-your-call count: across all the agency's clients (owner,
  // 9 Nov 2026). It never lights the medallion; only an open document does.
  const deskNeeds = landing.data ? landing.data.items.reduce((n, i) => n + callsIn(i), 0) : 0
  const toAgency = () => go({ level: 'agency' })
  const onSignOut = user ? () => { void signOut() } : undefined
  // The account menu on the avatar (owner, 2026-11-11): who you are, Offline copies, Sign out.
  const personName = landing.data?.person?.name ?? who.first ?? user ?? 'You'
  const account: Account = {
    name: personName,
    initials: initialsOf(personName),
    // The agency's name, and the person's role where the session carries one (the role an admin is viewing as is not theirs).
    line: home.view?.restricted && !home.view.viewing && home.view.title ? `${agency} · ${home.view.title}` : agency,
    ...(hasServer && !device ? { onOffline: () => setOfflineOpen(true), offlineCount: offlineCopies?.length ?? null, onLook: () => setLookOpen(true) } : {}),
  }

  // Share ▾ "Copy link": the web's link to a document (`?open=`, host/http.ts takeLaunchFile).
  const copyLink = useCallback(async () => {
    const r = runningRef.current
    if (!r) return
    const url = `${window.location.origin}${window.location.pathname}?open=${encodeURIComponent(r.open.path)}`
    try {
      await navigator.clipboard.writeText(url)
      notify('Link copied', 'People in your agency open it in Napkin Studio.')
    } catch {
      notify('Could not copy the link', url, 9000)
    }
  }, [notify])

  // Who is in the open document: the person signed in, and an agent while its run works.
  const docItem = running && landing.data ? landing.data.items.find(i => i.path === running.open.path) ?? null : null
  const crew = running && !device ? {
    people: user ? [{ name: whoIs(landing.data?.person ?? null).first ?? user, initials: initialsOf(whoIs(landing.data?.person ?? null).first ?? user), you: true }] : [],
    working: docItem?.run?.state === 'working' ? jobOf(docItem.run).verb : null,
    agent: docItem?.run?.state === 'working' ? roles.forStage(docItem.app_id ?? running.open.manifest.app?.app_id, docItem.run.stage) : null,
    progress: docItem?.run?.state === 'working' ? jobOf(docItem.run).step : null,
    waiting: docItem?.run?.state === 'waiting',
  } : undefined

  return (
    <>
      {error && (
        <div className="ch-banner" role="alert">
          <span className="ch-banner-dot" aria-hidden />
          <span className="ch-banner-text"><strong>Something went wrong.</strong> <span className="ch-mono">{error}</span></span>
          <button className="ch-btn ch-btn-quiet" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {screen === 'app' && running ? (
        <AppHost
          running={running}
          tool={installed.find(a => a.app_id === running.open.manifest.app?.app_id) ?? null}
          onOpenDocument={openPath}
          // The medallion and the agency pill both go to the desk (owner, 2026-11-11).
          onHome={() => leaveTo({ level: 'agency' })}
          client={docChip}
          account={account}
          toolKey={toolOfApp(running.open.manifest.app?.app_id)?.id ?? null}
          onToolPage={docRoute?.level === 'tool' && docClient ? {
            label: `${toolById(docRoute.tool)?.full ?? 'Its tool'} for ${clientName({ id: docClient.id, name: docClient.name })}`,
            run: () => leaveTo(docRoute),
          } : null}
          agency={agency}
          agencyLogo={agencyLogo}
          mark={mark}
          onAgency={() => leaveTo({ level: 'agency' })}
          onCopyLink={hasServer && !device ? copyLink : undefined}
          crew={crew}
          run={docItem?.run ?? null}
          library={landing.data?.items ?? null}
          user={user}
          onSignOut={onSignOut}
          onOpenFile={handleOpenFile}
          onSave={saveCurrent}
          onKeepOffline={!device && hasServer && !running.open.is_template ? keepCurrentOffline : undefined}
          banner={device && !serverless ? (
            <DeviceBanner
              source={running.source ?? { kind: 'file', name: running.open.manifest.title }}
              onDownload={saveCurrent}
            />
          ) : undefined}
          onExport={exportCurrent}
          onSpinoff={spinOff}
          onStartFresh={startFresh}
          // In the studio (or the desktop's files) each change is kept as it
          // is made; on the device it stays in the tab (DeviceBanner says so).
          saved={!device && !running.open.is_template}
        />
      ) : (
        <StudioShell
          bar={opening ? null : (
            <Toolbar
              agency={agency}
              agencyLogo={agencyLogo}
              mark={mark}
              onAgency={toAgency}
              onHome={toAgency}
              client={deskChip}
              place={onLanding && route.level === 'tool' ? { tool: route.tool, label: (toolById(route.tool)?.noun[1] ?? '').replace(/^./, c => c.toUpperCase()) } : null}
              needs={deskNeeds}
              // On the desk, Decisions opens the calls across every client.
              onDecisions={onLanding ? () => setDeskDecisions(o => !o) : undefined}
              decisionsOpen={onLanding ? deskDecisions : undefined}
              user={user}
              onSignOut={onSignOut}
              account={account}
            />
          )}
        >
          {apps}
          {onLanding && deskDecisions && landing.data && (
            <DeskDrawer
              items={landing.data.items}
              facts={facts}
              agency={agency}
              onOpen={path => { setDeskDecisions(false); void openPath(path) }}
              onClose={() => setDeskDecisions(false)}
              onChanged={path => { refreshFacts(path); void landing.reload() }}
            />
          )}
        </StudioShell>
      )}

      {lookOpen && <AgencyLookPanel onClose={() => setLookOpen(false)} />}
      {offlineOpen && <OfflineDialog onOpen={openOfflineCopy} onClose={() => setOfflineOpen(false)} />}

      {dragging && (
        <div className="dv-drop" aria-hidden>
          <div>
            Drop a .clan to open it here
            <small>It stays on this device and is never uploaded.</small>
          </div>
        </div>
      )}

      {updateReady && (
        <div className="dv-update" role="status">
          <span className="dv-dot" aria-hidden />
          A new version is ready.
          <button className="ch-btn" onClick={applyUpdate}>Reload</button>
        </div>
      )}

      {pendingLaunch && (
        <InstallPrompt
          result={pendingLaunch}
          onInstall={onInstall}
          onRunNew={onRunNew}
          onView={onViewTemplate}
          onCancel={() => setPendingLaunch(null)}
        />
      )}

      {(loading || busy) && <LogoSpinnerVeil label={busy ?? 'Opening…'} />}

      {toast && (
        <div className="ch-toast" data-error={toast.error || undefined} role="status" aria-live="polite">
          <div className="ch-toast-title"><span className="ch-chip-dot" aria-hidden />{toast.title}</div>
          <div className="ch-toast-body">{toast.body}</div>
        </div>
      )}
    </>
  )
}
