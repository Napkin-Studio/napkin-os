// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Where sign-in sends a person back to (features/os-sign-in.clan).
//
// The Production Tool sends a signed-out person to `/?next=<its path>`. After
// signing in, the shell follows `next` only when it is a path on this origin
// under /production: never another site, never the server's /api, never a
// script URL. Anything else is ignored and the studio opens as usual.

/** `next` when it is safe to follow, else null. */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw) return null
  // Encoded slashes and backslashes could turn into `//host` or `/\host` once
  // decoded somewhere along the way.
  if (/%2f|%5c/i.test(raw)) return null
  // A path, not a URL: one leading slash, no backslash, no control characters.
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\s]/.test(raw)) return null
  const path = decoded(raw.split(/[?#]/, 1)[0])
  if (path === null) return null
  if (path !== '/production' && !path.startsWith('/production/')) return null
  // No climbing out of /production, written plainly or percent-encoded (`%2e%2e`, `%252e%252e`).
  if (path.split('/').some(seg => seg === '..' || seg === '.')) return null
  return raw
}

/** The path with its percent-escapes decoded until nothing changes (at most three rounds), or null when it does
 * not decode, does not settle, or decodes into a slash, a backslash or a control character. */
function decoded(path: string): string | null {
  let now = path
  for (let i = 0; i < 3; i++) {
    let next: string
    try {
      next = decodeURIComponent(now)
    } catch {
      return null
    }
    if (next === now) return now
    // eslint-disable-next-line no-control-regex
    if (/[\\\u0000-\u001f\u007f]/.test(next) || next.split('/').length !== now.split('/').length) return null
    now = next
  }
  return null
}

/** The `next` in a query string (`location.search`), when it is safe to follow. */
export function nextFrom(search: string): string | null {
  return safeNext(new URLSearchParams(search).get('next'))
}

/**
 * Where to go once signed in: the Production Tool's `next` when it is safe
 * (safeNext), else a reload into the studio.
 */
export function afterSignIn(search: string, go: (path: string) => void, reload: () => void): void {
  const next = nextFrom(search)
  if (next) go(next)
  else reload()
}

/**
 * A person already signed in who lands on `/?next=...` goes straight on, but
 * only when the server serves the tool (`production`), so a server without it
 * can never bounce them back and forth.
 */
export function nextWhenSignedIn(search: string, session: unknown): string | null {
  const s = session as { user?: unknown; production?: unknown } | null
  return s && s.user && s.production === true ? nextFrom(search) : null
}
