// A link to a project opens it at its stage (live test 2026-11-16: only the Script editor had a route).
import { describe, expect, it, vi } from 'vitest'
import { openRouteProject } from './routeOpen'
import { projectRoute, scriptRoute, type Route } from './route'

function fakes(route: Route, onThisBrowser: boolean) {
  const ui = { stage: 'character' as string }
  const shell = {
    index: { get: (id: string) => (onThisBrowser && id === 'p1' ? { id } : undefined) },
    open: vi.fn(async () => {}),
    serverProjects: vi.fn(async () => [{ id: 'p1' }]),
    openFromServer: vi.fn(async () => {}),
    say: vi.fn(),
    get: () => ({ session: { services: { ui: { update: (fn: (u: typeof ui) => void) => fn(ui) } } } }),
  }
  const router = { get: () => route, replace: vi.fn() }
  return { shell, router, ui }
}

describe('opening the project a link names', () => {
  it('a project route opens it at its stage, from this browser or the relay', async () => {
    const a = fakes(projectRoute('p1', 'video'), true)
    expect(await openRouteProject(a.shell as never, a.router as never)).toBe(true)
    expect(a.shell.open).toHaveBeenCalledWith('p1')
    expect(a.ui.stage).toBe('video')
    const b = fakes(projectRoute('p1'), false)
    expect(await openRouteProject(b.shell as never, b.router as never)).toBe(true)
    expect(b.shell.openFromServer).toHaveBeenCalled()
    expect(b.ui.stage).toBe('character')
  })
  it('a room\'s route opens the Film editor (the room is read from the route there)', async () => {
    const a = fakes(projectRoute('p1', 'video', 'edit'), true)
    expect(await openRouteProject(a.shell as never, a.router as never)).toBe(true)
    expect(a.ui.stage).toBe('video')
  })
  it('the Script editor opens over the Storyboard; no route opens nothing', async () => {
    const a = fakes(scriptRoute('p1', 'script_1'), true)
    expect(await openRouteProject(a.shell as never, a.router as never)).toBe(true)
    expect(a.ui.stage).toBe('storyboard')
    const none = fakes({ kind: 'none' }, true)
    expect(await openRouteProject(none.shell as never, none.router as never)).toBe(false)
  })
})
