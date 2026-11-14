// The scoped ToolRegistry (features/canvas-core.clan), against ui-behaviour.md
// §7 (keyboard map) and §8 (the iPad palette).

import { describe, expect, it } from 'vitest'
import type { ActiveToolSpec } from './canvasAdapter'
import { canvasToolRegistry, canvasTools, ToolRegistry, type ToolEntry, type ToolScope } from './tools'

const tool = (id: string, scope: ToolScope, shortcut?: string): ToolEntry => ({
  id, scope, label: id, icon: id, ...(shortcut ? { shortcut } : {}),
  onActivate: () => {}, Overlay: null, commit: () => ({ create: [], links: [] }),
})

describe('register', () => {
  it('refuses a duplicate id', () => {
    const r = new ToolRegistry().register(tool('pen', 'canvas'))
    expect(() => r.register(tool('pen', 'image-editor'))).toThrow(/already registered/)
  })

  it('refuses a duplicate shortcut within a scope, whatever its case', () => {
    const r = new ToolRegistry().register(tool('link', 'canvas', 'L'))
    expect(() => r.register(tool('lasso', 'canvas', 'l'))).toThrow(/already link in canvas/)
  })

  it('allows the same letter in different scopes (canvas L and video-editor L)', () => {
    const r = new ToolRegistry().register(tool('link', 'canvas', 'L')).register(tool('forward', 'video-editor', 'L'))
    expect(r.byShortcut('canvas', 'l', { textFocused: false })?.id).toBe('link')
    expect(r.byShortcut('video-editor', 'L', { textFocused: false })?.id).toBe('forward')
  })

  it('a shortcut is one letter with no modifier', () => {
    for (const bad of ['Ctrl+L', 'LL', '1', '⌘K', ' ']) {
      expect(() => new ToolRegistry().register(tool('x', 'canvas', bad))).toThrow(/one letter/)
    }
  })
})

describe('byShortcut', () => {
  const r = canvasToolRegistry()
  it('finds a tool by its letter, in either case', () => {
    expect(r.byShortcut('canvas', 'v', { textFocused: false })?.id).toBe('select')
    expect(r.byShortcut('canvas', 'V', { textFocused: false })?.id).toBe('select')
  })

  it('does nothing while a text field has focus, or with a modifier held', () => {
    expect(r.byShortcut('canvas', 'v', { textFocused: true })).toBeUndefined()
    expect(r.byShortcut('canvas', 'v', { textFocused: false, modifier: true })).toBeUndefined()
  })

  it('does nothing for a letter another surface owns', () => {
    expect(r.byShortcut('image-editor', 'v', { textFocused: false })).toBeUndefined()
  })
})

describe('the canvas descriptors', () => {
  const tools = canvasTools()
  const byId = new Map(tools.map((t) => [t.id, t]))

  it('§7: V H P T S B L are Select, Hand, Pen, Text, Sketch area, Board and Link', () => {
    const lettered = tools.filter((t) => t.shortcut).map((t) => [t.shortcut, t.label])
    expect(lettered).toEqual([['V', 'Select'], ['H', 'Hand'], ['P', 'Pen'], ['T', 'Text'], ['S', 'Sketch area'], ['B', 'Board'], ['L', 'Link']])
    expect(tools.every((t) => t.scope === 'canvas')).toBe(true)
  })

  it('§8: the palette’s Highlighter, Eraser, Lasso and Sketch 16:9 (the sketch tool with a ratio preset)', () => {
    expect(['highlighter', 'eraser', 'lasso', 'sketch-16x9'].map((id) => byId.get(id)?.label)).toEqual(['Highlighter', 'Eraser', 'Lasso', 'Sketch 16:9'])
    expect(byId.get('sketch-16x9')!.preset).toEqual({ ratio: '16:9' })
  })

  it('Sheets and + Node are command entries with Overlay null and no shortcut', () => {
    for (const id of ['sheets', 'add-node']) expect(byId.get(id)).toMatchObject({ Overlay: null })
    expect(byId.get('sheets')!.label).toBe('Sheets')
    expect(byId.get('add-node')!.label).toBe('+ Node')
    expect(byId.get('sheets')!.shortcut).toBeUndefined()
  })

  it('every shortcut is one letter with no modifier, and they register without a clash', () => {
    for (const t of tools.filter((x) => x.shortcut)) expect(t.shortcut).toMatch(/^[A-Z]$/)
    expect(() => canvasToolRegistry()).not.toThrow()
  })

  it('activating picks the engine’s own tool or ours; nothing commits yet', () => {
    const picked: ActiveToolSpec[] = []
    const ctx = { scope: 'canvas' as const, setActiveTool: (t: ActiveToolSpec) => void picked.push(t) }
    byId.get('pen')!.onActivate(ctx)
    byId.get('link')!.onActivate(ctx)
    byId.get('sheets')!.onActivate(ctx)
    expect(picked).toEqual([{ type: 'native', id: 'freedraw' }, { type: 'custom', id: 'link' }])
    expect(byId.get('board')!.commit(undefined, ctx)).toEqual({ create: [], links: [] })
  })
})
