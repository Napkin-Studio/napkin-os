// What the chrome asks of the canvas below it, when the canvas can do it (features/canvas-nodes.clan,
// features/art-boards.clan; ui-behaviour 3.2, 3.3, 3.4): + Node making a node, "+ New board" and the
// Board tool (B) making a board, and the Link tool (L). The canvas that can (our own engine: the node
// and board layers) registers here while it is mounted; the tool bar and the rail read whether one is
// registered, so on a canvas that cannot they fall back (Excalidraw: + Node opens the editor) or are
// disabled with the reason. One bus per page: only one canvas is mounted at a time.

import type { CardKind } from '../nodes/cardChrome'

/** A tool the chrome runs over the canvas, outside the engine's own (select, hand, pen…). */
export type CanvasMode = 'link' | 'board' | null

export interface CanvasActions {
  /** Make a new node of this kind, on the current board or in view, selected. */
  node(kind: CardKind): void
  /** Make a new board beside the others, jump to it, and open its title. */
  board(): void
}

type Listener = () => void

class Bus {
  private nodes: Pick<CanvasActions, 'node'> | null = null
  private boards: Pick<CanvasActions, 'board'> | null = null
  private current: CanvasMode = null
  private pick: string | null = null
  private readonly listeners = new Set<Listener>()

  /** The node layer takes node(); the board layer board(). Returns the unregister. */
  register(part: Partial<CanvasActions>): () => void {
    if (part.node) this.nodes = { node: part.node }
    if (part.board) this.boards = { board: part.board }
    this.emit()
    return () => {
      if (part.node && this.nodes?.node === part.node) this.nodes = null
      if (part.board && this.boards?.board === part.board) this.boards = null
      this.current = null
      this.emit()
    }
  }

  canNode(): boolean {
    return !!this.nodes
  }

  canBoard(): boolean {
    return !!this.boards
  }

  node(kind: CardKind): boolean {
    if (!this.nodes) return false
    this.nodes.node(kind)
    return true
  }

  board(): boolean {
    if (!this.boards) return false
    this.boards.board()
    return true
  }

  mode(): CanvasMode {
    return this.current
  }

  /** Turn a chrome tool on (or off with null); a second press of the same one turns it off. */
  setMode(m: CanvasMode) {
    const next = m && (m === 'link' ? this.canNode() : this.canBoard()) ? m : null
    if (next === this.current) return
    this.current = next
    this.emit()
  }

  toggle(m: Exclude<CanvasMode, null>) {
    this.setMode(this.current === m ? null : m)
  }

  /** A board just made: the rail picks it (makes it current and jumps) once its row is there. */
  pickWhenListed(boardId: string | null) {
    this.pick = boardId
    this.emit()
  }

  pending(): string | null {
    return this.pick
  }

  subscribe = (cb: Listener): (() => void) => {
    this.listeners.add(cb)
    return () => void this.listeners.delete(cb)
  }

  /** A number that changes on every change (for useSyncExternalStore). */
  private n = 0
  version = (): number => this.n

  private emit() {
    this.n++
    for (const cb of this.listeners) cb()
  }
}

export const canvasActions = new Bus()

/** Is a key press a canvas tool letter (no modifier, not while typing)? */
export function toolLetter(e: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'target' | 'isComposing'>): string | null {
  if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return null
  const t = e.target as { closest?: (s: string) => unknown } | null
  if (t?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return null
  return /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : null
}
