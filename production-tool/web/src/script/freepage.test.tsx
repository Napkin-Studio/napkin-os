// @vitest-environment happy-dom
// The free page (features/script-freeform.clan; mock ~/Documents/napkin-design-mocks/script-freeform-v1):
// a new script opens on a plain page; what is typed or pasted stays exactly as written; a pasted screenplay
// keeps its layout (and can be kept as plain text); prose stays prose; the element bar is the Format menu;
// Tab still cycles; the view is 'Page'; a heading-first paste sets the scene's heading; Plan shots reads
// free prose as it is.

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Editor } from '@tiptap/core'
import { Slice } from '@tiptap/pm/model'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../canvas/adapter/excalidraw/serialize', () => ({ serializeScene: () => '{}' }))
import { ClanDocumentStore, type Prose } from '../../../clan-store/src'
import { RouterContext, ServicesContext, ShellContext, type Services } from '../app/context'
import { Router, scriptRoute, type HistoryLike } from '../app/route'
import { SnapshotStore } from '../doc/store'
import { initialAppUi, type AppUi } from '../doc/ui'
import { planInput } from '../jobs/plan'
import { planShotsBlocked } from '../jobs/scriptVideo'
import { mainScript, scenesOf } from '../model/selectors'
import { ModelStore } from '../model/store'
import { ProjectIndex } from '../projects/projectIndex'
import type { MakeClan } from '../projects/session'
import { Shell } from '../projects/shell'
import { memoryStorage } from '../projects/storage'
import { MockRelay } from '../relay/mock'
import { MAYA, seedStages, wasm } from '../test/model'
import { FORMAT_INSTRUCTION } from './Format'
import { parseFountain } from './fountain'
import { fountainOut } from './fountainOut'
import { linesAt, pageSceneId } from './edits'
import { paragraphs, sceneIsFree, scriptIsFree } from './freeText'
import { nextStep } from './nextStep'
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

/** The Script editor on the project's script, as a person opens it. */
async function open() {
  const storage = memoryStorage()
  const index = new ProjectIndex(storage, () => new Date('2026-11-16T10:00:00Z'))
  const app = new SnapshotStore<AppUi>({ ...initialAppUi(), me: ME }, null)
  const relay = new MockRelay({ renderer: { async render() { return [] } }, delayMs: 2000, persistKey: null })
  const shell = new Shell({ relay, app, index, storage, remoteConfig: null, makeClan, summaryDelayMs: 1 })
  await shell.newProject()
  const session = shell.get().session!
  const services: Services = session.services
  await seedStages(services.doc)
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
  await settle()
  return { services, store: services.clan!, scriptId, el, render }
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })
const button = (root: ParentNode, name: string) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === name)
/** The live editor of the page's (first) scene, as Tiptap hangs it on its element. */
const pageEditor = (el: HTMLElement, at = '.sp-scene .ProseMirror') => (el.querySelector(at) as unknown as { editor: Editor }).editor

/** A paste of plain text into an editor, through its own paste handling (as a browser's paste event). */
async function paste(editor: Editor, text: string) {
  const event = { clipboardData: { getData: (t: string) => (t === 'text/plain' ? text : '') }, preventDefault() {} } as unknown as ClipboardEvent
  await act(async () => {
    editor.view.someProp('handlePaste', (f) => f(editor.view, event, Slice.empty))
  })
  await settle()
}

const blocks = (p: Prose) => (p.content ?? []).map((b) => ({ type: b.type, text: (b.content ?? []).map((n) => n.text ?? '').join('') }))

const SCREENPLAY = 'EXT. CITY STREET - DUSK\n\nRain hammers the cobbles.\n\nMIRA\n(softly)\nHey. Where\'s your person?\n\nEXT. OLD STONE BRIDGE - CONTINUOUS\n\nThe sky turns gold.\n\nFADE OUT.\n'
const PROSE = 'A woman in a red raincoat finds a lost puppy in the rain.\n@mira steps off a green tram.\n- walks past a bakery window\n- a whimper under the bridge railing\n\nEnd line: Someone\'s always looking out for you.'

