// Routes under both bases: '/' (dev, tests) and '/production/' (behind napkin-web).

import { describe, expect, it } from 'vitest'
import { formatRoute, frameRoute, parseRoute, projectRoute, routeFor, routeProject, routeRoom, Router, scriptRoute, type HistoryLike } from './route'

const P = 'p_01HZY'
const S = 'script_01J0000000000000000000000A'
const H = 'shot_01J0000000000000000000000B'

describe('parseRoute and formatRoute', () => {
  it('the Image editor on a storyboard shot\u2019s frame is in the URL, so a reload reopens it (re-test 8d)', () => {
    const P = 'prj_01M7PQ2AQP857QJ78395QNZBXA'
    const r = frameRoute(P, 'shot_01M7PQ2AQP857QJ78395QNZBXB')
    expect(formatRoute(r, '/production/')).toBe(`/production/p/${P}/storyboard?frame=shot_01M7PQ2AQP857QJ78395QNZBXB`)
    expect(parseRoute({ pathname: `/production/p/${P}/storyboard`, search: '?frame=shot_01M7PQ2AQP857QJ78395QNZBXB' }, '/production/')).toEqual(r)
    expect(formatRoute(frameRoute(P, null), '/production/')).toBe(`/production/p/${P}/storyboard`)
    // The App's sync keeps it while the Storyboard is the stage, and drops it when the stage changes.
    expect(routeFor(P, 'storyboard', r)).toBeNull()
    expect(routeFor(P, 'character', r)).toEqual(projectRoute(P))
  })
  for (const base of ['/', '/production/']) {
    it(`round-trip under ${base}`, () => {
      const r = scriptRoute(P, S, H)
      const url = formatRoute(r, base)
      expect(url).toBe(`${base}p/${P}/script/${S}?shot=${H}`)
      const [pathname, search] = url.split('?')
      expect(parseRoute({ pathname, search: `?${search}` }, base)).toEqual(r)
      expect(parseRoute({ pathname }, base)).toEqual(scriptRoute(P, S))
      expect(parseRoute({ pathname: base }, base)).toEqual({ kind: 'none' })
    })
  }

  for (const base of ['/', '/production/']) {
    it(`the project and its editors have routes under ${base} (reload, links and Share return there)`, () => {
      for (const [stage, path] of [['character', ''], ['storyboard', '/storyboard'], ['video', '/video']] as const) {
        const r = projectRoute(P, stage)
        expect(formatRoute(r, base)).toBe(`${base}p/${P}${path}`)
        expect(parseRoute({ pathname: formatRoute(r, base) }, base)).toEqual(r)
        expect(routeProject(r)).toBe(P)
      }
      expect(parseRoute({ pathname: `${base}p/${P}/sound` }, base)).toEqual({ kind: 'none' })
    })
  }

  for (const base of ['/', '/production/']) {
    it(`each Film editor room has its own route under ${base} (reload, Back and Share return to the room)`, () => {
      for (const room of ['make', 'edit', 'sound'] as const) {
        const r = projectRoute(P, 'video', room)
        expect(formatRoute(r, base)).toBe(`${base}p/${P}/video/${room}`)
        expect(parseRoute({ pathname: formatRoute(r, base) }, base)).toEqual(r)
        expect(routeRoom(r)).toBe(room)
        expect(routeProject(r)).toBe(P)
      }
      // The Film editor with no room is Make; a room is only a Film editor's.
      expect(routeRoom(projectRoute(P, 'video'))).toBe('make')
      expect(formatRoute(projectRoute(P, 'storyboard', 'edit'), base)).toBe(`${base}p/${P}/storyboard`)
      expect(parseRoute({ pathname: `${base}p/${P}/video/cut` }, base)).toEqual({ kind: 'none' })
      expect(parseRoute({ pathname: `${base}p/${P}/storyboard/edit` }, base)).toEqual({ kind: 'none' })
    })
  }

  it('the open project keeps the Film editor\'s room in the URL, and drops it on leaving', () => {
    expect(routeFor(P, 'video', projectRoute(P, 'video', 'edit'))).toBeNull()
    expect(routeFor(P, 'video', projectRoute(P, 'video', 'sound'))).toBeNull()
    expect(routeFor(P, 'character', projectRoute(P, 'video', 'edit'))).toEqual(projectRoute(P))
    expect(routeFor(P, 'video', projectRoute('p_other', 'video', 'edit'))).toEqual(projectRoute(P, 'video'))
  })

  it('the open project writes its route, and leaves the Script editor\'s alone', () => {
    expect(routeFor(P, 'character', { kind: 'none' })).toEqual(projectRoute(P))
    expect(routeFor(P, 'storyboard', projectRoute(P))).toEqual(projectRoute(P, 'storyboard'))
    expect(routeFor(P, 'video', projectRoute(P, 'video'))).toBeNull()
    expect(routeFor(P, 'storyboard', scriptRoute(P, S))).toBeNull()
    expect(routeFor(P, 'character', scriptRoute('p_other', S))).toEqual(projectRoute(P))
    expect(routeFor(P, 'character', projectRoute('p_other', 'video'))).toEqual(projectRoute(P))
    expect(routeProject({ kind: 'none' })).toBeUndefined()
  })

  it('is none outside the base, for unknown paths and for bad ids', () => {
    expect(parseRoute({ pathname: `/p/${P}/script/${S}` }, '/production/')).toEqual({ kind: 'none' })
    expect(parseRoute({ pathname: '/production' }, '/production/')).toEqual({ kind: 'none' })
    expect(parseRoute({ pathname: `/production/p/${P}/frame/x` }, '/production/')).toEqual({ kind: 'none' })
    expect(parseRoute({ pathname: `/p/${P}/script/a%2Fb` }, '/')).toEqual({ kind: 'none' })
    expect(parseRoute({ pathname: `/p/${P}/script/${S}`, search: '?shot=<x>' }, '/')).toEqual(scriptRoute(P, S))
  })
})

