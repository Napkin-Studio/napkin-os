// @vitest-environment happy-dom
// The Script agent's draft fills in place on the Script node (owner 2026-11-18; features/production-new-ui.clan,
// mock canvas-filling): the node shows the draft with Keep and Discard, nothing lands on the script until Keep,
// and Discard leaves the script as it was. Through the real store (modelStore), never a snapshot store.

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../adapter/excalidraw/serialize', () => ({ serializeScene: () => '{}' }))
import { ClanDocumentStore, flatText } from '../../../../clan-store/src'
import { ServicesContext, ShellContext, type Services } from '../../app/context'
import type { Job } from '../../contracts/types'
import { SnapshotStore, systemUpdate } from '../../doc/store'
import { initialAppUi, type AppUi } from '../../doc/ui'
import { ModelStore } from '../../model/store'
import { ProjectIndex } from '../../projects/projectIndex'
import type { MakeClan } from '../../projects/session'
import { Shell } from '../../projects/shell'
import { memoryStorage } from '../../projects/storage'
import { MockRelay } from '../../relay/mock'
import { mockWrites } from '../../relay/mockWrite'
import { addScene } from '../../script/edits'
import { refNames } from '../../script/extensions'
import { landWrites, writeInput } from '../../script/skye'
import { id, MAYA, seedStages, wasm } from '../../test/model'
import { ScriptCard } from './cards'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const makeClan: MakeClan = (persistence, opts = {}) =>
  new ModelStore(new ClanDocumentStore({ wasm: wasm(), persistence, saveDebounceMs: 0, person: opts.person }), { debounceMs: 1, undo: opts.undo })
const ME = { participantId: MAYA.id, handle: 'maya', team: 'napkin', workspace: MAYA.tenant_id, tenant: { id: MAYA.tenant_id, agency: 'napkin' }, allow: { claude: true, makers: ['runway'] }, quotas: null, projects: 0 }

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 100 && !ok(); i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
}
const button = (at: ParentNode, name: string) => [...at.querySelectorAll('button')].find((b) => b.textContent === name) as HTMLButtonElement

async function mount() {
  const storage = memoryStorage()
  const app = new SnapshotStore<AppUi>({ ...initialAppUi(), me: ME }, null)
  const relay = new MockRelay({ renderer: { async render() { return [] } }, delayMs: 60_000, persistKey: null })
  const shell = new Shell({ relay, app, index: new ProjectIndex(storage, () => new Date('2026-11-18T10:00:00Z')), storage, remoteConfig: null, makeClan, summaryDelayMs: 1 })
  await shell.newProject()
  const services: Services = shell.get().session!.services
  await seedStages(services.doc)
  const store = services.clan!
  const scriptId = Object.keys(store.get().scripts)[0]
  const sceneId = await addScene(store, scriptId)
  // The Script agent's draft from the Start card's line, landed as the runner lands it.
  const input = await writeInput(store, scriptId, { kind: 'scene', id: sceneId }, 'draft', { mode: 'draft', instruction: 'A market at noon.' })
  const job: Job = {
    contractVersion: '3', jobId: id('job'), participantId: MAYA.id, tenantId: MAYA.tenant_id, projectId: store.get().project.id, startedBy: `human:${MAYA.id}`,
    crew: 'skye', node: { kind: 'script', id: scriptId }, nonce: 'n_x', op: 'write', quotaClass: 'text', state: 'completed',
    inputHashes: [], writes: mockWrites(input), cost: { estimate: 0, currency: 'USD', unknown: false }, createdAt: '2026-11-18T10:00:00Z', updatedAt: '2026-11-18T10:00:01Z',
  }
  await systemUpdate(services.doc, () => {}, 'noop')
  await landWrites(store, job)
  await store.flush()
  const el = document.createElement('div')
  document.body.appendChild(el)
  act(() => {
    root = createRoot(el)
    root.render(createElement(ShellContext.Provider, { value: shell }, createElement(ServicesContext.Provider, { value: services }, createElement(ScriptCard, { id: scriptId, onOpen: () => {} }))))
  })
  const words = () => (store.text.prose('scene', sceneId).content ?? []).map((b) => flatText(b.content, refNames(store.get()))).join('\n')
  return { el, store, words }
}

describe('the draft on the Script node', () => {
  it('fills in place with Keep and Discard; Keep lands it on the script', async () => {
    const { el, words } = await mount()
    await until(() => !!el.querySelector('.bl-draft'))
    const draft = el.querySelector('.bl-draft') as HTMLElement
    expect(draft.querySelector('.bl-draft-hd')?.textContent).toBe('Script agent · draft')
    expect(draft.querySelector('.bl-excerpt')?.textContent).not.toBe('')
    expect([...draft.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Keep', 'Discard'])
    expect(words()).toBe('')
    await act(async () => { button(draft, 'Keep').click() })
    await until(() => !el.querySelector('.bl-draft'))
    expect(words()).not.toBe('')
  })

  it('Discard leaves the script as it was and the node shows no draft', async () => {
    const { el, store, words } = await mount()
    await until(() => !!el.querySelector('.bl-draft'))
    await act(async () => { button(el.querySelector('.bl-draft')!, 'Discard').click() })
    await until(() => !el.querySelector('.bl-draft'))
    expect(Object.values(store.get().suggestions)[0].state).toBe('dropped')
    expect(words()).toBe('')
  })
})
