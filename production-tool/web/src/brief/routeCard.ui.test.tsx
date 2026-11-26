// @vitest-environment happy-dom
// The Territories node's pictures draw in any browser (features/territories-spinoff-out-production.clan): the document holds a hash,
// this browser may hold nothing, and the card asks the session's media base by sha256 (lib/media.ts), as Production does for every
// picture. The quiet captioned tile is for while it loads and for a picture that truly cannot be found. The header names the version.

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BriefNode, RoutePicture, Sha256 } from '../contracts/types'
import { forgetMedia, setMediaBase } from '../lib/media'
import { RouteCard } from './RouteCard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const HEX = (c: string) => c.repeat(64)
const sha = (c: string) => `sha256:${HEX(c)}` as Sha256
const BASE = 'https://media.example.test'

function node(pictures: RoutePicture[], version?: number): BriefNode {
  return {
    id: 'brief_1', v: 1, field_v: {}, title: 'Rail territories',
    source: { document_id: 'doc-t', app_id: 'ie.napkin.territories', data_sha256: sha('a'), taken: 1, at: '2026-11-23T10:00:00Z', how: 'spinoff' },
    spine: {}, route: { id: 'r1', ...(version ? { version } : {}), name: 'Already Started', thought: 'The weekend starts at Platform 4.', pictures },
    carries: { brief: { title: 'Linea brief', v: 3 } },
  } as BriefNode
}

let root: Root | null = null
const mount = async (n: BriefNode) => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root!.render(createElement(RouteCard, { node: n })) })
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  return host
}
const headEverywhere = (held: Set<string>) => vi.fn(async (url: string) => ({ ok: [...held].some((h) => String(url).endsWith(h)) }) as Response)

beforeEach(() => { forgetMedia(); setMediaBase(BASE) })
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ''; forgetMedia(); vi.unstubAllGlobals() })

describe('the Territories node card', () => {
  it('draws a picture by hash in a fresh browser: nothing held locally, found at the media base', async () => {
    const fetchFn = headEverywhere(new Set([`/in/sha256:${HEX('b')}`]))
    vi.stubGlobal('fetch', fetchFn)
    const host = await mount(node([{ sha256: sha('b'), caption: 'tv', rights: 'own' }]))
    const img = host.querySelector('.tn-pic img') as HTMLImageElement
    expect(img?.getAttribute('src')).toBe(`${BASE}/in/sha256:${HEX('b')}`)
    expect(host.querySelector('.tn-pic')?.getAttribute('data-picture')).toBe('found')
    expect(host.querySelector('.tn-pic small')?.textContent).toBe('tv')
    expect(fetchFn).toHaveBeenCalledWith(`${BASE}/in/sha256:${HEX('b')}`, { method: 'HEAD' })
  })

  it('tries out/ too (a provider made it), and a generated picture asks there first', async () => {
    const fetchFn = headEverywhere(new Set([`/out/sha256:${HEX('c')}`]))
    vi.stubGlobal('fetch', fetchFn)
    const host = await mount(node([{ sha256: sha('c'), caption: 'poster', rights: 'generated' }]))
    expect(host.querySelector('.tn-pic img')?.getAttribute('src')).toBe(`${BASE}/out/sha256:${HEX('c')}`)
    expect(fetchFn.mock.calls[0][0]).toBe(`${BASE}/out/sha256:${HEX('c')}`)
  })

  it('keeps the quiet captioned tile while it loads, and when the picture truly cannot be found', async () => {
    const pending: ((v: Response) => void)[] = []
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => { pending.push(r) })))
    const host = await mount(node([{ sha256: sha('d'), caption: 'seat' }]))
    expect(host.querySelector('.tn-pic')?.getAttribute('data-picture')).toBe('loading')
    expect(host.querySelector('.tn-pic img')).toBeNull()
    expect(host.querySelector('.tn-pic .tn-img')).not.toBeNull()
    // in/ answers no, then out/ answers no
    for (let i = 0; i < 2; i++) await act(async () => { pending[i]?.({ ok: false } as Response); await new Promise((r) => setTimeout(r, 20)) })
    expect(pending).toHaveLength(2)
    expect(host.querySelector('.tn-pic')?.getAttribute('data-picture')).toBe('missing')
    expect(host.querySelector('.tn-pic img')).toBeNull()
    expect(host.querySelector('.tn-pic small')?.textContent).toBe('seat')
    expect(host.querySelector('.tn-pic .tn-ch')?.textContent).toBe('Rights to supply')
  })

  it('is a tile, not a broken image, with no media base at all', async () => {
    setMediaBase(null)
    vi.stubGlobal('fetch', vi.fn())
    const host = await mount(node([{ sha256: sha('e'), caption: 'gate' }]))
    expect(host.querySelector('.tn-pic')?.getAttribute('data-picture')).toBe('missing')
    expect(host.querySelector('.tn-pic img')).toBeNull()
  })

  it('names the route version in the header and the brief version in the footer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false }) as Response))
    const host = await mount(node([], 4))
    expect(host.querySelector('.tn-head b')?.textContent).toBe('Territories · Already Started · v4')
    expect(host.querySelector('.tn-foot')?.textContent).toContain('Carries: Brief v3')
  })
})
