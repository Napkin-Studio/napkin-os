// @vitest-environment happy-dom
// The Text tool on our own engine (features/canvas-text.clan): T, then a click opens
// an editor there; Esc or a click elsewhere commits one text; an empty box leaves
// nothing; a double-click edits a text in place; the options set size and colour,
// of the next text and of the selected one; keys typed stay in the editor.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { TEXT_SIZES as ENGINE_SIZES } from '../../../../../canvas-engine/src'
import { CanvasToolbar } from '../../chrome/CanvasChrome'
import { TextOptions } from '../../chrome/TextOptions'
import { DEFAULT_TEXT, loadText, resetTextForTests, saveText, setText, TEXT_SIZE_PX } from '../../chrome/textStyle'
import { OwnAdapter } from './adapter'
import { ownChrome } from './chrome'
import { mountTextEditor } from './textEditor'

const measure = (line: string, size: number) => line.length * size * 0.5

function setup() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  host.tabIndex = 0
  const a = new OwnAdapter(null, { measure })
  const editor = mountTextEditor(host, a)
  a.onChange(() => editor.sync())
  return { a, host, editor, chrome: ownChrome(a) }
}

const type = (f: HTMLTextAreaElement, text: string) => {
  f.value = text
  f.dispatchEvent(new Event('input'))
}

afterEach(() => {
  document.body.innerHTML = ''
  resetTextForTests()
})

describe('the Text tool on our own engine', () => {
  it('is on the bar, keyed T, with the tooltip "Text (T)", no longer greyed out', () => {
    const { chrome } = setup()
    expect(chrome.supports!('text')).toBe(true)
    chrome.setTool('text')
    expect(chrome.tool()).toBe('text')
    const html = renderToStaticMarkup(createElement(CanvasToolbar, { chrome, ratio: '16:9', onNode: () => {} }))
    const btn = html.match(/<button[^>]*aria-label="Text \(T\)"[^>]*>/)![0]
    expect(btn).toContain('data-tip="Text (T)"')
    expect(btn).not.toContain('aria-disabled')
    expect(btn).toContain('aria-pressed="true"')
    // In hand, its options show: three sizes and the pen's swatches.
    expect(html).toContain('aria-label="Text options"')
  })

  it('a click opens the editor there, scaled with the view; Esc commits one text, back to Select with it selected', () => {
    const { a, chrome, editor, host } = setup()
    a.setViewport({ zoom: 2, scrollX: 10, scrollY: 0 })
    chrome.setTool('text')
    a.press({ x: 100, y: 100 })
    a.release({ x: 100, y: 100 })
    const f = editor.field()!
    expect(f).toBeTruthy()
    expect(document.activeElement).toBe(f)
    // Medium (24) at 200%: 48px, its first line centred on the click.
    expect(f.style.fontSize).toBe('48px')
    expect(f.style.left).toBe(`${(100 + 10) * 2}px`)
    expect(f.style.top).toBe(`${(100 - 15) * 2}px`)
    type(f, 'Hello\nthere')
    f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(editor.field()).toBeNull()
    expect(host.querySelector('textarea')).toBeNull()
    const [el] = a.elements()
    expect(el).toMatchObject({ type: 'text', text: 'Hello\nthere', fontSize: 24, x: 100, y: 85 })
    expect(a.view().selectedIds).toEqual([el.id])
    expect(chrome.tool()).toBe('select')
    // One undo step: undo takes the whole text away.
    a.undoScene('undo')
    expect(a.elements()).toHaveLength(0)
  })

  it('a click elsewhere commits; an empty box leaves no record', () => {
    const { a, chrome, editor, host } = setup()
    chrome.setTool('text')
    a.release({ x: 0, y: 0 })
    type(editor.field()!, 'Kept')
    host.focus()
    expect(a.elements().map((e) => (e as { text?: string }).text)).toEqual(['Kept'])
    chrome.setTool('text')
    a.release({ x: 500, y: 500 })
    type(editor.field()!, '   ')
    host.focus()
    expect(a.elements()).toHaveLength(1)
    expect(editor.field()).toBeNull()
  })

  it('keys typed stay in the editor: T types a "t", never the tool; Delete never deletes the selection', () => {
    const { a, chrome, editor, host } = setup()
    let heard = 0
    host.addEventListener('keydown', () => heard++)
    window.addEventListener('keydown', () => heard++)
    chrome.setTool('text')
    a.release({ x: 0, y: 0 })
    const f = editor.field()!
    for (const key of ['t', 'v', 'Delete', 'Backspace']) f.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    expect(heard).toBe(0)
    expect(editor.field()).toBe(f)
  })

  it('a double-click on a text (here: the adapter call the mount makes) edits it in place, hidden on the canvas meanwhile, one step', () => {
    const { a, chrome, editor } = setup()
    chrome.setTool('text')
    a.release({ x: 0, y: 0 })
    type(editor.field()!, 'Rain')
    editor.field()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    const id = a.elements()[0].id
    expect(a.textAt({ x: 5, y: 0 })).toBe(id)
    expect(a.editText(id)).toBe(true)
    const f = editor.field()!
    expect(f.value).toBe('Rain')
    expect(f.getAttribute('aria-label')).toBe('Edit text')
    type(f, 'Rain on glass')
    f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect((a.elements()[0] as { text?: string }).text).toBe('Rain on glass')
    expect(a.undo.depth().undo).toBe(2)
    a.undoScene('undo')
    expect((a.elements()[0] as { text?: string }).text).toBe('Rain')
  })

  it('T on a text edits it rather than starting another', () => {
    const { a, chrome, editor } = setup()
    chrome.setTool('text')
    a.release({ x: 0, y: 0 })
    type(editor.field()!, 'Rain')
    editor.field()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    chrome.setTool('text')
    a.press({ x: 5, y: 0 })
    a.release({ x: 5, y: 0 })
    expect(editor.field()!.value).toBe('Rain')
  })

  it('size and colour: the next text takes them; a selected text is restyled (one step); typing restyles the open one', () => {
    const { a, chrome, editor } = setup()
    chrome.setText!({ size: 36, color: 'orange' })
    chrome.setTool('text')
    a.release({ x: 0, y: 0 })
    expect(chrome.selectedText!()).toEqual({ size: 36, color: 'orange' })
    chrome.styleText!({ size: 16 })
    expect(editor.field()!.style.fontSize).toBe('16px')
    type(editor.field()!, 'Small words')
    editor.field()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(a.elements()[0]).toMatchObject({ fontSize: 16, strokeColor: 'orange' })
    // Selected: the options restyle it.
    expect(chrome.selectedText!()).toEqual({ size: 16, color: 'orange' })
    const before = a.undo.depth().undo
    chrome.styleText!({ color: '#123456' })
    expect(a.elements()[0]).toMatchObject({ strokeColor: '#123456' })
    expect(a.undo.depth().undo).toBe(before + 1)
    a.select([])
    expect(chrome.selectedText!()).toBeNull()
  })
})

