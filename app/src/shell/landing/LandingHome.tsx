// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The home when the host can list the library, chosen by the route: the desk
// (`#agency` and `#clients` are the one desk now: the agency home and the
// clients wheel folded into it, gaps.md §11), one client's page, or one
// tool's page for a client. Given its data and its doors; it fetches nothing
// but the registry's offers. The Launcher stays as the app library and the
// fallback.

import { useEffect, useMemo, useRef, useState } from 'react'
import { ToolPage } from './ToolPage'
import { TerritoriesGate } from './TerritoriesGate'
import { host } from '../../host'
import type { LibraryItem } from '../../host'
import { VISUAL_BRIEF } from '../gate/words'
import type { Manage } from './useLanding'
import { agencySummary, newsOf, whoIs, type AgencySummary } from './model'
import { TOOLS, isLive, toolById } from './tools'
import { arrival, isTyping } from './keys'
import type { LandingData } from './store'
import { correctRoute, formatRoute, sameRoute, up, type Route } from '../route'
import { Desk } from '../nui/Desk'
import { Home } from '../home/Home'
import { TheO } from '../home/TheO'
import { DoorPage } from '../home/DoorPage'
import { useJobNeeds } from '../home/useJobNeeds'
import type { HomeView } from '../../host/http'
import type { AgencyLogo } from '../agency/palette'
import { ClientView } from '../nui/ClientView'
import type { Facts } from '../nui/deskData'
import { useLensDots } from '../nui/lenses'
import './landing.css'

const NONE: never[] = []

interface Props {
  route: Route
  data: LandingData
  go: (r: Route, replace?: boolean) => void
  /** Add a client; the sector typed is kept by the caller (deskData.setSector). */
  onAdd: (name: string, sector: string) => Promise<string | null>
  /** Rename, archive, restore and adopt; absent where the host cannot. */
  manage?: Manage
  /** Start a document of `appId` for a client. */
  onStart: (appId: string, clientId: string) => void
  onOpenDocument: (path: string) => void
  /** Read the studio again now; resolves when the new data is in. */
  onRefresh: () => Promise<void>
  /** What the desk read of recent documents (useDeskFacts). */
  facts?: Facts
  onOpenFile?: () => void
  onOffline?: () => void
  /** The Decisions drawer (the client page's record line opens it). */
  onDecisions?: () => void
  /** The person's home, from the roles in the session; absent or unrestricted keeps the desk (features/roles-and-homes.clan). */
  home?: HomeView | null
  /** The agency's name and marks, for the centre of the O. */
  agencyName?: string
  agencyLogo?: AgencyLogo
}