describe('a new script opens on a plain page', () => {
  it('shows "Just write." with nothing to pick, on one quiet page scene that is not an undo step', async () => {
    const { el, store, scriptId } = await open()
    expect(el.textContent).toContain('Just write.')
    expect(el.textContent).toContain('A pasted screenplay keeps its layout')
    // No element bar over the page, and no Skye start box on it.
    expect(el.querySelector('[role="toolbar"][aria-label="Element"]')).toBeNull()
    expect(el.querySelector('[data-prompt-start]')).toBeNull()
    const scenes = scenesOf(store.get(), scriptId)
    expect(scenes.map((s) => [s.id, s.heading])).toEqual([[pageSceneId(scriptId), '']])
    expect(store.undoLabels().undo ?? '').not.toContain('scenes')
    // No heading field and no placeholder heading on the free page.
    expect(el.querySelector('.sp-heading')).toBeNull()
    expect(el.textContent).not.toContain('INT. PLACE - DAY')
    expect(el.querySelector('.se-outline')?.textContent).toContain('nothing yet')
    expect(button(el, 'Plan shots')!.disabled).toBe(true)
    expect((el.querySelector('.ptbar .se-makevideo') as HTMLButtonElement).disabled).toBe(true)
    expect(el.querySelector('.ptbar .se-why')?.textContent).toBe('Write something first')
  })

  it('names the view Page, beside Video · Audio, with Format next to it', async () => {
    const { el } = await open()
    const views = [...el.querySelectorAll('.pt-seg button')].map((b) => b.textContent)
    expect(views).toEqual(['Page', 'Video · Audio'])
    expect(button(el, 'Screenplay')).toBeUndefined()
    expect(el.querySelector('.ptbar .se-fmt')?.textContent).toContain('Format')
    expect(el.querySelector('[aria-label="Page"]')).not.toBeNull()
  })
})

