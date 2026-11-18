// @vitest-environment happy-dom
// The Brief node's compact card and its Booth (features/production-new-ui.clan P2; mock v2.1): the card shows
// the title, version, proposition and tone; the whole spine, its sources, what it feeds and the update call
// are in the Booth when it is selected.

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { ServicesContext, type Services } from '../app/context'
import type { ProductionDocument } from '../contracts/types'
import { systemUpdate } from '../doc/store'
import { MAYA, modelStore } from '../test/model'
import { BriefBooth } from './BriefBooth'
import { BriefCard } from './BriefCard'
import { newBrief } from './model'
import type { BriefSource, OsBriefRead } from './os'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SHA = (c: string) => `sha256:${c.repeat(64)}`
const DATA = {
  project_name: 'Colour of the market',
  insight: 'Market cloth is bought slowly.',
  single_minded_proposition: 'Every colour has a story.',
  audience: 'Women 25–45 who buy cloth at the market.',
  tone_and_world: ['Warm, busy, generous'],
  mandatories: ['Kora logo on the end card', 'No price talk'],
}
const read = (data: unknown = DATA, sha = SHA('b')): OsBriefRead => ({ documentId: 'doc-market', title: 'Colour of the market', appId: 'ie.napkin.brief-maker', dataSha256: sha, data })
const src = (now: OsBriefRead): BriefSource => ({ available: async () => true, list: async () => [], read: async () => now, openUrl: (id) => `/app/brief-maker?doc=${id}` })

let root: Root | null = null
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = '' })

async function project() {
  const store = modelStore()
  await store.create(MAYA, 'Market day')
  const b = newBrief(read(), 'link')
  await systemUpdate(store, (d) => { d.briefs = { ...(d.briefs ?? {}), [b.id]: b } }, 'seed')
  return { store, id: b.id }
}

describe('the Brief node card', () => {
  it('is compact: title, version, proposition and tone, frozen at vN, Open in Brief Maker', async () => {
    const { store, id } = await project()
    const html = renderToStaticMarkup(createElement(BriefCard, { doc: store.get() as ProductionDocument, id, openUrl: '/app/brief-maker?doc=doc-market' }))
    expect(html).toContain('Colour of the market')
    expect(html).toContain('v1 · locked')
    expect(html).toContain('Every colour has a story.')
    expect(html).toContain('Warm, busy, generous')
    expect(html).not.toContain('Market cloth is bought slowly.') // the insight is the Booth's
    expect(html).toContain('Frozen at v1')
    expect(html).toContain('Open in Brief Maker')
  })
})

describe('the Booth on a selected Brief node', () => {
  async function mount(now: OsBriefRead) {
    const { store, id } = await project()
    const el = document.createElement('div')
    document.body.appendChild(el)
    const services = { doc: store } as unknown as Services
    await act(async () => {
      root = createRoot(el)
      root.render(createElement(ServicesContext.Provider, { value: services }, createElement(BriefBooth, { briefId: id, onClose: () => {}, src: src(now) })))
    })
    return { el, store, id }
  }
  it('shows the whole spine with where each line came from', async () => {
    const { el } = await mount(read())
    expect(el.textContent).toContain('Market cloth is bought slowly.')
    expect(el.textContent).toContain('Kora logo on the end card')
    expect(el.querySelectorAll('.src-mini').length).toBeGreaterThan(3)
    expect(el.textContent).toContain('Not linked yet')
  })
  it('a newer version in Brief Maker: what changed, then Update to v2 takes it', async () => {
    const { el, store, id } = await mount(read({ ...DATA, audience: 'Women and men 25–45.' }, SHA('c')))
    const btn = (t: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.startsWith(t)) as HTMLButtonElement
    await act(async () => { btn('Check for a newer version').click(); await new Promise((r) => setTimeout(r, 10)) })
    expect(el.textContent).toContain('Brief changed: update?')
    expect(el.querySelector('ins')?.textContent).toContain('Women and men')
    await act(async () => { btn('Update to v2').click(); await new Promise((r) => setTimeout(r, 20)) })
    expect(store.get().briefs![id].source.taken).toBe(2)
  })
})
