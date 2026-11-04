// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The trail of circles: Agency > Clients > Client, always in the bar while the
// studio is on a landing screen. Each level is a link to that level; the one you
// are on is not. Derived from the route, never stored.

import { Circle } from './Circle'
import { initialsOf } from './model'
import { ancestry, formatRoute, sameRoute, type Route } from '../route'

interface Props {
  route: Route
  agency: string
  /** The client's name and circle, when the route names one. */
  client?: { name: string; initials: string; material: string } | null
  onGo: (r: Route) => void
}

interface Crumb { route: Route; label: string; disc: React.ReactNode }

export function Trail({ route, agency, client, onGo }: Props) {
  const mini = (material: string, initials: string) => <Circle size={26} material={material} initials={initials} />
  const crumbOf = (r: Route): Crumb => {
    switch (r.level) {
      case 'agency': return { route: r, label: agency, disc: mini('onyx', initialsOf(agency)) }
      case 'clients': return { route: r, label: 'Clients', disc: null }
      case 'client': return { route: r, label: client?.name ?? 'Client', disc: client ? mini(client.material, client.initials) : null }
      case 'tool': return { route: r, label: 'Tool', disc: null }
    }
  }
  const crumbs = [...ancestry(route), route].map(crumbOf)
  return (
    <nav className="lc-trail" aria-label="Where you are">
      <ol>
        {crumbs.map(c => {
          const here = sameRoute(c.route, route)
          return (
            <li key={formatRoute(c.route)}>
              <button
                className="lc-crumb"
                data-level={c.route.level}
                aria-current={here ? 'page' : undefined}
                aria-label={c.label}
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
