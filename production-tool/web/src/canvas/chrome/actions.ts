// What the chrome asks of the canvas below it, when the canvas can do it (features/canvas-nodes.clan,
// features/art-boards.clan; ui-behaviour 3.2, 3.3, 3.4): + Node making a node, "+ New board" and the
// Board tool (B) making a board, the Link tool (L), and the Picture tool on a canvas without its own.
// The canvas that can (our own engine: the node and board layers) registers here while it is mounted;
// the tool bar and the rail read whether one is registered, so on a canvas that cannot they fall back
// (Excalidraw: + Node opens the editor) or are disabled with the reason. One bus per page: only one canvas is mounted at a time.

import type { CardKind } from '../nodes/cardChrome'
import type { MadeVideo, MakeVideoFrom } from '../nodes/make'

/** A node made on the canvas from an editor (Make a storyboard from these shots): what its Undo chip says, and where. */
export interface MadeOnCanvas { label: string; el: { id: string; x: number; y: number; width: number } }

/** A tool the chrome runs over the canvas, outside the engine's own (select, hand, pen…). */
export type CanvasMode = 'link' | 'board' | null

export interface CanvasActions {
  /** Make a new node of this kind, on the current board or in view, selected. */
  node(kind: CardKind): void
  /** Make a new board beside the others, jump to it, and open its title. */
  board(): void
  /** The Picture tool: ask for picture files and place them in view (a canvas without its own tool). */
  picture(): void
  /** "+ Link input" on a node (3.16): the Link tool, with this node as the target; the person clicks what feeds it. */
  linkInto(node: { kind: string; id: string }): void
  /** The Storyboard a Script drives, made beside it on the canvas when it has none (3.10 Plan shots). */
  storyboardFor(scriptId: string): Promise<{ storyboardId: string; made: boolean }>
  /** Make video (3.5): the Video node beside what it is made from, with its links, one undo step. */
  makeVideo(from: MakeVideoFrom): Promise<MadeVideo>
  /** Make a storyboard from these shots (3.13): a video's own shot list as a node beside it, one undo step. */
  storyboardFromShots(videoId: string): Promise<{ storyboardId: string }>
}

type Listener = () => void

class Bus {
  private nodes: Pick<CanvasActions, 'node'> | null = null
  private boards: Pick<CanvasActions, 'board'> | null = null
  private pictures: Pick<CanvasActions, 'picture'> | null = null
  private into: Pick<CanvasActions, 'linkInto'> | null = null
  private makes: Pick<CanvasActions, 'storyboardFor' | 'makeVideo' | 'storyboardFromShots'> | null = null
  private madeCb: ((m: MadeOnCanvas) => void) | null = null
  private editCb: ((nodeId: string) => void) | null = null
  private current: CanvasMode = null
  private pick: string | null = null
  private readonly listeners = new Set<Listener>()

  /** The node layer takes node(); the board layer board(). Returns the unregister. */
  register(part: Partial<CanvasActions>): () => void {
    if (part.node) this.nodes = { node: part.node }
    if (part.board) this.boards = { board: part.board }
    if (part.picture) this.pictures = { picture: part.picture }
    if (part.linkInto) this.into = { linkInto: part.linkInto }
    if (part.storyboardFor && part.makeVideo && part.storyboardFromShots) this.makes = { storyboardFor: part.storyboardFor, makeVideo: part.makeVideo, storyboardFromShots: part.storyboardFromShots }
    this.emit()
    return () => {
      if (part.node && this.nodes?.node === part.node) this.nodes = null
      if (part.board && this.boards?.board === part.board) this.boards = null
      if (part.picture && this.pictures?.picture === part.picture) this.pictures = null
      if (part.linkInto && this.into?.linkInto === part.linkInto) this.into = null
      if (part.makeVideo && this.makes?.makeVideo === part.makeVideo) this.makes = null
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

  canPicture(): boolean {
    return !!this.pictures
  }

  picture(): boolean {
    if (!this.pictures) return false
    this.pictures.picture()
    return true
  }

  /** "+ Link input" (an inputs strip's button): false when no canvas can link (Excalidraw). */
  linkInto(node: { kind: string; id: string }): boolean {
    if (!this.into) return false
    this.into.linkInto(node)
    return true
  }

  canLinkInto(): boolean {
    return !!this.into
  }

  /** Can the canvas make nodes from nodes (our own engine's node layer is mounted)? */
  canMake(): boolean {
    return !!this.makes
  }

  /** The Storyboard a Script drives, made on the canvas when it has none; null when no canvas can. */
  storyboardFor(scriptId: string): Promise<{ storyboardId: string; made: boolean }> | null {
    return this.makes ? this.makes.storyboardFor(scriptId) : null
  }

  /** The canvas page opens a picture in the Image editor (features/edit-canvas-pictures.clan): the node
   *  layer's double-click asks for it here. */
  onEditPicture(cb: (nodeId: string) => void): () => void {
    this.editCb = cb
    return () => { if (this.editCb === cb) this.editCb = null }
  }

  /** Open a canvas picture (its pic or gen node id) in the Image editor; false when no canvas page listens. */
  editPicture(nodeId: string): boolean {
    if (!this.editCb) return false
    this.editCb(nodeId)
    return true
  }

  /** The canvas page listens for a node made from an editor, to offer its Undo there (one canvas step). */
  onMade(cb: (m: MadeOnCanvas) => void): () => void {
    this.madeCb = cb
    return () => { if (this.madeCb === cb) this.madeCb = null }
  }

  made(m: MadeOnCanvas) {
    this.madeCb?.(m)
  }

  /** A video's own shot list as a Storyboard node on the canvas; null when no canvas can. */
  storyboardFromShots(videoId: string): Promise<{ storyboardId: string }> | null {
    return this.makes ? this.makes.storyboardFromShots(videoId) : null
  }

  /** Make video on the canvas; null when no canvas can. */
  makeVideo(from: MakeVideoFrom): Promise<MadeVideo> | null {
    return this.makes ? this.makes.makeVideo(from) : null
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

/** An editor is open over the canvas (the Image editor, edit-canvas-pictures): its keys are its own. */
export function editorOver(): boolean {
  return typeof document !== 'undefined' && !!document.querySelector('[data-image-editor]')
}

/** Is a key press a canvas tool letter (no modifier, not while typing, no editor over the canvas)? */
export function toolLetter(e: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'target' | 'isComposing'>): string | null {
  if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing || editorOver()) return null
  const t = e.target as { closest?: (s: string) => unknown } | null
  if (t?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return null
  return /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : null
}