describe('what is typed or pasted stays exactly as written', () => {
  it('pasted prose and bullets stay prose: one plain line per line, words and markers as written', async () => {
    const { el, store, scriptId } = await open()
    await paste(pageEditor(el), PROSE)
    await act(async () => { await store.flush() })
    const [scene] = scenesOf(store.get(), scriptId)
    expect(scene.heading).toBe('')
    expect(blocks(store.text.prose('scene', scene.id))).toEqual([
      { type: 'action', text: 'A woman in a red raincoat finds a lost puppy in the rain.' },
      { type: 'action', text: '@mira steps off a green tram.' },
      { type: 'action', text: '- walks past a bakery window' },
      { type: 'action', text: '- a whimper under the bridge railing' },
      { type: 'action', text: 'End line: Someone\'s always looking out for you.' },
    ])
    expect(sceneIsFree(store.get().scenes[scene.id])).toBe(true)
    expect(el.querySelector('.sp-note')).toBeNull()
    // The bullets show as bullets, their markers still in the words.
    expect(el.querySelectorAll('.sp-scene .fp-li')).toHaveLength(2)
    expect(el.querySelector('.sp-scene .fp-li .fp-mark')?.textContent).toBe('- ')
  })

  it('the outline lists free text as paragraphs, a bullet by its words', async () => {
    const { el, store, scriptId, render } = await open()
    await paste(pageEditor(el), PROSE)
    await act(async () => { await store.flush() })
    render()
    await settle()
    const outline = el.querySelector('.se-outline')!.textContent!
    expect(outline).toContain('5 paragraphs')
    expect(outline).toContain('¶3walks past a bakery window')
    expect(paragraphs(store.get(), scriptId).map((p) => p.text)[2]).toBe('walks past a bakery window')
  })

  it('a pasted screenplay keeps its layout, says so, and can be kept as plain text instead', async () => {
    const { el, store, scriptId, render } = await open()
    await paste(pageEditor(el), SCREENPLAY)
    await act(async () => { await store.flush() })
    render()
    await settle()
    const d = store.get()
    const scenes = scenesOf(d, scriptId)
    expect(scenes.map((s) => s.heading)).toEqual(['EXT. CITY STREET - DUSK', 'EXT. OLD STONE BRIDGE - CONTINUOUS'])
    // The page it was pasted on is the first scene (nothing empty left behind).
    expect(scenes[0].id).toBe(pageSceneId(scriptId))
    expect(blocks(store.text.prose('scene', scenes[0].id)).map((b) => b.type)).toEqual(['action', 'character', 'parenthetical', 'dialogue'])
    expect(blocks(store.text.prose('scene', scenes[1].id))).toEqual([{ type: 'action', text: 'The sky turns gold.' }, { type: 'transition', text: 'FADE OUT.' }])
    expect(scriptIsFree(d, scriptId)).toBe(false)
    expect(el.querySelector('.sp-note')?.textContent).toContain('Pasted as a screenplay: its 2 scenes, characters and dialogue kept as they were.')
    expect(el.querySelector('.se-next')?.textContent).toContain('Your screenplay came in with its 2 scenes.')
    expect(el.querySelector('.se-outline')?.textContent).toContain('2 scenes')

    await act(async () => { button(el, 'Keep it as plain text')!.click() })
    await settle()
    await act(async () => { await store.flush() })
    const after = scenesOf(store.get(), scriptId)
    expect(after.map((s) => [s.id, s.heading])).toEqual([[pageSceneId(scriptId), '']])
    const lines = SCREENPLAY.split('\n').filter((l) => l.trim())
    expect(blocks(store.text.prose('scene', after[0].id))).toEqual(lines.map((text) => ({ type: 'action', text })))
    expect(sceneIsFree(store.get().scenes[after[0].id])).toBe(true)
  })

  it('a paste that starts with a scene heading makes it the scene\'s heading, with no placeholder (finding 27)', async () => {
    const { el, store, scriptId, render } = await open()
    await paste(pageEditor(el), 'INT. GYM - NIGHT\n\nA man racks the bar and breathes.')
    await act(async () => { await store.flush() })
    render()
    await settle()
    const scenes = scenesOf(store.get(), scriptId)
    expect(scenes.map((s) => s.heading)).toEqual(['INT. GYM - NIGHT'])
    expect(blocks(store.text.prose('scene', scenes[0].id))).toEqual([{ type: 'action', text: 'A man racks the bar and breathes.' }])
    expect((el.querySelector('.sp-heading') as HTMLInputElement).value).toBe('INT. GYM - NIGHT')
  })

  it('free text exports to Fountain and comes back as the same lines', async () => {
    const { el, store, scriptId } = await open()
    await paste(pageEditor(el), 'She runs.\nThe sea is loud.')
    await act(async () => { await store.flush() })
    const out = fountainOut(store.get(), scriptId)
    const back = parseFountain(out)
    expect(back.scenes.flatMap((s) => s.blocks)).toEqual([{ type: 'action', text: 'She runs.' }, { type: 'action', text: 'The sea is loud.' }])
  })

  it('linesAt puts plain lines where they were pasted, the first joining the words before', () => {
    const prose: Prose = { type: 'doc', content: [{ type: 'action', content: [{ type: 'text', text: 'Before after' }] }] }
    expect(blocks(linesAt(prose, { from: 8, to: 8 }, 'one\ntwo\n'))).toEqual([{ type: 'action', text: 'Before one' }, { type: 'action', text: 'twoafter' }])
  })
})

