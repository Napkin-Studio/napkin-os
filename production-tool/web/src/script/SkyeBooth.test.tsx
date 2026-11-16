// @vitest-environment happy-dom
// Skye in the Booth (features/script-freeform.clan; mock script-freeform-v1 states draft, selection, asks,
// part): her box drafts an empty script; her drafts and edits are cards that land on the page only on Keep,
// with Undo, Discard and Why; with words selected the box asks about the selection only (the instruct
// intent); her questions wait there; a click on the page while the Booth is hidden brings it back on that part.

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../canvas/adapter/excalidraw/serialize', () => ({ serializeScene: () => '{}' }))
import { ClanDocumentStore, flatText } from '../../../clan-store/src'
import { RouterContext, ServicesContext, ShellContext, type Services } from '../app/context'
import { Router, scriptRoute, type HistoryLike } from '../app/route'
import type { Job, JobInput } from '../contracts/types'
import { SnapshotStore, systemUpdate, updateDoc } from '../doc/store'
import { initialAppUi, type AppUi } from '../doc/ui'
import { ModelStore } from '../model/store'
import { ProjectIndex } from '../projects/projectIndex'
import type { MakeClan } from '../projects/session'
import { Shell } from '../projects/shell'
import { memoryStorage } from '../projects/storage'
import { MockRelay } from '../relay/mock'
import { mockWrites } from '../relay/mockWrite'
import { addShots, id, MAYA, seedStages, wasm } from '../test/model'
import { addScene } from './edits'
import { refNames } from './extensions'
import { nameAsk } from './nameAsks'
import { landWrites, writeInput } from './skye'
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
  vi.restoreAllMocks()
})

function memoryHistory(): { history: HistoryLike; location: { pathname: string; search: string }; win: { addEventListener(t: string, fn: () => void): void } } {
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
    win: { addEventListener: () => {} },
    history: {
      pushState: (state, _u, url) => { stack.splice(i + 1); stack.push({ url: String(url), state }); i++; go() },
      replaceState: (state, _u, url) => { stack[i] = { url: String(url), state }; go() },
      back: () => { if (i > 0) i--; go() },
      get state() { return stack[i].state },
    },
  }
}

/** The Script editor on a new script whose first scene says `words` (none: an empty script), at `width`. */
async function open(words: string, opts: { width?: number; booth?: AppUi['booth'] } = {}) {
  Object.defineProperty(window, 'innerWidth', { value: opts.width ?? 1600, configurable: true })
  const storage = memoryStorage()
  const index = new ProjectIndex(storage, () => new Date('2026-11-16T10:00:00Z'))
  const app = new SnapshotStore<AppUi>({ ...initialAppUi(), me: ME, ...(opts.booth ? { booth: opts.booth } : {}) }, null)
  const relay = new MockRelay({ renderer: { async render() { return [] } }, delayMs: 60_000, persistKey: null })
  const shell = new Shell({ relay, app, index, storage, remoteConfig: null, makeClan, summaryDelayMs: 1 })
  await shell.newProject()
  const session = shell.get().session!
  const services = session.services
  await seedStages(services.doc)
  const scriptId = id('script')
  await systemUpdate(services.doc, (d) => { d.scripts[scriptId] = { id: scriptId, v: 1, field_v: {}, title: 'Lost puppy', target_s: 30 } }, 'add a script')
  let sceneId = ''
  if (words) {
    sceneId = await addScene(services.clan!, scriptId)
    await updateDoc(services.doc, (d) => { d.scenes[sceneId].text = words }, 'edit')
  }
  await services.doc.flush()
  const h = memoryHistory()
  const router = new Router({ base: '/', history: h.history, location: h.location, win: h.win as never })
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
  await settle()
  return { services, scriptId, sceneId, el, render, store: services.clan! }
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })
const booth = (el: HTMLElement) => el.querySelector('.se .booth') as HTMLElement
const buttonIn = (at: Element, name: string) => [...at.querySelectorAll('button')].find((b) => b.textContent === name) as HTMLButtonElement
/** Type into a React-controlled textarea. */
function typeInto(t: HTMLTextAreaElement, text: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(t, text)
  t.dispatchEvent(new Event('input', { bubbles: true }))
}
/** Spy on the runner: what Skye was asked, never sent. */
function spySubmit(services: Services) {
  const sent: JobInput[] = []
  vi.spyOn(services.runner, 'submit').mockImplementation(async (_op, input) => { sent.push(input); return id('job') })
  return sent
}
/** Skye's write landed for Maya, as the runner lands it (skye.ts landWrites). */
async function land(services: Services, scriptId: string, input: Awaited<ReturnType<typeof writeInput>>) {
  const store = services.clan!
  const job: Job = {
    contractVersion: '3', jobId: id('job'), participantId: MAYA.id, tenantId: MAYA.tenant_id, projectId: store.get().project.id, startedBy: `human:${MAYA.id}`,
    crew: 'skye', node: { kind: 'script', id: scriptId }, nonce: 'n_x', op: 'write', quotaClass: 'text', state: 'completed',
    inputHashes: [], writes: mockWrites(input), cost: { estimate: 0, currency: 'USD', unknown: false }, createdAt: '2026-11-16T10:00:00Z', updatedAt: '2026-11-16T10:00:01Z',
  }
  services.ui.update((u) => { u.jobs[job.jobId] = { request: { op: 'write', input: { write: input } } } as never })
  const [sug] = await landWrites(store, job)
  await store.flush()
  return sug
}
const sceneWords = (services: Services, sceneId: string) => (services.clan!.text.prose('scene', sceneId).content ?? []).map((b) => flatText(b.content, refNames(services.clan!.get()))).join('\n')

