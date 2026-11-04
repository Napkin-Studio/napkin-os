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
import { agencySummary, ordered, summarise, whoIs } from './model'
import { greeting } from '../when'
import { TOOLS, isLive, type Tool } from './tools'
import type { LandingData } from './store'
import type { Route } from '../route'
import './landing.css'

interface Props {
  route: Route
  data: LandingData
  go: (r: Route) => void
  onAdd: (name: string) => Promise<string | null>
  /** Start a document of `appId` for a client. */
  onStart: (appId: string, clientId: string) => void
  onOpenDocument: (path: string) => void
  onAllTools: () => void
}

export function LandingHome({ route, data, go, onAdd, onStart, onOpenDocument, onAllTools }: Props) {
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [adding, setAdding] = useState(false)
  const top = useRef<HTMLDivElement>(null)

  // Each level's heading takes focus on arrival, so a keyboard or a screen reader lands on it.
  const level = route.level
  const key = route.level === 'client' || route.level === 'tool' ? `${level}:${route.client}` : level
  useEffect(() => {
    top.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true })
  }, [key])

  const who = whoIs(data.person)
  const summary = useMemo(() => agencySummary(data.clients, data.items, data.unassigned), [data])
  const all = useMemo(() => ordered(data.clients, data.items), [data])
  const installed = useMemo(() => data.apps.map(app_id => ({ app_id })), [data.apps])
  const live = useMemo(() => new Set(TOOLS.filter(t => isLive(t, installed)).map(t => t.id as string)), [installed])

  const hello = who.first ? `${greeting().replace(/\.$/, '')}, ${who.first}.` : greeting()
  const clientId = route.level === 'client' || route.level === 'tool' ? route.client : null
  const client = clientId ? data.clients.find(c => c.id === clientId) : undefined

  let body
  if (clientId && client) {
    const mine = data.items.filter(i => i.client?.id === client.id)
    body = (
      <ClientPage
        summary={summarise(client, data.items)}
        items={mine}
        live={live}
        onStart={(t: Tool) => { if (t.appId) onStart(t.appId, client.id) }}
        onOpenItem={onOpenDocument}
      />
    )
  } else if (route.level === 'clients' || clientId) {
    // A client route whose client is not here (archived, or another studio's) shows the clients.
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
      {body}
      <footer className="lc-foot">
        <button className="lc-link" onClick={onAllTools}>All tools</button>
      </footer>
    </div>
  )
}
