// The scoped ToolRegistry (features/canvas-core.clan; plan §3). A tool belongs
// to one surface (the canvas, the image editor, the video editor or the
// script), and a shortcut letter is unique only within its surface, since §7
// reuses V, B, L, T, H and S across them. Letter tools never fire while a text
// field has focus. Pure: React is imported for a type only.
//
// The canvas descriptors are declared here (§7's V H P T S B L, §8's palette,
// Sheets and + Node). Nothing in the running UI uses them yet; their bodies
// (overlays and commits) come with canvas-nodes.

import type { ComponentType } from 'react'
import type { ActiveToolSpec, LinkSpec, NodeSpec, Pt } from './canvasAdapter'

export type ToolScope = 'canvas' | 'image-editor' | 'video-editor' | 'script'

/** What a tool may do when it is activated or commits. */
export interface ToolContext {
  scope: ToolScope
  setActiveTool(tool: ActiveToolSpec): void
}

export interface ToolOverlayProps {
  ctx: ToolContext
  /** Scene to overlay coordinates, under the rendered view. */
  toView(p: Pt): Pt
  /** The overlay is done: commit this draft, or cancel with none. */
  done(draft?: unknown): void
}

/** What a tool's commit makes, applied as one undoable commit. */
export interface ToolCommit {
  create: NodeSpec[]
  links: LinkSpec[]
}

export interface ToolEntry {
  id: string
  scope: ToolScope
  label: string
  icon: string
  /** One letter, no modifier; case does not matter. */
  shortcut?: string
  /** Settings the tool starts with (the sketch area's ratio preset). */
  preset?: Readonly<Record<string, string>>
  /** Runs when the tool is picked; may return its cleanup. */
  onActivate(ctx: ToolContext): void | (() => void)
  /** The tool's own overlay while it is active; null for a command or an engine tool. */
  Overlay: ComponentType<ToolOverlayProps> | null
  commit(draft: unknown, ctx: ToolContext): ToolCommit
}

const LETTER = /^[a-z]$/

export class ToolRegistry {
  private readonly byId = new Map<string, ToolEntry>()
  private readonly keys = new Map<string, ToolEntry>()

  register(entry: ToolEntry): this {
    if (this.byId.has(entry.id)) throw new Error(`A tool with the id ${entry.id} is already registered.`)
    if (entry.shortcut !== undefined) {
      const key = entry.shortcut.toLowerCase()
      if (!LETTER.test(key)) throw new Error(`Tool ${entry.id}: a shortcut is one letter with no modifier, not ${entry.shortcut}.`)
      const taken = this.keys.get(`${entry.scope}:${key}`)
      if (taken) throw new Error(`Tool ${entry.id}: ${key.toUpperCase()} is already ${taken.id} in ${entry.scope}.`)
      this.keys.set(`${entry.scope}:${key}`, entry)
    }
    this.byId.set(entry.id, entry)
    return this
  }

  get(id: string): ToolEntry | undefined {
    return this.byId.get(id)
  }

  inScope(scope: ToolScope): ToolEntry[] {
    return [...this.byId.values()].filter((t) => t.scope === scope)
  }

  /** The tool a key press picks on a surface: nothing while a text field has focus, or with a modifier held. */
  byShortcut(scope: ToolScope, key: string, opts: { textFocused: boolean; modifier?: boolean }): ToolEntry | undefined {
    if (opts.textFocused || opts.modifier) return undefined
    const k = key.toLowerCase()
    if (!LETTER.test(k)) return undefined
    return this.keys.get(`${scope}:${k}`)
  }
}

const nothing = (): ToolCommit => ({ create: [], links: [] })

/** A tool the engine draws with itself (selection, hand, freedraw, text, eraser). */
function engineTool(id: string, label: string, icon: string, engineId: string, shortcut?: string): ToolEntry {
  return {
    id, scope: 'canvas', label, icon, ...(shortcut ? { shortcut } : {}),
    onActivate: (ctx) => ctx.setActiveTool({ type: 'native', id: engineId }),
    Overlay: null,
    commit: nothing,
  }
}

/** One of ours: a custom tool, whose overlay and commit canvas-nodes builds. */
function ownTool(id: string, label: string, icon: string, shortcut?: string, preset?: Record<string, string>): ToolEntry {
  return {
    id, scope: 'canvas', label, icon, ...(shortcut ? { shortcut } : {}), ...(preset ? { preset } : {}),
    onActivate: (ctx) => ctx.setActiveTool({ type: 'custom', id }),
    Overlay: null,
    commit: nothing,
  }
}

/** A toolbar command: it opens a picker rather than becoming the active tool. */
function command(id: string, label: string, icon: string): ToolEntry {
  return { id, scope: 'canvas', label, icon, onActivate: () => {}, Overlay: null, commit: nothing }
}

/** The canvas's tools: §7's letters, §8's palette, and the two toolbar commands. */
export function canvasTools(): ToolEntry[] {
  return [
    engineTool('select', 'Select', 'pointer', 'selection', 'V'),
    engineTool('hand', 'Hand', 'hand', 'hand', 'H'),
    engineTool('pen', 'Pen', 'pen', 'freedraw', 'P'),
    engineTool('text', 'Text', 'text', 'text', 'T'),
    ownTool('sketch', 'Sketch area', 'sketch', 'S'),
    ownTool('board', 'Board', 'board', 'B'),
    ownTool('link', 'Link', 'link', 'L'),
    // §8, the iPad palette.
    ownTool('highlighter', 'Highlighter', 'highlighter'),
    engineTool('eraser', 'Eraser', 'eraser', 'eraser'),
    ownTool('lasso', 'Lasso', 'lasso'),
    ownTool('sketch-16x9', 'Sketch 16:9', 'sketch', undefined, { ratio: '16:9' }),
    command('sheets', 'Sheets', 'sheets'),
    command('add-node', '+ Node', 'plus'),
  ]
}

export function canvasToolRegistry(): ToolRegistry {
  const r = new ToolRegistry()
  for (const t of canvasTools()) r.register(t)
  return r
}

/** The ink tools (pen, highlighter, eraser; freedraw is the pen): while one is in hand it owns the pointer on every surface. */
export function isInkTool(tool: ActiveToolSpec | null | undefined): boolean {
  const id = tool && tool.type === 'native' ? tool.id : ''
  return id === 'freedraw' || id === 'pen' || id === 'highlighter' || id === 'eraser'
}