describe("Skye's box in the Booth", () => {
  it('on an empty script, asks Skye for a draft from the words typed (the draft intent, the words as its instruction)', async () => {
    const { el, services } = await open('')
    const sent = spySubmit(services)
    const b = booth(el)
    expect(b.querySelector('.bt-agent')?.textContent).toContain('Skye · scripts')
    expect(b.querySelector('.bt-scope')?.textContent).toBe('Whole script')
    const box = b.querySelector('textarea') as HTMLTextAreaElement
    expect(box.placeholder).toBe('Tell Skye what to write or change…')
    await act(async () => { typeInto(box, '30 s ad: a woman finds a lost puppy in the rain.') })
    await act(async () => { buttonIn(b, 'Ask Skye').click() })
    await settle()
    expect(sent).toHaveLength(1)
    expect(sent[0].write).toMatchObject({ intent: 'draft', mode: 'draft', instruction: '30 s ad: a woman finds a lost puppy in the rain.', target: { kind: 'scene' } })
    expect(box.value).toBe('')
  })

  it('with words selected on the page, asks about the selection only (instruct, revise) and offers the five verbs', async () => {
    const { el, services, sceneId } = await open('A runner crests the cliff. She drinks Lumen water.')
    const sent = spySubmit(services)
    await act(async () => { (el.querySelector('.sp-static') as HTMLElement).click() })
    await settle()
    const pm = el.querySelector('.se-page .ProseMirror') as HTMLElement & { editor?: import('@tiptap/core').Editor }
    const editor = pm.editor!
    expect(editor).toBeTruthy()
    Object.defineProperty(editor, 'isFocused', { get: () => true, configurable: true })
    const text = editor.state.doc.textContent
    const from = text.indexOf('She drinks') + 1
    await act(async () => { editor.commands.setTextSelection({ from, to: from + 'She drinks Lumen water'.length }) })
    await settle()
    const b = booth(el)
    expect(b.querySelector('.bt-scope')?.textContent).toBe('Your selection· “She drinks Lumen water”×')
    expect((b.querySelector('textarea') as HTMLTextAreaElement).placeholder).toBe('Tell Skye what to change in your selection…')
    expect([...b.querySelectorAll('.bt-verbs button')].map((x) => x.textContent)).toEqual(['Tighten', 'Make it 30 s', 'Add a beat', 'Write the VO', 'Say it another way'])
    await act(async () => { typeInto(b.querySelector('textarea') as HTMLTextAreaElement, 'slow this down') })
    await act(async () => { buttonIn(b, 'Ask Skye').click() })
    await settle()
    expect(sent).toHaveLength(1)
    expect(sent[0].write).toMatchObject({ intent: 'instruct', mode: 'revise', instruction: 'slow this down', target: { kind: 'scene', id: sceneId }, selection: { from, text: 'She drinks Lumen water' } })
    // × puts it back on the whole script.
    await act(async () => { (b.querySelector('.bt-scope button') as HTMLButtonElement).click() })
    expect(b.querySelector('.bt-scope')?.textContent).toBe('Whole script')
  })
})