export function LandingHome({ route, data, go, onAdd, manage, onStart, onOpenDocument, onRefresh, facts = {}, onOpenFile, onOffline, onDecisions, home = null, agencyName, agencyLogo }: Props) {
  const top = useRef<HTMLDivElement>(null)
  const [registryNote, setRegistryNote] = useState<string | null>(null)

  // Escape goes up one level (the desk stays), unless it is closing something of its own.
  const goRef = useRef(go)
  const routeRef = useRef(route)
  useEffect(() => { goRef.current = go; routeRef.current = route })
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isTyping(e.target)) return
      const r = routeRef.current
      if (r.level === 'agency' || r.level === 'clients') return
      e.preventDefault()
      const u = up(r)
      goRef.current(u.level === 'clients' ? { level: 'agency' } : u)
    }
    document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [])

  // Each level's heading takes focus on arrival, so a keyboard or a screen reader lands on it.
  const key = formatRoute(route)
  useEffect(() => { top.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true }) }, [key])

  // What the job index asks of this person: read only where there is a home to show it.
  const jobNeeds = useJobNeeds(!!home?.restricted)

  const who = whoIs(data.person)
  const summary = useMemo(() => agencySummary(data.clients, data.items, data.unassigned), [data])

  // A refresh that finds more needing the person, or a new failure, says so once (polite live region).
  const last = useRef<AgencySummary | null>(null)
  const [news, setNews] = useState('')
  useEffect(() => {
    const said = newsOf(last.current, summary)
    last.current = summary
    // The announcement is a reaction to the data that just arrived.
    if (said) setNews(said)
  }, [summary])
  const installed = useMemo(() => data.apps.map(app_id => ({ app_id })), [data.apps])
  // Territories is a page behind the gate, not a circle: it is here whenever the client is.
  const live = useMemo(() => new Set([...TOOLS.filter(t => isLive(t, installed)).map(t => t.id as string), 'territories']), [installed])

  const clientId = route.level === 'client' || route.level === 'tool' ? route.client : null
  const client = clientId ? data.clients.find(c => c.id === clientId) : undefined

  // A client route must name a client that is here. One that is not (archived,
  // another studio's, mistyped) is corrected to the desk, and a tool that is not
  // live (Idea, Prod, an app not installed) to its client's page, so the bar,
  // the page and the URL agree. The data on screen may be a few seconds old, and
  // the client may be one just made, so an unknown one is looked for afresh once
  // before the route is corrected.
  const [checked, setChecked] = useState<string | null>(null)
  useEffect(() => {
    if (!clientId) return
    if (client) {
      const fixed = correctRoute(route, { client: () => true, tool: id => live.has(id) })
      if (!sameRoute(fixed, route)) go(fixed, true)
      return
    }
    if (checked === clientId) {
      go(correctRoute(route, { client: () => false, tool: () => false }), true)
      return
    }
    let fresh = true
    void onRefresh().finally(() => { if (fresh) setChecked(clientId) })
    return () => { fresh = false }
  }, [clientId, client, route, go, checked, onRefresh, live])

  // What the live region says: the level arrived at, or a word about a tool that is not here yet.
  const [soon, setSoon] = useState<{ key: string; text: string; n: number } | null>(null)
  const sayingSoon = (t: { full: string }) => setSoon(p => ({ key, text: `${t.full} is coming soon. It keeps its place.`, n: (p?.n ?? 0) + 1 }))
  const tool = route.level === 'tool' ? toolById(route.tool) : undefined
  const mine = client ? data.items.filter(i => i.client?.id === client.id) : []
  const inTool = tool?.appId ? mine.filter(i => i.app_id === tool.appId) : []
  const lenses = useLensDots(tool?.id === 'research' ? inTool : NONE)
  // a repeated word is still a change to the region, so it is said again
  const say = soon?.key === key ? soon.text + (soon.n % 2 ? '' : ' ') : arrival(route, {
    agency: who.agency, client: client?.name, tool: tool?.full, tools: 4, open: inTool.length,
  })

  // A person with a role lands on their home; the O, a door and another role's home are its pages.
  // The desk is the Clients door then (`#clients`). A person with no role keeps the desk, as before.
  const homed = home?.restricted ? home : null

  // A territory chosen (typed by hand until the Territory tool lands) spins the signed, confirmed brief off into a
  // visual brief and opens it. The territory is written as one attributed decision that names the brief version.
  const chooseTerritory = async (brief: LibraryItem, territory: string, line: string) => {
    await host.openClan(brief.path)
    const made = await host.spinoffDocument(VISUAL_BRIEF, `Visual brief, ${territory}`, null)
    let from = ''
    try { from = (await host.upstream()).carried?.last_decision ?? '' } catch { /* the page still opens */ }
    await host.gatePatch(
      { territory: { name: territory, line, source: 'typed', ...(who.first ? { chosen_by: who.first } : {}) } },
      'choose the territory',
      `Territory "${territory}" chosen from the brief${from ? ` at ${from}` : ''}.`,
    )
    onOpenDocument(made.path)
  }

  let body
  if (clientId && client && route.level === 'tool' && route.tool === 'territories') {
    body = (
      <TerritoriesGate
        client={client}
        items={mine}
        onOpenBrief={onOpenDocument}
        onNewBrief={() => onStart('ie.napkin.brief-maker', client.id)}
        onBack={() => go({ level: 'client', client: client.id })}
        onChooseTerritory={chooseTerritory}
      />
    )
  } else if (homed && route.level === 'map') {
    body = (
      <TheO
        view={homed}
        agency={agencyName ?? who.agency}
        logo={agencyLogo}
        onHome={() => go({ level: 'agency' })}
        onOpen={c => go(c.mine ? { level: 'agency' } : c.opens ? { level: 'home', as: c.opens } : { level: 'clients' })}
      />
    )
  } else if (homed && route.level === 'door') {
    const entry = [...homed.doors, ...homed.more].find(d => d.id === route.door)
    body = <DoorPage door={route.door} name={entry?.name ?? null} clients={data.clients} items={data.items} apps={data.apps} go={go} />
  } else if (homed && (route.level === 'agency' || route.level === 'home')) {
    body = (
      <Home
        view={homed}
        items={data.items}
        jobNeeds={jobNeeds}
        first={who.first}
        apps={data.apps}
        onDoor={d => go(d.id === 'clients' ? { level: 'clients' } : { level: 'door', door: d.id })}
        onOpenDocument={onOpenDocument}
        onMap={() => go({ level: 'map' })}
        onSwitch={role => go(role ? { level: 'home', as: role } : { level: 'agency' })}
      />
    )
  } else if (clientId && client && route.level === 'tool' && tool && live.has(tool.id)) {
    body = (
      <ToolPage
        client={client}
        tool={tool}
        items={inTool}
        onNew={() => { if (tool.appId) onStart(tool.appId, client.id) }}
        onOpenItem={onOpenDocument}
        onBack={() => go({ level: 'client', client: client.id })}
        lenses={lenses}
        onTerritories={tool.id === 'brief' ? () => go({ level: 'tool', client: client.id, tool: 'territories' }) : undefined}
      />
    )
  } else if (clientId && client) {
    body = (
      <ClientView
        client={client}
        items={mine}
        facts={facts}
        live={live}
        onOpenItem={onOpenDocument}
        onNew={t => { if (t.appId) onStart(t.appId, client.id) }}
        onOpenTool={t => go({ level: 'tool', client: client.id, tool: t.id })}
        onSoon={sayingSoon}
        onDecisions={onDecisions}
        onRename={manage ? name => manage.rename(client.id, name) : undefined}
        onArchive={manage ? async () => {
          const refused = await manage.archive(client.id)
          if (!refused) go({ level: 'agency' })
          return refused
        } : undefined}
      />
    )
  } else {
    // The desk (while a correction lands, it stands in).
    body = (
      <Desk
        data={data}
        facts={facts}
        live={live}
        first={who.first}
        manage={manage}
        onAdd={onAdd}
        onOpenClient={id => go({ level: 'client', client: id })}
        onOpenTool={(id, t) => go({ level: 'tool', client: id, tool: t.id })}
        onSoon={sayingSoon}
        onOpenDocument={onOpenDocument}
        onOpenFile={onOpenFile}
        onOffline={onOffline}
        onSay={setRegistryNote}
      />
    )
  }

  return (
    <div className="nui-home" ref={top}>
      <p className="lc-sr" role="status" aria-live="polite" data-testid="live">{say}</p>
      <p className="lc-sr" role="status" aria-live="polite" data-testid="news">{news}</p>
      <p className="lc-sr" role="status" aria-live="polite" data-testid="registry-note">{registryNote}</p>
      {body}
    </div>
  )
}
