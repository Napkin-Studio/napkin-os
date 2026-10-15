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
import { addShots, asset, id, job, MAYA, SHA, wasm } from '../test/model'
import { systemUpdate, updateDoc } from '../doc/store'
import { addScene, importFountain } from './edits'
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

async function open(pick?: (services: import('../app/context').Services) => Promise<string>) {
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
  const scriptId = pick ? await pick(services) : mainScript(services.doc.get())!.id
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

/** A second script, as + Node makes it: no storyboard. With `words`, its first scene says them. */
const secondScript = (words: string) => async (services: import('../app/context').Services): Promise<string> => {
  const sc = id('script')
  await systemUpdate(services.doc, (d) => { d.scripts[sc] = { id: sc, v: 1, field_v: {}, title: 'Script 2', target_s: 15 } }, 'add a script')
  if (words) {
    const scene = await addScene(services.clan!, sc)
    await updateDoc(services.doc, (d) => { d.scenes[scene].text = words }, 'edit')
  }
  await services.doc.flush()
  return sc
}

const button = (el: HTMLElement, name: string) => [...el.querySelectorAll('button')].find((b) => b.textContent === name)

describe('Plan shots and what comes next (ui-behaviour 3.10, 3.5)', () => {
  it('a script with no words: Plan shots is off and says why', async () => {
    const { el } = await open(secondScript(''))
    await settle()
    const plan = button(el, 'Plan shots')!
    expect(plan.disabled).toBe(true)
    expect(el.querySelector('.se-why')?.textContent).toBe('Write the script first')
    expect(el.querySelector('.se-next')).toBeNull()
  })

  it('a script with words and no storyboard: Dex says what is next, and Plan shots makes the storyboard and plans on it', async () => {
    const { el, services, scriptId } = await open(secondScript('EXT. CLIFFS - DAWN. A runner crests the cliff and drinks Lumen water.'))
    await settle()
    expect(el.querySelector('.se-next')?.textContent).toMatch(/Dex · directs: Ready when you are: Plan shots turns this into about 6 shots\./)
    expect(el.querySelector('.se-next')?.textContent).toContain('Make video')
    const plan = button(el, 'Plan shots')!
    expect(plan.disabled).toBe(false)
    expect(el.querySelector('.se-why')).toBeNull()
    await act(async () => { plan.click() })
    await settle()
    const d = services.doc.get()
    const drives = Object.values(d.links).filter((l) => l.role === 'drives' && l.from.id === scriptId && l.to.kind === 'storyboard')
    expect(drives).toHaveLength(1)
    const sb = drives[0].to.id
    expect(Object.values(d.jobs).some((j) => j.op === 'shot_list' && j.node.kind === 'storyboard' && j.node.id === sb)).toBe(true)
    expect(el.textContent).toContain('Planning…')
  })
})

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

  it('lists every reference linked to the script, named in it or not, and updates as links come and go (item 1)', async () => {
    const { services, el, render, scriptId } = await open()
    const refId = id('ref')
    const linkId = id('link')
    await act(async () => {
      await updateDoc(services.doc, (d) => {
        d.assets[SHA('7')] = asset(SHA('7'))
        d.refs[refId] = { id: refId, v: 1, field_v: {}, key: 'loc', variant: 'beach', role: 'location', asset: SHA('7') }
        d.links[linkId] = { id: linkId, v: 1, field_v: {}, from: { kind: 'ref', id: refId }, to: { kind: 'script', id: scriptId }, role: 'location' }
      }, 'link')
      await services.doc.flush()
    })
    render()
    await settle()
    const refs = () => [...el.querySelectorAll('.se-facts .se-ref')].map((r) => r.textContent)
    expect(refs()).toEqual(['@loc_beachlocation'])
    expect(el.querySelector('.se-refs .pt-label')?.textContent).toContain('References · 1')
    await act(async () => {
      await updateDoc(services.doc, (d) => { delete d.links[linkId] }, 'unlink')
      await services.doc.flush()
    })
    await settle()
    expect(refs()).toEqual([])
  })

  it('deletes a shot from its Delete control, and Undo brings it back (item 4)', async () => {
    const { services, el, render } = await open()
    await act(async () => {
      await updateDoc(services.doc, (d) => { addShots(d, 2, { status: 'planned', action: 'Shot words.' }) }, 'add shots')
      await services.doc.flush()
    })
    render()
    await settle()
    await act(async () => { (el.querySelector('.sp-shotline') as HTMLButtonElement).click() })
    await settle()
    await act(async () => { (el.querySelector('.sp-delshot') as HTMLButtonElement).click() })
    await settle()
    await act(async () => { await services.doc.flush() })
    await settle()
    expect(Object.keys(services.doc.get().shots)).toHaveLength(1)
    expect(el.querySelector('.se-line')?.textContent).toContain('Deleted shot 1.')
    await act(async () => { [...el.querySelectorAll<HTMLButtonElement>('.se-line button')].find((b) => b.textContent === 'Undo')!.click() })
    await settle()
    expect(Object.keys(services.doc.get().shots)).toHaveLength(2)
  })

  it('a scene with shots asks first; Delete scene takes it and its shots', async () => {
    const { services, el, render, scriptId } = await open()
    const store = services.clan!
    await act(async () => {
      await importFountain(store, scriptId, parseFountain('EXT. BEACH - DAWN\n\nMaya walks.\n\nINT. CAR - DAY\n\nShe drives.\n'))
      await services.doc.flush()
      const scene = Object.values(store.get().scenes).find((x) => x.heading === 'EXT. BEACH - DAWN')!
      await updateDoc(services.doc, (d) => { addShots(d, 1, { status: 'planned', action: 'Shot words.', scene_id: scene.id }) }, 'add shots')
      await services.doc.flush()
    })
    render()
    await settle()
    const headings = () => [...el.querySelectorAll('.sp-heading')].map((h) => (h as HTMLInputElement).value)
    expect(headings()).toEqual(['EXT. BEACH - DAWN', 'INT. CAR - DAY'])
    await act(async () => { (el.querySelector('[aria-label="Delete scene 1"]') as HTMLButtonElement).click() })
    await settle()
    expect(el.querySelector('.se-confirm')?.textContent).toContain('Delete scene 1 and its 1 shot?')
    await act(async () => { [...el.querySelectorAll<HTMLButtonElement>('.se-confirm button')].find((b) => b.textContent === 'Delete scene')!.click() })
    await settle()
    await act(async () => { await services.doc.flush() })
    await settle()
    expect(headings()).toEqual(['INT. CAR - DAY'])
    expect(Object.keys(services.doc.get().shots)).toHaveLength(0)
  })
})