describe("Skye's drafts and edits are cards: nothing changes until Keep", () => {
  it('a draft shows her words with Keep, Discard and Why; Keep lands it on the page with Undo', async () => {
    const { el, services, scriptId } = await open('')
    const store = services.clan!
    const sceneId = await addScene(store, scriptId)
    const input = await writeInput(store, scriptId, { kind: 'scene', id: sceneId }, 'draft', { mode: 'draft', instruction: 'A lost puppy in the rain.' })
    await act(async () => { await land(services, scriptId, input) })
    await settle()
    const card = booth(el).querySelector('[data-suggestion]') as HTMLElement
    expect(card.querySelector('.bc-who')?.textContent).toBe('Skye · draft')
    expect(card.querySelector('.bc-note')?.textContent).toBe('From your words: A lost puppy in the rain.')
    expect(card.querySelector('.bc-text')?.textContent).not.toBe('')
    expect(card.querySelector('.where')?.textContent).toBe('Lands on the empty page')
    expect(sceneWords(services, sceneId)).toBe('')
    await act(async () => { buttonIn(card, 'Why').click() })
    expect(card.querySelector('.bc-why')?.textContent).toContain(Object.values(store.get().suggestions)[0].note)
    await act(async () => { buttonIn(card, 'Keep').click() })
    await settle()
    expect(sceneWords(services, sceneId)).not.toBe('')
    expect(booth(el).querySelector('[data-suggestion]')).toBeNull()
    const done = booth(el).querySelector('.bc.done') as HTMLElement
    expect(done.textContent).toContain('Kept. Skye’s draft is on the page.')
    await act(async () => { buttonIn(done, 'Undo').click() })
    await settle()
    expect(sceneWords(services, sceneId)).toBe('')
  })

  it('an edit shows the change word by word; Discard drops it and the page stays as it was', async () => {
    const { el, services, scriptId, sceneId } = await open('A runner crests the cliff. She drinks Lumen water.')
    const store = services.clan!
    await act(async () => { await store.checkpointText() })
    const input = await writeInput(store, scriptId, { kind: 'scene', id: sceneId }, 'rephrase')
    await act(async () => { await land(services, scriptId, input) })
    await settle()
    const card = booth(el).querySelector('[data-suggestion]') as HTMLElement
    expect(card.querySelector('.bc-who')?.textContent).toBe('Skye · edit')
    expect(card.querySelector('.bc-diff del')).not.toBeNull()
    expect(card.querySelector('.bc-diff ins')).not.toBeNull()
    expect(card.querySelector('.where')?.textContent).toBe('Replaces the page')
    await act(async () => { buttonIn(card, 'Discard').click() })
    await settle()
    expect(Object.values(store.get().suggestions)[0].state).toBe('dropped')
    expect(sceneWords(services, sceneId)).toBe('A runner crests the cliff. She drinks Lumen water.')
    expect(booth(el).querySelector('.bc.done')?.textContent).toContain('Discarded. The page is as it was.')
  })
})

describe('what waits for the person', () => {
  it("Skye's questions wait in the Booth, counted; Later puts one at the end", async () => {
    const { el, services, scriptId } = await open('')
    const store = services.clan!
    await act(async () => {
      await updateDoc(services.doc, (d) => { addShots(d, 2, { status: 'planned', action: 'Shot words.' }) }, 'add shots')
      await services.doc.flush()
      const shots = Object.keys(store.get().shots)
      await store.change((d) => {
        const a = nameAsk(d, scriptId, shots[0], 'puppy', 'A @puppy shivers.')
        const b = nameAsk(d, scriptId, shots[1], 'busker', 'A @busker plays.')
        d.asks[a.id] = a
        d.asks[b.id] = b
      }, { action: 'ask' })
      await store.flush()
    })
    await settle()
    const b = booth(el)
    expect(b.querySelector('.bt-sec')?.textContent).toBe('Waiting for you2')
    const qs = () => [...b.querySelectorAll('.bc.ask .bc-q')].map((x) => x.textContent?.slice(0, 18))
    expect(qs()).toEqual(['Who is the puppy? ', 'Who is the busker?'])
    expect([...b.querySelectorAll('.bc.ask')[0].querySelectorAll('button')].map((x) => x.textContent)).toEqual(['A character', 'An extra', 'Cut them', 'Later'])
    await act(async () => { buttonIn(b.querySelectorAll('.bc.ask')[0], 'Later').click() })
    expect(qs()).toEqual(['Who is the busker?', 'Who is the puppy? '])
  })
})

describe('the Booth comes back on a part of the page', () => {
  it('hidden, a click on a paragraph opens it on that part: ¶N, its words, and the box scoped to it', async () => {
    const { el, services } = await open('A runner crests the cliff.\nShe drinks Lumen water.', { booth: { [`human:${MAYA.id}`]: 'hidden' } })
    const col = () => el.querySelector('.se .booth-col') as HTMLElement
    expect(col().dataset.boothOpen).toBe('false')
    const second = el.querySelectorAll('.se-page .sp-static p')[1] as HTMLElement
    expect(second.textContent).toBe('She drinks Lumen water.')
    await act(async () => { second.click() })
    await act(async () => { await new Promise((r) => setTimeout(r, 320)) })
    expect(col().dataset.boothOpen).toBe('true')
    expect(services.ui.get().booth).toEqual({ [`human:${MAYA.id}`]: 'shown' })
    const b = booth(el)
    expect(b.querySelector('[aria-label="This part"] .bc-who')?.textContent).toBe('This part · ¶2')
    expect(b.querySelector('[aria-label="This part"] .bc-text')?.textContent).toBe('She drinks Lumen water.')
    expect(b.querySelector('.bt-scope')?.textContent).toBe('This part · ¶2×')
    expect(col().style.getPropertyValue('--bw')).toBe('440px')
  })
})
