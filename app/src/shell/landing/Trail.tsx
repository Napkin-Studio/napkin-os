// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The trail of circles: Agency > Clients > Client > Tool, always in the bar. On a
// landing screen each level is a link to that level and the one you are on is
// not. In an open document (`inDocument`) the trail names where the document
// sits, and every level, the tool's too, goes back to it. Derived from the
// route, never stored.

import { Circle } from './Circle'
import { initialsOf } from './model'
import { ancestry, formatRoute, sameRoute, type Route } from '../route'
import { toolById } from './tools'

interface Props {
  route: Route
  agency: string
  /** The client's name and circle, when the route names one. */
  client?: { name: string; initials?: string; material: string } | null
  /** An open document is under the trail: no level is "here", all of them lead back. */
  inDocument?: boolean
  /** In the OS bar the agency is its own pill: the trail starts at Clients. */
  noAgency?: boolean
  onGo: (r: Route) => void
}

interface Crumb { route: Route; label: string; disc: React.ReactNode }

export function Trail({ route, agency, client, inDocument, noAgency, onGo }: Props) {
  const mini = (material: string, initials: string) => <Circle size={26} material={material} initials={initials} />
  const crumbOf = (r: Route): Crumb => {
    switch (r.level) {
      case 'agency': return { route: r, label: agency, disc: mini('onyx', initialsOf(agency)) }
      case 'clients': return { route: r, label: 'Clients', disc: mini('pearl', 'All') }
      case 'client': return { route: r, label: client?.name ?? 'Client', disc: mini(client?.material ?? 'pearl', client ? client.initials || initialsOf(client.name) : '') }
      case 'map': return { route: r, label: 'The map', disc: mini('pearl', 'O') }
      case 'door': return { route: r, label: 'A door', disc: mini('pearl', 'D') }
      case 'home': return { route: r, label: 'A home', disc: mini('pearl', 'H') }
      case 'timesheet': return { route: r, label: 'Timesheet', disc: mini('pearl', 'T') }
      case 'setup': return { route: r, label: 'Set up', disc: mini('pearl', 'S') }
      case 'people': return { route: r, label: 'People', disc: mini('pearl', 'P') }
      case 'audit': return { route: r, label: 'Audit', disc: mini('pearl', 'A') }
      case 'job': return { route: r, label: r.number, disc: mini('pearl', 'J') }
      case 'tool': {
        const t = toolById(r.tool)
        return { route: r, label: t?.full ?? 'Tool', disc: mini('pearl', t?.name.slice(0, 1) ?? '') }
      }
    }
  }
  const crumbs = [...ancestry(route), route].filter(r => !(noAgency && r.level === 'agency')).map(crumbOf)
  if (crumbs.length === 0) return null
  return (
    <nav className="lc-trail" aria-label="Where you are">
      <ol>
        {crumbs.map(c => {
          const here = !inDocument && sameRoute(c.route, route)
          return (
            <li key={formatRoute(c.route)}>
              <button
                className="lc-crumb"
                data-level={c.route.level}
                aria-current={here ? 'page' : undefined}
                aria-label={c.label}
                title={c.route.level === 'agency' ? 'Back to the studio' : c.label}
                onClick={() => { if (!here) onGo(c.route) }}
              >
                {c.disc}
                <span className="lc-cn">{c.label}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
