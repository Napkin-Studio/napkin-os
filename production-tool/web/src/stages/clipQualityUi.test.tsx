// @vitest-environment happy-dom
// Quality on screen (features/clip-quality.clan): the chip beside Model greys a level the model cannot make
// with why, the Make clips tray says the level and the output size before sending (never a price), and the
// level picked there is what is sent.

import { act, createElement, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ServicesContext, type Services } from '../app/context'
import type { ProductionDocument } from '../contracts/types'
import { SnapshotDocumentStore, SnapshotStore } from '../doc/store'
import { initialUi, type UiState } from '../doc/ui'
import { loadJson } from '../test/schemas'
import { QualityPick } from '../ui/QualityPick'
import { ClipTray } from './ClipTray'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ex = loadJson<ProductionDocument>('examples/document.ad.json')
const SHOT = 'shot_01K7A000000000000000000015'

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

describe('the Make clips tray', () => {
  it('says the level and the output size, and sends the level picked there', () => {
    const onMake = vi.fn()
    const anchor = createRef<HTMLButtonElement>()
    const shot = ex.shots[SHOT]
    const el = mount(createElement('div', null,
      createElement('button', { ref: anchor }, 'Make clips'),
      createElement(ClipTray, { anchor, open: true, onClose: () => {}, shots: [{ shot, n: 1 }], fromWords: true, ratio: '16:9', quality: 'draft', onMake })))
    const foot = () => document.body.querySelector('.tray-model')?.textContent
    // The model that last worked in this project (Veo 3.1 Fast), at the video's default.
    expect(foot()).toBe('Veo 3.1 Fast on Runway · Draft 720p · 16:9')
    act(() => buttons(document.body)[2].click())
    expect(foot()).toBe('Veo 3.1 Fast on Runway · Final 1080p · 16:9')
    expect(foot()).not.toMatch(/\$|credit/i)
    const make = [...document.body.querySelectorAll<HTMLButtonElement>('.tray-foot button')].find((b) => b.textContent?.startsWith('Make'))!
    act(() => make.click())
    expect(onMake).toHaveBeenCalledWith([SHOT], { provider: 'runway', model: 'veo3.1_fast' }, 'final')
    void el
  })
})