function fakeHistory(start: string) {
  const entries: { url: string; state: unknown }[] = [{ url: start, state: null }]
  let i = 0
  const loc = { pathname: start, search: '' }
  let onPop: (() => void) | null = null
  const sync = () => {
    const [p, q] = entries[i].url.split('?')
    loc.pathname = p
    loc.search = q ? `?${q}` : ''
  }
  const history: HistoryLike = {
    pushState(state, _u, url) {
      entries.splice(i + 1)
      entries.push({ url: String(url), state })
      i++
      sync()
    },
    replaceState(state, _u, url) {
      entries[i] = { url: String(url), state }
      sync()
    },
    back() {
      if (i > 0) i--
      sync()
      onPop?.()
    },
    get state() {
      return entries[i].state
    },
  }
  return { history, loc, entries: () => entries.map((e) => e.url), win: { addEventListener: (_t: string, fn: () => void) => { onPop = fn } } }
}

describe('Router', () => {
  it('push then leave pops back to where the person was', () => {
    const h = fakeHistory('/production/')
    const r = new Router({ base: '/production/', history: h.history, location: h.loc, win: h.win as never })
    r.push(scriptRoute(P, S))
    expect(r.get()).toEqual(scriptRoute(P, S))
    r.replace(scriptRoute(P, S, H))
    expect(h.loc.search).toBe(`?shot=${H}`)
    r.leave()
    expect(r.get()).toEqual({ kind: 'none' })
    expect(h.entries()).toHaveLength(2)
  })

  it('a deep link with no history leaves by replacing the route with the base', () => {
    const h = fakeHistory(`/production/p/${P}/script/${S}`)
    const r = new Router({ base: '/production/', history: h.history, location: h.loc, win: h.win as never })
    expect(r.get()).toEqual(scriptRoute(P, S))
    r.leave()
    expect(r.get()).toEqual({ kind: 'none' })
    expect(h.entries()).toEqual(['/production/'])
  })
})