describe("Skye's question on a draft (owner 2026-10-15: shown nowhere, 'I'm writing that now')", () => {
  /** Skye's write job waiting on her question, as the runner writes it: the job at needs_input, its open ask,
   *  and this browser's request naming the item it was for. */
  const waitingWrite = async (services: import('../app/context').Services, scriptId: string, target: { kind: 'scene' | 'shot' | 'beat'; id: string }) => {
    const jobId = id('job')
    const q = id('q')
    await systemUpdate(services.doc, (d) => {
      d.jobs[jobId] = job(d, 'write', [], null, { id: jobId, state: 'needs_input', node: { kind: 'script', id: scriptId }, crew: 'skye', purpose: 'write', ask_id: q })
      d.asks[q] = {
        id: q, v: 1, field_v: {}, node: { kind: 'script', id: scriptId }, job_id: jobId, crew: 'skye', state: 'open', answers: [],
        question: { id: q, kind: 'nudge', text: 'Open on the hall or on the samurai?', options: [{ id: 'hall', label: 'The hall', value: 'hall' }, { id: 'him', label: 'The samurai', value: 'him' }], allow_text: true },
      }
    }, 'sync')
    services.ui.update((u) => {
      u.jobs[jobId] = { request: { op: 'write', input: { write: { intent: 'draft', target, base_hash: SHA('b'), lines: [], context: { target_s: 15, neighbours: '', refs: [] } } } } } as never
    })
    await services.doc.flush()
    return { jobId, askId: q }
  }

  it('a question whose item is gone shows at the top of the page; the facts wait for you with the question', async () => {
    const { services, el, render, scriptId } = await open()
    let askId = ''
    await act(async () => { askId = (await waitingWrite(services, scriptId, { kind: 'scene', id: id('scene') })).askId })
    render()
    await settle()
    const top = el.querySelector(`.se-asks [data-ask="${askId}"]`)
    expect(top?.textContent).toContain('Open on the hall or on the samurai?')
    expect([...top!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(expect.arrayContaining(['The hall', 'The samurai']))
    const facts = el.querySelector('.se-facts')!.textContent
    expect(facts).toContain('Waiting for you: Open on the hall or on the samurai?')
    expect(facts).not.toContain("I'm writing that now")
  })

  it('a question on a scene that is on the page shows on that scene', async () => {
    const { services, el, render, scriptId } = await open()
    let askId = ''
    await act(async () => {
      const scene = await addScene(services.clan!, scriptId)
      await updateDoc(services.doc, (d) => { d.scenes[scene].text = 'A samurai cleans the house.' }, 'edit')
      askId = (await waitingWrite(services, scriptId, { kind: 'scene', id: scene })).askId
    })
    render()
    await settle()
    expect(el.querySelector(`.sp-scene [data-ask="${askId}"]`)).not.toBeNull()
    expect(el.querySelector('.se-asks')).toBeNull()
  })

  it("the tray's Show brings the question into view with the focus on its first answer", async () => {
    const { services, el, render, scriptId } = await open()
    let askId = ''
    await act(async () => { askId = (await waitingWrite(services, scriptId, { kind: 'scene', id: id('scene') })).askId })
    render()
    await settle()
    await act(async () => { (el.querySelector('.pt-status') as HTMLButtonElement).click() })
    await settle()
    const show = [...document.querySelectorAll<HTMLButtonElement>('.traypop button')].find((b) => b.textContent === 'Show')!
    await act(async () => { show.click() })
    await act(async () => { await new Promise((r) => setTimeout(r, 120)) })
    const card = el.querySelector(`[data-ask="${askId}"]`)!
    expect(card.contains(document.activeElement)).toBe(true)
    expect(document.activeElement?.textContent).toBe('The hall')
  })
})
