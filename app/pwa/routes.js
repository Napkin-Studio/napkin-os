// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Which requests the service worker leaves alone, and which navigations it
// answers with the shell. A module of its own so the tests can import it; the
// build (vite.config.ts) inlines it into dist/sw.js at the routes
// placeholder, dropping the `export` keywords.
//
// `scope` is the worker's scope URL (`new URL('./', self.location.href)`).

/** Top-level paths the server owns, whatever base the shell is served under:
 * `/api/*` is client work (the server is authoritative for it, N3), `/s/*` an
 * app frame's capability URL, and `/production/*` the Production Tool that
 * napkin-web serves (features/os-sign-in.clan). */
export const SERVER_OWNED = ['api/', 's/', 'production/']

/** Paths the server owns: never answered from, or written to, a cache. */
export function serverOwned(url, scope) {
  if (url.origin !== scope.origin) return false
  // `/production` (no slash) is the tool too.
  const p = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`
  return SERVER_OWNED.some(r => p.startsWith(`/${r}`) || p.startsWith(scope.pathname + r))
}

/** A navigation the shell answers: a route, not a file, and not the server's. */
export function shellRoute(url, scope) {
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return false
  if (serverOwned(url, scope)) return false
  const last = url.pathname.split('/').pop() ?? ''
  return !last.includes('.') || last === 'index.html'
}
