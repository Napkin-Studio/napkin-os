// @vitest-environment happy-dom
// "Rights?" on an upload (features/prod-assets-route.clan): one small choice, never a modal.

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { ClanDocumentStore } from '../../../../clan-store/src'
import { ServicesContext, ShellContext, type Services } from '../../app/context'
import { SnapshotStore, systemUpdate } from '../../doc/store'
import { initialAppUi, type AppUi } from '../../doc/ui'
import { ModelStore } from '../../model/store'
import { ProjectIndex } from '../../projects/projectIndex'
import type { MakeClan } from '../../projects/session'
import { Shell } from '../../projects/shell'
import { memoryStorage } from '../../projects/storage'
import { MockRelay } from '../../relay/mock'
import { asset, SHA, wasm } from '../../test/model'
import { RightsChip } from './RightsChip'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const makeClan: MakeClan = (persistence, opts = {}) =>
  new ModelStore(new ClanDocumentStore({ wasm: wasm(), persistence, saveDebounceMs: 0, person: opts.person }), { debounceMs: 1, undo: opts.undo })

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
  try { localStorage.clear() } catch { /* none here */ }
})

async function mount(rights: 'unknown' | 'own', origin: 'uploaded' | 'generated' = 'uploaded') {
  const storage = memoryStorage()
  const index = new ProjectIndex(storage, () => new Date('2026-11-19T10:00:00Z'))
  const app = new SnapshotStore<AppUi>(initialAppUi(), null)
  const relay = new MockRelay({ renderer: { async render() { return [] } }, delayMs: 2000, persistKey: null })
  const shell = new Shell({ relay, app, index, storage, remoteConfig: null, makeClan, summaryDelayMs: 1 })
  await shell.newProject()
  const services: Services = shell.get().session!.services
  await systemUpdate(services.doc, (d) => { d.assets[SHA('a')] = asset(SHA('a'), 'image', { origin, rights }) })
  await services.doc.flush()
  const el = document.createElement('div')
  document.body.appendChild(el)
  act(() => {
    root = createRoot(el)
    root.render(createElement(ShellContext.Provider, { value: shell },
      createElement(ServicesContext.Provider, { value: services }, createElement(RightsChip, { sha: SHA('a'), at: { x: 10, y: 10 } }))))
  })
  return { el, services }
}

const chip = () => document.querySelector<HTMLButtonElement>('.rights-chip')
const item = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent?.startsWith(text))

describe('Rights? on an upload', () => {
  it('asks while the rights are unknown; a choice sets them and the chip goes', async () => {
    const { services } = await mount('unknown')
    expect(chip()?.textContent).toBe('Rights?')
    act(() => chip()!.click())
    expect([...document.querySelectorAll('[role="menuitem"]')].map((b) => b.firstChild?.textContent)).toEqual(['Ours', 'Licensed', 'Made with AI', 'Not sure'])
    await act(async () => { item('Licensed')!.click(); await services.doc.flush() })
    expect(services.doc.get().assets[SHA('a')].rights).toBe('licensed')
    expect(chip()).toBeNull()
  })

  it('Not sure hides it and leaves the rights unknown', async () => {
    const { services } = await mount('unknown')
    act(() => chip()!.click())
    act(() => item('Not sure')!.click())
    expect(chip()).toBeNull()
    expect(services.doc.get().assets[SHA('a')].rights).toBe('unknown')
  })

  it('never shows for a picture whose rights are said, or one the crew made', async () => {
    await mount('own')
    expect(chip()).toBeNull()
  })
})
