// @vitest-environment happy-dom
// Quality on screen (features/clip-quality.clan): the chip beside Model greys a level the model cannot make
// with why, and says a pick. (The legacy Film editor's Make clips tray went with it, owner 2026-11-18.)

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ServicesContext, type Services } from '../app/context'
import type { ProductionDocument } from '../contracts/types'
import { SnapshotDocumentStore, SnapshotStore } from '../doc/store'
import { initialUi, type UiState } from '../doc/ui'
import { loadJson } from '../test/schemas'
import { QualityPick } from '../ui/QualityPick'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ex = loadJson<ProductionDocument>('examples/document.ad.json')

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

function mount(node: ReturnType<typeof createElement>) {
  const doc = new SnapshotDocumentStore(structuredClone(ex), null)
  const ui = new SnapshotStore<UiState>({ ...initialUi(), configChoice: 'live', providerChoice: 'config' })
  const services = { doc, ui, relay: { kind: 'http' }, remoteConfig: null, runner: { subscribe: () => () => {}, getVersion: () => 0 } }
  const el = document.createElement('div')
  document.body.appendChild(el)
  act(() => {
    root = createRoot(el)
    root.render(createElement(ServicesContext.Provider, { value: services as unknown as Services }, node))
  })
  return el
}

const buttons = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.qualitypick button')]

describe('the Quality chip', () => {
  it('marks the level that runs and titles each with its size', () => {
    const el = mount(createElement(QualityPick, { op: 'clip', choice: { provider: 'runway', model: 'gemini_omni_flash_1.1' }, value: 'draft', onChange: () => {} }))
    expect(buttons(el).map((b) => [b.textContent, b.title, b.disabled, b.getAttribute('aria-checked')])).toEqual([
      ['Draft', 'Draft: 360p', false, 'true'], ['Standard', 'Standard: 720p', false, 'false'], ['Final', 'Final: 1080p', false, 'false']])
  })

  it('greys every level on an edit that keeps the clip\'s size, saying why', () => {
    const el = mount(createElement(QualityPick, { op: 'clip_edit', choice: { provider: 'runway', model: 'aleph2' }, value: 'final', onChange: () => {} }))
    expect(buttons(el).every((b) => b.disabled && b.title === "Aleph 2 keeps the clip's own size")).toBe(true)
  })

  it('says a pick', () => {
    const onChange = vi.fn()
    const el = mount(createElement(QualityPick, { op: 'clip', choice: { provider: 'runway', model: 'hailuo3' }, value: 'standard', onChange }))
    act(() => buttons(el)[2].click())
    expect(onChange).toHaveBeenCalledWith('final')
  })
})
