// @vitest-environment happy-dom
// The Script editor page, rendered (features/script-editor.clan): it opens on a project's
// script, shows scenes and shots from one row model, expands the current shot into its
// editor, imports Fountain as one undo step, and '← Canvas' leaves the route.

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The canvas engine does not load in node; the project reaches it only through export.ts.
vi.mock('../canvas/adapter/excalidraw/serialize', () => ({ serializeScene: () => '{}' }))
import { ClanDocumentStore } from '../../../clan-store/src'
import { RouterContext, ServicesContext, ShellContext } from '../app/context'
import { Router, scriptRoute, type HistoryLike } from '../app/route'
import { SnapshotStore } from '../doc/store'
import { initialAppUi, type AppUi } from '../doc/ui'
import { mainScript } from '../model/selectors'
import { ModelStore } from '../model/store'
import { ProjectIndex } from '../projects/projectIndex'
import type { MakeClan } from '../projects/session'
import { Shell } from '../projects/shell'
import { memoryStorage } from '../projects/storage'
import { MockRelay } from '../relay/mock'
import { addShots, MAYA, wasm } from '../test/model'
import { updateDoc } from '../doc/store'
import { importFountain } from './edits'
import { parseFountain } from './fountain'
import { ScriptEditor } from './ScriptEditor'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const makeClan: MakeClan = (persistence, opts = {}) =>
  new ModelStore(new ClanDocumentStore({ wasm: wasm(), persistence, saveDebounceMs: 0, person: opts.person }), { debounceMs: 1, undo: opts.undo })
const ME = { participantId: MAYA.id, handle: 'maya', team: 'napkin', workspace: MAYA.tenant_id, tenant: { id: MAYA.tenant_id, agency: 'napkin' }, allow: { claude: true, makers: ['runway', 'google'] }, quotas: null, projects: 0 }

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

function memoryHistory(): { history: HistoryLike; location: { pathname: string; search: string }; win: { addEventListener(t: string, fn: () => void): void } } {
  let onPop: (() => void) | null = null
  const location = { pathname: '/', search: '' }
  const stack: { url: string; state: unknown }[] = [{ url: '/', state: null }]
  let i = 0
  const go = () => {
    const [p, q] = stack[i].url.split('?')
    location.pathname = p
    location.search = q ? `?${q}` : ''
  }
  return {
    location,
    win: { addEventListener: (_t: string, fn: () => void) => { onPop = fn } },
    history: {
      pushState: (state, _u, url) => { stack.splice(i + 1); stack.push({ url: String(url), state }); i++; go() },
      replaceState: (state, _u, url) => { stack[i] = { url: String(url), state }; go() },
      back: () => { if (i > 0) i--; go(); onPop?.() },
      get state() { return stack[i].state },
    },
  }
}

async function open() {
  const storage = memoryStorage()
  const index = new ProjectIndex(storage, () => new Date('2026-10-13T10:00:00Z'))
  const app = new SnapshotStore<AppUi>({ ...initialAppUi(), me: ME }, null)
  const relay = new MockRelay({ renderer: { async render() { return [] } }, delayMs: 2000, persistKey: null })
  const shell = new Shell({ relay, app, index, storage, remoteConfig: null, makeClan, summaryDelayMs: 1 })
  await shell.newProject()
  const session = shell.get().session!
  const services = session.services
  const h = memoryHistory()
  const router = new Router({ base: '/', history: h.history, location: h.location, win: h.win as never })
  const scriptId = mainScript(services.doc.get())!.id
  router.push(scriptRoute(session.id, scriptId))
  const el = document.createElement('div')
  document.body.appendChild(el)
  const render = () => act(() => {
    root ??= createRoot(el)
    root.render(createElement(ShellContext.Provider, { value: shell },
      createElement(RouterContext.Provider, { value: router },
        createElement(ServicesContext.Provider, { value: services }, createElement(ScriptEditor, { scriptId })))))
  })
  render()
  return { services, router, scriptId, el, render }
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)) })

