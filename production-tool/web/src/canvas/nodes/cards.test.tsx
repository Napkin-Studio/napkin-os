// The node cards with more than one node of a kind (features/canvas-nodes.clan): each card shows its
// own entity, never the project's main one, and an empty node's card draws the chrome's PromptStart
// slot in place of its "No script yet" line (ui-behaviour 3.3 Empty), when the chrome lends one.

import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// Server rendering has no store subscriptions: the hooks read the services' stores as they are.
vi.mock('../../app/context', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../app/context')>()
  return { ...real, useDoc: () => real.useServices().doc.get(), useUi: () => real.useServices().ui.get(), useJobsTick: () => 0 }
})
vi.mock('../../ui/useDownload', () => ({ useProjectName: () => 'Lumen Water · First Light' }))

import { ServicesContext, type Services } from '../../app/context'
import type { ProductionDocument } from '../../contracts/types'
import { initialUi } from '../../doc/ui'
import { mainScript, mainStoryboard } from '../../model/selectors'
import { addScene, snapshotDoc } from '../../test/jobFixtures'
import { CardChromeContext, DEFAULT_CHROME, type CardChrome } from './cardChrome'
import { NodeCard } from './cards'
import { newEntity } from './nodes'

function project() {
  const store = snapshotDoc()
  const d = structuredClone(store.get()) as ProductionDocument
  addScene(d, 'Maya runs through the rain to the bus stop.')
  const extra = { script: newEntity(d, 'script'), storyboard: newEntity(d, 'storyboard'), video: newEntity(d, 'video') }
  d.scripts[extra.script.entity.id] = extra.script.entity as never
  d.storyboards[extra.storyboard.entity.id] = extra.storyboard.entity as never
  d.videos[extra.video.entity.id] = extra.video.entity as never
  const services = { doc: { get: () => d, onChange: () => () => {} }, ui: { get: () => initialUi(), subscribe: () => () => {} } } as unknown as Services
  return { d, services, ids: { script: extra.script.entity.id, storyboard: extra.storyboard.entity.id, video: extra.video.entity.id } }
}

const render = (services: Services, chrome: CardChrome, node: ReactNode) =>
  renderToStaticMarkup(createElement(ServicesContext.Provider, { value: services }, createElement(CardChromeContext.Provider, { value: chrome }, node)))

const START: CardChrome = { ...DEFAULT_CHROME, PromptStart: ({ kind, nodeId }) => createElement('div', { 'data-start': `${kind}:${nodeId}` }, `Start ${kind}`) }

describe('node cards, one per node (+ Node; ui-behaviour 3.3)', () => {
  it('a second script\'s card shows its own title and words, not the main script\'s', () => {
    const { d, services, ids } = project()
    const main = render(services, DEFAULT_CHROME, createElement(NodeCard, { kind: 'script', id: mainScript(d)!.id, onOpen: () => {} }))
    const second = render(services, DEFAULT_CHROME, createElement(NodeCard, { kind: 'script', id: ids.script, onOpen: () => {} }))
    expect(main).toContain('Maya runs through the rain')
    expect(second).toContain('Script · Script 2')
    expect(second).not.toContain('Maya runs through the rain')
    expect(second).toContain('No script yet')
  })

  it('an empty node draws the chrome\'s PromptStart for its kind and id; a node with work does not', () => {
    const { d, services, ids } = project()
    for (const kind of ['script', 'storyboard', 'video'] as const) {
      const html = render(services, START, createElement(NodeCard, { kind, id: ids[kind], onOpen: () => {} }))
      expect(html).toContain(`data-start="${kind}:${ids[kind]}"`)
    }
    // The main script has words: no start on it.
    expect(render(services, START, createElement(NodeCard, { kind: 'script', id: mainScript(d)!.id, onOpen: () => {} }))).not.toContain('data-start')
    // Without a PromptStart (the default chrome) the empty card keeps its line.
    expect(render(services, DEFAULT_CHROME, createElement(NodeCard, { kind: 'storyboard', id: ids.storyboard, onOpen: () => {} }))).toContain('No shots yet')
  })

  it('a card without an id is the main one (the Excalidraw overlay)', () => {
    const { d, services } = project()
    const html = render(services, DEFAULT_CHROME, createElement(NodeCard, { kind: 'storyboard', onOpen: () => {} }))
    expect(html).toContain(`${mainStoryboard(d)!.ratio} · 0 shots`)
  })
})
