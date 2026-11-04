// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The home when the host can list the library: the landing, the clients page
// and one client, chosen by the route. Given its data and its doors; it fetches
// nothing. The Launcher stays as "All tools" and as the fallback.

import { useEffect, useMemo, useRef, useState } from 'react'
import { LandingPage } from './LandingPage'
import { ClientsPage } from './ClientsPage'
import { ClientPage } from './ClientPage'
import { ToolPage } from './ToolPage'
import { agencySummary, newsOf, ordered, summarise, whoIs, type AgencySummary } from './model'
import { greeting } from '../when'
import { TOOLS, isLive, toolById } from './tools'
import { arrival, isTyping } from './keys'
import type { LandingData } from './store'
import { correctRoute, formatRoute, sameRoute, up, type Route } from '../route'
import './landing.css'

interface Props {
  route: Route
  data: LandingData
  go: (r: Route, replace?: boolean) => void
  onAdd: (name: string) => Promise<string | null>
  /** Start a document of `appId` for a client. */
  onStart: (appId: string, clientId: string) => void
  onOpenDocument: (path: string) => void
  onAllTools: () => void
  /** Read the studio again now; resolves when the new data is in. */
  onRefresh: () => Promise<void>
}

export function LandingHome({ route, data, go, onAdd, onStart, onOpenDocument, onAllTools, onRefresh }: Props) {
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [adding, setAdding] = useState(false)
  const top = useRef<HTMLDivElement>(null)

  // Each level's heading takes focus on arrival, so a keyboard or a screen reader lands on it.
  const key = formatRoute(route)
  useEffect(() => {
    top.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true })
  }, [key])

  // Escape goes up one level (agency stays), unless it is closing something of its own.
  const goRef = useRef(go)
  const routeRef = useRef(route)
  useEffect(() => { goRef.current = go; routeRef.current = route })
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isTyping(e.target)) return
      const r = routeRef.current
      if (r.level === 'agency') return
      e.preventDefault()
      goRef.current(up(r))
    }
    document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [])

  const who = whoIs(data.person)
  const summary = useMemo(() => agencySummary(data.clients, data.items, data.unassigned), [data])
  const all = useMemo(() => ordered(data.clients, data.items), [data])

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
  const live = useMemo(() => new Set(TOOLS.filter(t => isLive(t, installed)).map(t => t.id as string)), [installed])

  const hello = who.first ? `${greeting().replace(/\.$/, '')}, ${who.first}.` : greeting()
  const clientId = route.level === 'client' || route.level === 'tool' ? route.client : null
  const client = clientId ? data.clients.find(c => c.id === clientId) : undefined

  // A client route must name a client that is here. One that is not (archived,
  // another studio's, mistyped) is corrected to #clients, and a tool that is not
  // live (Idea, Prod, an app not installed) to its client's page, so the trail,
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
  const tool = route.level === 'tool' ? toolById(route.tool) : undefined
  const mine = client ? data.items.filter(i => i.client?.id === client.id) : []
  const inTool = tool?.appId ? mine.filter(i => i.app_id === tool.appId) : []
  // a repeated word is still a change to the region, so it is said again
  const say = soon?.key === key ? soon.text + (soon.n % 2 ? '' : '\u00a0') : arrival(route, {
    agency: who.agency, client: client?.name, tool: tool?.full, tools: TOOLS.length, open: inTool.length,
  })

  let body
  if (clientId && client && route.level === 'tool' && tool && live.has(tool.id)) {
    body = (
      <ToolPage
        client={client}
        tool={tool}
        items={inTool}
        onNew={() => { if (tool.appId) onStart(tool.appId, client.id) }}
        onOpenItem={onOpenDocument}
        onBack={() => go({ level: 'client', client: client.id })}
      />
    )
  } else if (clientId && client) {
    body = (
      <ClientPage
        summary={summarise(client, data.items)}
        items={mine}
        live={live}
        onOpenTool={t => go({ level: 'tool', client: client.id, tool: t.id })}
        onSoon={t => setSoon(p => ({ key, text: `${t.full} is coming soon. It keeps its place.`, n: (p?.n ?? 0) + 1 }))}
        onOpenItem={onOpenDocument}
      />
    )
  } else if (route.level === 'clients' || clientId) {
    // While the correction above lands, the clients page stands in.
    body = (
      <ClientsPage
        agency={who.agency}
        clients={all}
        query={query}
        showAll={showAll}
        adding={adding}
        onQuery={setQuery}
        onShowAll={() => setShowAll(true)}
        onAdding={setAdding}
        onOpenClient={id => go({ level: 'client', client: id })}
        onAdd={async name => {
          const refused = await onAdd(name)
          if (!refused) setAdding(false)
          return refused
        }}
      />
    )
  } else {
    body = (
      <LandingPage
        agency={who.agency}
        greeting={hello}
        summary={summary}
        onOpenAgency={() => go({ level: 'clients' })}
        onOpenItem={onOpenDocument}
      />
    )
  }

  return (
    <div className="lc" ref={top}>
      <p className="lc-sr" role="status" aria-live="polite" data-testid="live">{say}</p>
      <p className="lc-sr" role="status" aria-live="polite" data-testid="news">{news}</p>
      {body}
      <footer className="lc-foot">
        <button className="lc-link" onClick={onAllTools}>All tools</button>
      </footer>
    </div>
  )
}
