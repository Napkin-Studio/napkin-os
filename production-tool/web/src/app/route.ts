// Routes (ui-behaviour 2.1-2.4; features/script-editor.clan): a small router on the
// history API, under the build's base (import.meta.env.BASE_URL: '/' in dev and tests,
// '/production/' behind napkin-web, which serves index.html for any /production/* path).
//
// The open project has its own route, /p/:project (the canvas), /p/:project/storyboard and
// /p/:project/video (the editors over it), so a reload, a link or Share returns there (live test
// 2026-11-16: all of them stayed at the base). The Film editor's rooms each have one too,
// /p/:project/video/make, /edit and /sound, so Back and a reload come back to the same room.
// The Script editor is /p/:project/script/:script.
// Ids in URLs are document ids, never shot numbers; query parameters carry focus, never content
// (?shot=<shotId>; the Image editor open on a storyboard shot's frame: /p/:project/storyboard?frame=<shotId>,
// so a reload reopens it).
//
// The project id in a route is the id Shell.open takes: the project's entry in this
// browser, which for a server project is the same SavedProject id (projects/shell.ts
// openFromServer opens it "under the same id"), never the document's proj_ id.

/** The editors over the canvas with a route of their own (the canvas is the project's route). */
export type StageRoute = 'storyboard' | 'video'

/** The Film editor's rooms (rooms/Rooms.tsx): Make, Edit, and Sound over them. */
export type RoomRoute = 'make' | 'edit' | 'sound'
const ROOMS: readonly RoomRoute[] = ['make', 'edit', 'sound']

export type Route =
  | { kind: 'none' }
  | { kind: 'project'; projectId: string; stage?: StageRoute; room?: RoomRoute; frame?: string }
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
  // The shell's open path (stage 1): /production/?doc=<library document id>. The id is the project's id here.
  if (!path) {
    const doc = new URLSearchParams(url.search ?? '').get('doc')
    return doc && ID.test(doc) ? { kind: 'project', projectId: doc } : { kind: 'none' }
  }
  const parts = path.split('/').filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p)
    } catch {
      return ''
    }
  })
  if ((parts.length >= 2 && parts.length <= 4) && parts[0] === 'p' && ID.test(parts[1])) {
    if (parts.length === 2) return { kind: 'project', projectId: parts[1] }
    if (parts.length === 3 && parts[2] === 'storyboard') {
      const frame = new URLSearchParams(url.search ?? '').get('frame')
      return { kind: 'project', projectId: parts[1], stage: 'storyboard', ...(frame && ID.test(frame) ? { frame } : {}) }
    }
    if (parts.length === 3 && parts[2] === 'video') return { kind: 'project', projectId: parts[1], stage: 'video' }
    if (parts.length === 4 && parts[2] === 'video' && (ROOMS as readonly string[]).includes(parts[3])) return { kind: 'project', projectId: parts[1], stage: 'video', room: parts[3] as RoomRoute }
    if (parts.length === 4 && parts[2] === 'script' && ID.test(parts[3])) {
      const shot = new URLSearchParams(url.search ?? '').get('shot')
      return { kind: 'script', projectId: parts[1], scriptId: parts[3], ...(shot && ID.test(shot) ? { shot } : {}) }
    }
    return { kind: 'none' }
  }
  return { kind: 'none' }
}

/** The URL of a route under `base` (a path with its query). */
export function formatRoute(r: Route, base: string = import.meta.env.BASE_URL): string {
  const b = baseOf(base)
  if (r.kind === 'none') return b
  if (r.kind === 'project') {
    const frame = r.stage === 'storyboard' && r.frame ? `?frame=${encodeURIComponent(r.frame)}` : ''
    return `${b}p/${encodeURIComponent(r.projectId)}${r.stage ? `/${r.stage}` : ''}${r.stage === 'video' && r.room ? `/${r.room}` : ''}${frame}`
  }
  const q = r.shot ? `?shot=${encodeURIComponent(r.shot)}` : ''
  return `${b}p/${encodeURIComponent(r.projectId)}/script/${encodeURIComponent(r.scriptId)}${q}`
}

/** The Script editor's route: what 'Open script', canvas-nodes' NodeRegistry and 'Copy link to this' call. */
export function scriptRoute(projectId: string, scriptId: string, shot?: string): Route {
  return { kind: 'script', projectId, scriptId, ...(shot ? { shot } : {}) }
}

/** The open project's route at a stage: the canvas is the project itself; the Film editor in one of its rooms. */
export function projectRoute(projectId: string, stage: 'character' | StageRoute = 'character', room?: RoomRoute): Route {
  return { kind: 'project', projectId, ...(stage === 'character' ? {} : { stage }), ...(stage === 'video' && room ? { room } : {}) }
}

/** The Storyboard with the Image editor open on a shot's frame (none: closed). */
export function frameRoute(projectId: string, shotId: string | null): Route {
  return { kind: 'project', projectId, stage: 'storyboard', ...(shotId ? { frame: shotId } : {}) }
}

/** The Film editor's room a route names; Make when it names none. */
export const routeRoom = (r: Route): RoomRoute => (r.kind === 'project' && r.stage === 'video' && r.room) || 'make'

/** The project a route belongs to, if any. */
export const routeProject = (r: Route): string | undefined => (r.kind === 'none' ? undefined : r.projectId)

/** Where the URL should be with this project open at `stage`, or null to leave it: an editor route of this
 *  project (the Script editor's) stays, and so does the right project route. */
export function routeFor(projectId: string, stage: 'character' | StageRoute, now: Route): Route | null {
  if (now.kind === 'script' && now.projectId === projectId) return null
  // In the Film editor the room in the URL stays (rooms/Rooms.tsx writes it as the person switches).
  const room = stage === 'video' && now.kind === 'project' && now.projectId === projectId && now.stage === 'video' ? now.room : undefined
  // On the Storyboard the frame open in the Image editor stays (stages/Storyboard.tsx writes it).
  const frame = stage === 'storyboard' && now.kind === 'project' && now.projectId === projectId && now.stage === 'storyboard' ? now.frame : undefined
  const want = { ...projectRoute(projectId, stage, room), ...(frame ? { frame } : {}) } as Route
  return sameRoute(want, now) ? null : want
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