describe('the Text options', () => {
  it('Small, Medium, Large match the engine\'s sizes; the pen\'s six swatches and + for more colours', () => {
    expect(TEXT_SIZE_PX).toEqual(ENGINE_SIZES)
    const html = renderToStaticMarkup(createElement(TextOptions, { look: { size: 24, color: 'ink' }, recent: ['#abcdef'], onSize: () => {}, onColor: () => {} }))
    expect(html).toMatch(/aria-checked="true"[^>]*>Medium</)
    expect(html).toContain('>Small<')
    expect(html).toContain('>Large<')
    expect(html.match(/class="pen-swatch"/g)).toHaveLength(7)
    expect(html).toContain('--swatch:#abcdef')
    expect(html).toContain('aria-label="More colours"')
    // A scaled text's size is none of the three.
    expect(renderToStaticMarkup(createElement(TextOptions, { look: { size: 30, color: 'ink' }, recent: [], onSize: () => {}, onColor: () => {} }))).not.toMatch(/aria-checked="true"[^>]*>(Small|Medium|Large)</)
  })

  it('the choice is kept in this browser; junk or a throwing store give the defaults', () => {
    let kept = ''
    saveText({ size: 'large', color: '#ff00ff' }, (v) => (kept = v))
    expect(loadText(() => kept)).toEqual({ size: 'large', color: '#ff00ff' })
    expect(loadText(() => '{nope')).toEqual(DEFAULT_TEXT)
    expect(loadText(() => JSON.stringify({ size: 'huge', color: 'red; x' }))).toEqual(DEFAULT_TEXT)
    expect(loadText(() => { throw new Error('SecurityError') })).toEqual(DEFAULT_TEXT)
    setText({ size: 'small' })
  })
})
