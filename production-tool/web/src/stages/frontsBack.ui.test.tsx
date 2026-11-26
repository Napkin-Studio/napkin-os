// @vitest-environment happy-dom
// The front chooser opened from the script (round-2 F17) is an entry of its own in the browser's history, so
// Back returns to the script (UAT round 3, R3-F15: Back from the chooser skipped the script), and the chooser
// does not wait under the script once Back has left it.

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../canvas/adapter/excalidraw/serialize', () => ({ serializeScene: () => '{}' }))
import { ClanDocumentStore } from '../../../clan-store/src'
import { RouterContext, ServicesContext, ShellContext, type Services } from '../app/context'
import { projectRoute, Router, scriptRoute, type HistoryLike } from '../app/route'
import { SnapshotStore } from '../doc/store'
import { initialAppUi, type AppUi } from '../doc/ui'
import { ModelStore } from '../model/store'
import { ProjectIndex } from '../projects/projectIndex'
import type { MakeClan } from '../projects/session'
import { Shell } from '../projects/shell'
import { memoryStorage } from '../projects/storage'
import { MockRelay } from '../relay/mock'
import { MAYA, wasm } from '../test/model'
import { FrontButtons, FrontChooser } from './FrontsNeeded'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const makeClan: MakeClan = (persistence, opts = {}) =>
  new ModelStore(new ClanDocumentStore({ wasm: wasm(), persistence, saveDebounceMs: 0, person: opts.person }), { debounceMs: 1, undo: opts.undo })
const ME = { participantId: MAYA.id, handle: 'maya', team: 'napkin', workspace: MAYA.tenant_id, tenant: { id: MAYA.tenant_id, agency: 'napkin' }, allow: { claude: true, makers: ['runway'] }, quotas: null, projects: 0 }

/** A browser history in memory: entries, Back, and popstate. */
function stackRouter(start: string) {
  const location = { pathname: start, search: '' }
  const entries: { url: string; state: unknown }[] = [{ url: start, state: null }]
  let at = 0
  let pop: (() => void) | null = null
  const history: HistoryLike = {
    pushState(state, _u, url) { entries.splice(at + 1); entries.push({ url: String(url), state }); at += 1; location.pathname = String(url) },
    replaceState(state, _u, url) { entries[at] = { url: String(url), state }; location.pathname = String(url) },
    back() { if (at > 0) { at -= 1; location.pathname = entries[at].url; pop?.() } },
    get state() { return entries[at].state },
  }
  const router = new Router({ base: '/', history, location, win: { addEventListener: (_: string, f: () => void) => { pop = f } } as never })
  return { router, back: () => history.back(), urls: () => entries.slice(0, at + 1).map((e) => e.url) }
}

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

describe('Back from the front chooser', () => {
  it('returns to the script, and the chooser closes', async () => {
    const storage = memoryStorage()
    const app = new SnapshotStore<AppUi>({ ...initialAppUi(), me: ME }, null)
    const relay = new MockRelay({ renderer: { async render() { return [] } }, delayMs: 60_000, persistKey: null })
    const shell = new Shell({ relay, app, index: new ProjectIndex(storage, () => new Date('2026-11-21T10:00:00Z')), storage, remoteConfig: null, makeClan, summaryDelayMs: 1 })
    await shell.newProject()
    const services: Services = shell.get().session!.services
    const { router, back, urls } = stackRouter('/d/prj1')
    router.push(scriptRoute('prj1', 'scr1'))
    const el = document.createElement('div')
    document.body.appendChild(el)
    act(() => {
      root = createRoot(el)
      root.render(createElement(ShellContext.Provider, { value: shell }, createElement(RouterContext.Provider, { value: router },
        createElement(ServicesContext.Provider, { value: services },
          createElement(FrontButtons, { text: 'Set a front for @maya first: @maya stands for the whole character, led by its front.' }),
          createElement(FrontChooser)))))
    })
    const choose = [...el.querySelectorAll('button')].find((b) => /^Choose Maya.s front$/.test(b.textContent ?? ''))!
    act(() => { choose.click() })
    // The canvas is a new entry after the script's.
    expect(router.get()).toEqual(projectRoute('prj1'))
    expect(urls()).toEqual(['/d/prj1', '/d/prj1/script/scr1', '/d/prj1'])
    expect(services.ui.get().chooseFront).toBe('maya')
    expect(el.querySelector('.fronts-chooser')).not.toBeNull()
    // Back: the script again, and the chooser is done with.
    act(() => { back() })
    expect(router.get()).toEqual(scriptRoute('prj1', 'scr1'))
    expect(services.ui.get().chooseFront).toBeUndefined()
    expect(services.ui.get().chooseFrontFrom).toBeUndefined()
    expect(el.querySelector('.fronts-chooser')).toBeNull()
  })
})