describe('the Script editor page', () => {
  it('an empty script says what to do, with the top bar and the facts', async () => {
    const { el } = await open()
    await settle()
    expect(el.textContent).toContain('Script · ')
    expect(el.textContent).toContain('Paste a script, or write the idea in a line.')
    expect(el.textContent).toContain('←Canvas')
    expect(el.textContent).toContain('Plan shots')
    expect(el.textContent).not.toMatch(/\$|free|cost/i)
  })

  it('shows imported scenes, and the shots; the current shot opens its editor', async () => {
    const { services, el, scriptId, render } = await open()
    const store = services.clan!
    await act(async () => {
      await importFountain(store, scriptId, parseFountain('Title: First Light\n\nEXT. BEACH - DAWN\n\nMaya walks.\n\nMAYA\nIt is perfect.\n'))
      await updateDoc(services.doc, (d) => { addShots(d, 2, { status: 'planned', action: 'Shot words.' }) }, 'add shots')
      await services.doc.flush()
    })
    render()
    await settle()
    expect(el.textContent).toContain('First Light')
    expect((el.querySelector('.sp-heading') as HTMLInputElement).value).toBe('EXT. BEACH - DAWN')
    expect(el.textContent).toContain('MAYA')
    expect(el.querySelectorAll('.sp-shot.collapsed')).toHaveLength(2)
    expect(el.querySelectorAll('.ol-shot')).toHaveLength(2)
    await act(async () => { (el.querySelector('.sp-shotline') as HTMLButtonElement).click() })
    await settle()
    expect(el.querySelectorAll('.sp-shot.open')).toHaveLength(1)
    expect(el.querySelector('.sp-shot.open [data-script-editor]')).not.toBeNull()
    expect(el.querySelector('.sp-shot.open')!.textContent).toContain('Shot words.')
  })

  it('Video · Audio shows the same shots as a table; the open shot has camera fields, moments and audio rows', async () => {
    const { services, el, render } = await open()
    await act(async () => {
      await updateDoc(services.doc, (d) => { addShots(d, 2, { status: 'planned', action: 'Shot words.', duration_s: 3 }) }, 'add shots')
      await services.doc.flush()
    })
    render()
    await settle()
    await act(async () => { [...el.querySelectorAll('button')].find((b) => b.textContent === 'Video · Audio')!.click() })
    await settle()
    expect(services.ui.get().script).toBeDefined()
    expect(el.querySelectorAll('.av-row:not(.av-headrow)')).toHaveLength(2)
    expect(el.querySelector('.av-strip-words')?.textContent).toBe('15 s target · 6.0 s estimated')
    await act(async () => { (el.querySelector('.av-no') as HTMLButtonElement).click() })
    await settle()
    const row = el.querySelector('.av-row.open')!
    expect(row.textContent).toContain('Edit camera')
    expect(row.textContent).toContain('+ VO')
    expect(row.textContent).toContain('+ Sound')
    await act(async () => { [...row.querySelectorAll('button')].find((b) => b.textContent === '+ Moment')!.click() })
    await settle()
    await act(async () => { await services.doc.flush() })
    await settle()
    expect(el.querySelectorAll('.av-row.open .av-marker')).toHaveLength(1)
    expect(el.querySelector('.av-row.open .av-marker')?.textContent).toBe('0:00')
  })

  it('the facts list a name with no ref yet, with the shots that use it', async () => {
    const { services, el, render } = await open()
    const store = services.clan!
    await act(async () => {
      await updateDoc(services.doc, (d) => { addShots(d, 1, { status: 'planned' }) }, 'add shots')
      await services.doc.flush()
      const shot = Object.keys(store.get().shots)[0]
      await store.text.replace('shot', shot, { type: 'doc', content: [{ type: 'action', content: [{ type: 'text', text: 'A @jogger runs past.' }] }] }, `human:${MAYA.id}`)
      await store.flush()
    })
    render()
    await settle()
    expect(el.querySelector('.se-facts .se-ref')?.textContent).toBe('@joggerno ref yet1')
  })

  it('← Canvas leaves the route and goes back to the canvas', async () => {
    const { el, router, services } = await open()
    await settle()
    await act(async () => { [...el.querySelectorAll('button')].find((b) => b.textContent === '←Canvas')!.click() })
    expect(router.get()).toEqual({ kind: 'none' })
    expect(services.ui.get().stage).toBe('character')
  })
})
