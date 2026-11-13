// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The shell's route: where the landing is, as a URL hash.
//
//   #agency                 the landing: the agency circle, what needs you
//   #clients                the clients page: one circle per client
//   #client-<id>            one client, with its tools around it
//   #tool-<id>-<tool>       one tool, for that client
//   #door-<door>            one page door of the desk's Your pages row, e.g. #door-live-jobs
//   #timesheet              the person's own day (features/timesheet-sessions.clan)
//   #setup #people #audit   setting the agency up, its people and roles, and its audit view (features/agency-setup.clan)
//   #job-<number>           one job: its page (features/job-page.clan), `J` and three to six digits
//
// `#agency` is the desk for everyone. A role adds a row of page doors to it and filters its tools; it has no home
// of its own (features/align-landing-look.clan). `#map` and `#home-<role>` no longer exist and fall to the desk.
//
// `<id>` is a client id (`cli_` and eight lowercase hex digits) and `<tool>`
// one of `brief research idea deck prod ads territories script visual` (Territories is a page, not a
// circle: it sits behind the Brief gate, features/brief-gate.clan). Both are ASCII by construction:
// a client's name never goes in a URL, so non-ASCII names, renames and hostile
// hashes cannot make a link that points somewhere else. Anything that is not
// exactly one of these four shapes is `#agency`.
//
// The shell (App.tsx) owns the screen and writes the hash from it; a hashchange
// only reads. This module is pure, so it is table-tested without a browser.

export const TOOL_IDS = ['brief', 'research', 'idea', 'deck', 'prod', 'ads', 'territories', 'script', 'visual'] as const
export type ToolId = (typeof TOOL_IDS)[number]

export type Route =
  | { level: 'agency' }
  | { level: 'clients' }
  | { level: 'client'; client: string }
  | { level: 'tool'; client: string; tool: ToolId }
  | { level: 'door'; door: string }
  | { level: 'timesheet' }
  | { level: 'setup' }
  | { level: 'people' }
  | { level: 'audit' }
  | { level: 'job'; number: string }

export const AGENCY: Route = { level: 'agency' }

const CLIENT_ID = /^cli_[0-9a-f]{8}$/

// A door or a role is a lowercase word with hyphens, nothing a hash could use to point elsewhere.
const WORD = /^[a-z][a-z0-9-]{0,39}$/
export const isWord = (s: string): boolean => WORD.test(s)

// A job number: J and three to six digits, the shape the job registry accepts (jobs.rs is_job_number).
const JOB_NUMBER = /^J\d{3,6}$/
export const isJobNumber = (s: string): boolean => JOB_NUMBER.test(s)

export const isClientId = (s: string): boolean => CLIENT_ID.test(s)
export const isToolId = (s: string): s is ToolId => (TOOL_IDS as readonly string[]).includes(s)

/** The route a hash names; `#agency` for anything else, including nothing. */
export function parseRoute(hash: string): Route {
  const h = hash.startsWith('#') ? hash.slice(1) : hash
  if (h === 'agency') return AGENCY
  if (h === 'clients') return { level: 'clients' }
  if (h === 'timesheet') return { level: 'timesheet' }
  if (h === 'setup' || h === 'people' || h === 'audit') return { level: h }
  if (h.startsWith('door-')) {
    const door = h.slice('door-'.length)
    return isWord(door) ? { level: 'door', door } : AGENCY
  }
  if (h.startsWith('job-')) {
    const number = h.slice('job-'.length)
    return isJobNumber(number) ? { level: 'job', number } : AGENCY
  }
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
    case 'door': return `#door-${r.door}`
    case 'timesheet': return '#timesheet'
    case 'setup': return '#setup'
    case 'people': return '#people'
    case 'audit': return '#audit'
    case 'job': return `#job-${r.number}`
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
    case 'door':
    case 'setup':
    case 'people':
    case 'audit':
    case 'timesheet':
    case 'job': return [AGENCY]
  }
}

/** One level up, which is what Escape and Back-to-parent do; the agency has no parent. */
export function up(r: Route): Route {
  switch (r.level) {
    case 'agency': return AGENCY
    case 'clients': return AGENCY
    case 'client': return { level: 'clients' }
    case 'tool': return { level: 'client', client: r.client }
    case 'door':
    case 'setup':
    case 'people':
    case 'audit':
    case 'timesheet':
    case 'job': return AGENCY
  }
}

/**
 * The route the shell may actually show, given what is here: a client that is
 * not here (archived, another studio's, mistyped) is `#clients`, and a tool that
 * is not live (Idea, Prod, an app not installed) is its client's page. Anything
 * else is as asked. Pure, so the table of corrections is tested without a host.
 */
export function correctRoute(
  r: Route,
  here: { client: (id: string) => boolean; tool: (id: ToolId) => boolean },
): Route {
  if ((r.level === 'client' || r.level === 'tool') && !here.client(r.client)) return { level: 'clients' }
  if (r.level === 'tool' && !here.tool(r.tool)) return { level: 'client', client: r.client }
  return r
}