describe('the Format menu holds the elements; Tab still cycles them', () => {
  async function withWords(text: string) {
    const o = await open()
    const editor = pageEditor(o.el)
    await paste(editor, text)
    await act(async () => { editor.commands.focus('end') })
    await settle()
    return { ...o, editor }
  }

  it('lists Skye\'s Format as screenplay, the line elements with the current one ticked, Shot, Moment and the Tab hint', async () => {
    const { el } = await withWords('She runs.\nThe sea is loud.')
    await act(async () => { (el.querySelector('.ptbar .se-fmt') as HTMLButtonElement).click() })
    const menu = document.querySelector('.se-fmtmenu')!
    expect(menu.textContent).toContain('Format as screenplay')
    // Free text: the caret's line reads as Plain text (Action is the same stored line in a screenplay).
    expect([...menu.querySelectorAll('.se-fmtline')].map((x) => x.textContent)).toEqual(['✓Plain text', 'Scene heading', 'Action', 'Character', 'Dialogue', 'Parenthetical', 'Transition'])
    expect(menu.textContent).toContain('Shot')
    expect(menu.textContent).toContain('Moment')
    expect(menu.textContent).toContain('Tab cycles the elements as you write a screenplay.')
  })

  it('Character sets the caret\'s line, and the scene reads as a screenplay', async () => {
    const { el, store, scriptId, editor } = await withWords('She runs.\nMAYA')
    await act(async () => { (el.querySelector('.ptbar .se-fmt') as HTMLButtonElement).click() })
    await act(async () => { button(document.querySelector('.se-fmtmenu')!, 'Character')!.click() })
    await act(async () => { await store.flush() })
    const [scene] = scenesOf(store.get(), scriptId)
    expect(blocks(store.text.prose('scene', scene.id)).map((b) => b.type)).toEqual(['action', 'character'])
    expect(editor.state.selection.$from.parent.type.name).toBe('character')
    expect(sceneIsFree(store.get().scenes[scene.id])).toBe(false)
  })

  it('Scene heading makes the caret\'s line a scene\'s heading', async () => {
    const { el, store, scriptId } = await withWords('She runs.\next. beach - dawn')
    await act(async () => { (el.querySelector('.ptbar .se-fmt') as HTMLButtonElement).click() })
    await act(async () => { button(document.querySelector('.se-fmtmenu')!, 'Scene heading')!.click() })
    await settle()
    await act(async () => { await store.flush() })
    const scenes = scenesOf(store.get(), scriptId)
    expect(scenes.map((s) => s.heading)).toEqual(['', 'EXT. BEACH - DAWN'])
    expect(blocks(store.text.prose('scene', scenes[0].id))).toEqual([{ type: 'action', text: 'She runs.' }])
  })

  it('Format as screenplay asks Skye with an instruct write on the free text; nothing changes until it is kept', async () => {
    const { el, store, scriptId, services } = await withWords('She runs.\nThe sea is loud.')
    await act(async () => { await store.flush() })
    const submit = vi.spyOn(services.runner, 'submit')
    await act(async () => { (el.querySelector('.ptbar .se-fmt') as HTMLButtonElement).click() })
    const skye = document.querySelector('.se-fmtmenu .se-fmtskye') as HTMLButtonElement
    expect(skye.disabled).toBe(false)
    await act(async () => { skye.click() })
    await settle()
    expect(submit).toHaveBeenCalledTimes(1)
    const [op, input] = submit.mock.calls[0]
    expect(op).toBe('write')
    const write = (input as { write: { intent: string; mode: string; instruction: string; target: { kind: string; id: string } } }).write
    expect(write).toMatchObject({ intent: 'instruct', mode: 'revise', instruction: FORMAT_INSTRUCTION, target: { kind: 'scene', id: pageSceneId(scriptId) } })
    expect(blocks(store.text.prose('scene', pageSceneId(scriptId))).map((b) => b.text)).toEqual(['She runs.', 'The sea is loud.'])
  })

  it('Tab on a plain line still cycles to Character, then Dialogue', async () => {
    const { editor } = await withWords('She runs.\nMAYA')
    await act(async () => { editor.commands.keyboardShortcut('Tab') })
    expect(editor.state.selection.$from.parent.type.name).toBe('character')
    await act(async () => { editor.commands.keyboardShortcut('Tab') })
    expect(editor.state.selection.$from.parent.type.name).toBe('dialogue')
  })
})

describe('Plan shots reads free text as it is', () => {
  it('free prose unblocks Plan shots, Dex says so, and the shot_list request carries the words verbatim', async () => {
    const { el, store, scriptId, services, render } = await open()
    await paste(pageEditor(el), PROSE)
    await act(async () => { await store.flush() })
    render()
    await settle()
    const d = store.get()
    expect(planShotsBlocked(d, scriptId)).toBeNull()
    expect(button(el, 'Plan shots')!.disabled).toBe(false)
    expect(nextStep(d, scriptId)?.line).toMatch(/^I'll read your words as they are and plan about \d+ shots\. Nothing needs a heading or an element first\.$/)
    const input = await planInput(services.relay, d)
    expect(input.script).toBe(PROSE.split('\n').filter((l) => l.trim()).join('\n'))
  })
})
