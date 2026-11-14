// Routes under both bases: '/' (dev, tests) and '/production/' (behind napkin-web).

import { describe, expect, it } from 'vitest'
import { formatRoute, parseRoute, Router, scriptRoute, type HistoryLike } from './route'

const P = 'p_01HZY'
const S = 'script_01J0000000000000000000000A'
const H = 'shot_01J0000000000000000000000B'

describe('parseRoute and formatRoute', () => {
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
