// Routes (ui-behaviour 2.1-2.4; features/script-editor.clan): a small router on the
// history API, under the build's base (import.meta.env.BASE_URL: '/' in dev and tests,
// '/production/' behind napkin-web, which serves index.html for any /production/* path).
//
// Only the editors have routes for now. The project itself stays at the base URL until
// canvas-nodes gives the canvas its own (/p/:project). Ids in URLs are document ids, never
// shot numbers; query parameters carry focus, never content (?shot=<shotId>).
//
// The project id in a route is the id Shell.open takes: the project's entry in this
// browser, which for a server project is the same SavedProject id (projects/shell.ts
// openFromServer opens it "under the same id"), never the document's proj_ id.

export type Route =
  | { kind: 'none' }
  | { kind: 'script'; projectId: string; scriptId: string; shot?: string }

const ID = /^[A-Za-z0-9_-]{1,80}$/

/** The base with exactly one trailing slash ('/', '/production/'). */
function baseOf(base: string): string {
  return base.endsWith('/') ? base : `${base}/`
}

/** The route a URL names under `base`, or none. */
export function parseRoute(url: { pathname: string; search?: string }, base: string = import.meta.env.BASE_URL): Route {
  const b = baseOf(base)
  let path = url.pathname
  if (!path.startsWith(b)) {
    // '/production' without its slash is the base too.
    if (`${path}/` === b) return { kind: 'none' }
    return { kind: 'none' }
  }
  path = path.slice(b.length)
  const parts = path.split('/').filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p)
    } catch {
      return ''
    }
  })
  if (parts.length === 4 && parts[0] === 'p' && parts[2] === 'script' && ID.test(parts[1]) && ID.test(parts[3])) {
    const shot = new URLSearchParams(url.search ?? '').get('shot')
    return { kind: 'script', projectId: parts[1], scriptId: parts[3], ...(shot && ID.test(shot) ? { shot } : {}) }
  }
  return { kind: 'none' }
}

/** The URL of a route under `base` (a path with its query). */
export function formatRoute(r: Route, base: string = import.meta.env.BASE_URL): string {
  const b = baseOf(base)
  if (r.kind === 'none') return b
  const q = r.shot ? `?shot=${encodeURIComponent(r.shot)}` : ''
  return `${b}p/${encodeURIComponent(r.projectId)}/script/${encodeURIComponent(r.scriptId)}${q}`
}

/** The Script editor's route: what 'Open script', canvas-nodes' NodeRegistry and 'Copy link to this' call. */
export function scriptRoute(projectId: string, scriptId: string, shot?: string): Route {
  return { kind: 'script', projectId, scriptId, ...(shot ? { shot } : {}) }
}

export function sameRoute(a: Route, b: Route): boolean {
  return formatRoute(a, '/') === formatRoute(b, '/')
}

/** The history API, or a stand-in (tests, a page without one). */
export interface HistoryLike {
  pushState(data: unknown, unused: string, url?: string | URL | null): void
  replaceState(data: unknown, unused: string, url?: string | URL | null): void
  back(): void
  readonly state: unknown
}

interface Marked { napkinRoute?: number }

/**
 * The route now, and the way between routes. An entry this router pushed is marked in
 * history.state, so Back from an editor pops it when the person came from inside the app,
 * and replaces it with the base when they arrived by a deep link (no history to pop).
 */
export class Router {
  private route: Route
  private readonly listeners = new Set<() => void>()
  private readonly base: string
  private readonly history: HistoryLike
  private readonly location: { pathname: string; search: string }
  private depth: number

  constructor(opts: { base?: string; history?: HistoryLike; location?: { pathname: string; search: string }; win?: Pick<Window, 'addEventListener'> } = {}) {
    this.base = opts.base ?? import.meta.env.BASE_URL
    this.history = opts.history ?? window.history
    this.location = opts.location ?? window.location
    this.route = parseRoute(this.location, this.base)
    this.depth = (this.history.state as Marked | null)?.napkinRoute ?? 0
    ;(opts.win ?? (typeof window === 'undefined' ? undefined : window))?.addEventListener('popstate', () => {
      this.depth = (this.history.state as Marked | null)?.napkinRoute ?? 0
      this.set(parseRoute(this.location, this.base))
    })
  }

  get = (): Route => this.route

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Go to a route, as a new history entry (Back returns). */
  push(r: Route) {
    if (sameRoute(r, this.route)) return
    this.depth += 1
    this.history.pushState({ napkinRoute: this.depth } satisfies Marked, '', formatRoute(r, this.base))
    this.set(r)
  }

  /** Change the route in place (focus moves: ?shot=). */
  replace(r: Route) {
    if (sameRoute(r, this.route)) return
    this.history.replaceState({ napkinRoute: this.depth } satisfies Marked, '', formatRoute(r, this.base))
    this.set(r)
  }

  /** Leave the route: pop it when the app pushed it, else replace it with the base (a deep link). */
  leave() {
    if (this.depth > 0) {
      this.history.back()
      return
    }
    this.replace({ kind: 'none' })
  }

  private set(r: Route) {
    this.route = r
    for (const fn of this.listeners) fn()
  }
}
