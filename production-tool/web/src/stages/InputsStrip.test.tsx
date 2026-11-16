// @vitest-environment happy-dom
// The inputs strip a node card shows (ui-behaviour 3.16, item 1): one chip per link into the node,
// changing as soon as a link is made or taken away.

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { ServicesContext, type Services } from '../app/context'
import type { Link, ProductionDocument } from '../contracts/types'
import { SnapshotDocumentStore } from '../doc/store'
import { loadJson } from '../test/schemas'
import { InputsStrip, ScopeLine } from './InputsStrip'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ex = loadJson<ProductionDocument>('examples/document.ad.json')
const SCRIPT = 'script_01K7A00000000000000000000Z'
const SB = 'storyboard_01K7A000000000000000000012'
const GOLDEN = 'ref_01K7A00000000000000000000R'

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

function mount(node: ReturnType<typeof createElement>) {
  const doc = new SnapshotDocumentStore(structuredClone(ex), null)
  const el = document.createElement('div')
  document.body.appendChild(el)
  act(() => {
    root = createRoot(el)
    root.render(createElement(ServicesContext.Provider, { value: { doc } as unknown as Services }, node))
  })
  return { doc, el }
}

describe('the inputs strip', () => {
  it('shows a chip per link into the node, and follows a link added and removed', async () => {
    const { doc, el } = mount(createElement(InputsStrip, { nodeId: SCRIPT }))
    const chips = () => [...el.querySelectorAll('.in-chip')].map((c) => c.textContent)
    expect(chips()).toEqual(['client_notes.docx · 2 pages'])
    const l: Link = { id: 'link_new', v: 1, field_v: {}, from: { kind: 'ref', id: GOLDEN }, to: { kind: 'script', id: SCRIPT }, role: 'lighting' }
    await act(async () => { await doc.change((d) => { d.links[l.id] = l }, { action: 'link' }) })
    expect(chips()).toEqual(['golden hour · lighting', 'client_notes.docx · 2 pages'])
    await act(async () => { await doc.change((d) => { delete d.links[l.id] }, { action: 'unlink' }) })
    expect(chips()).toEqual(['client_notes.docx · 2 pages'])
  })

  it('counts what does not fit', () => {
    const { el } = mount(createElement(InputsStrip, { nodeId: SB }))
    expect(el.querySelector('.in-more')?.textContent).toBe('+2')
  })

  it('the editor\'s scope line lists references with their shots and flags names with no reference', async () => {
    const { doc, el } = mount(createElement(ScopeLine, { nodeId: SB, shotNumber: (id: string) => Number(id.slice(-2)) - 14 }))
    await act(async () => { await doc.change((d) => { d.shots['shot_01K7A000000000000000000016'].action = 'A @jogger runs.' }, { action: 'edit' }) })
    const refs = [...el.querySelectorAll('.in-refs .in-chip')].map((c) => c.textContent)
    expect(refs).toContain('@maya_front1')
    expect(refs).toContain('@joggerno ref yet2')
  })
})
