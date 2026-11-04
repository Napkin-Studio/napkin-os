// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The shell's route: where the landing is, as a URL hash.
//
//   #agency                 the landing: the agency circle, what needs you
//   #clients                the clients page: one circle per client
//   #client-<id>            one client, with its tools around it
//   #tool-<id>-<tool>       one tool, for that client
//
// `<id>` is a client id (`cli_` and eight lowercase hex digits) and `<tool>`
// one of `brief research idea deck prod ads`. Both are ASCII by construction:
// a client's name never goes in a URL, so non-ASCII names, renames and hostile
// hashes cannot make a link that points somewhere else. Anything that is not
// exactly one of these four shapes is `#agency`.
//
// The shell (App.tsx) owns the screen and writes the hash from it; a hashchange
// only reads. This module is pure, so it is table-tested without a browser.

export const TOOL_IDS = ['brief', 'research', 'idea', 'deck', 'prod', 'ads'] as const
export type ToolId = (typeof TOOL_IDS)[number]

export type Route =
  | { level: 'agency' }
  | { level: 'clients' }
  | { level: 'client'; client: string }
  | { level: 'tool'; client: string; tool: ToolId }

export const AGENCY: Route = { level: 'agency' }

const CLIENT_ID = /^cli_[0-9a-f]{8}$/

export const isClientId = (s: string): boolean => CLIENT_ID.test(s)
export const isToolId = (s: string): s is ToolId => (TOOL_IDS as readonly string[]).includes(s)

/** The route a hash names; `#agency` for anything else, including nothing. */
export function parseRoute(hash: string): Route {
  const h = hash.startsWith('#') ? hash.slice(1) : hash
  if (h === 'agency') return AGENCY
  if (h === 'clients') return { level: 'clients' }
  if (h.startsWith('client-')) {
    const client = h.slice('client-'.length)
    return isClientId(client) ? { level: 'client', client } : AGENCY
  }
  if (h.startsWith('tool-')) {
    const rest = h.slice('tool-'.length)
    const cut = rest.lastIndexOf('-')
    if (cut < 0) return AGENCY
    const client = rest.slice(0, cut)
    const tool = rest.slice(cut + 1)
    return isClientId(client) && isToolId(tool) ? { level: 'tool', client, tool } : AGENCY
  }
  return AGENCY
}

/** The hash for a route. `parseRoute(formatRoute(r))` is `r`. */
export function formatRoute(r: Route): string {
  switch (r.level) {
    case 'agency': return '#agency'
    case 'clients': return '#clients'
    case 'client': return `#client-${r.client}`
    case 'tool': return `#tool-${r.client}-${r.tool}`
  }
}

export const sameRoute = (a: Route, b: Route): boolean => formatRoute(a) === formatRoute(b)

/** The levels above `r`, nearest last: what the trail of circles shows. */
export function ancestry(r: Route): Route[] {
  switch (r.level) {
    case 'agency': return []
    case 'clients': return [AGENCY]
    case 'client': return [AGENCY, { level: 'clients' }]
    case 'tool': return [AGENCY, { level: 'clients' }, { level: 'client', client: r.client }]
  }
}
