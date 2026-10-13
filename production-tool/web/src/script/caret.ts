// The caret chain (features/script-editor.clan): the Script editor is a list of small
// editors (one per fragment) and single-line fields (scene headings), mounted on demand.
// The chain holds them in script order, so arrows, Tab and Enter move the caret across
// them as if they were one page. Focusing an item that is not mounted yet (a collapsed
// shot) asks the page to mount it, and the focus lands when it registers.

export type Where = 'start' | 'end'

export interface CaretItem {
  focus(where: Where): void
}

export class CaretChain {
  private order: string[] = []
  private readonly items = new Map<string, CaretItem>()
  private pending: { key: string; where: Where } | null = null
  /** Asked to show an item that is not mounted (the page expands its shot). */
  onWant: ((key: string) => void) | null = null

  /** The items in script order (keys: 'heading:<sceneId>', 'scene:<id>', 'shot:<id>', 'beat:<id>'). */
  setOrder(keys: string[]) {
    this.order = keys
  }

  keys(): readonly string[] {
    return this.order
  }

  register(key: string, item: CaretItem): () => void {
    this.items.set(key, item)
    if (this.pending?.key === key) {
      const { where } = this.pending
      this.pending = null
      item.focus(where)
    }
    return () => {
      if (this.items.get(key) === item) this.items.delete(key)
    }
  }

  isMounted(key: string): boolean {
    return this.items.has(key)
  }

  /** Put the caret in an item: now when it is mounted, else once it mounts. */
  focus(key: string, where: Where = 'start') {
    const item = this.items.get(key)
    if (item) {
      this.pending = null
      item.focus(where)
      return
    }
    this.pending = { key, where }
    this.onWant?.(key)
  }

  /** The next (or previous) item's key, or null at the end of the script. */
  neighbour(key: string, dir: 'up' | 'down'): string | null {
    const i = this.order.indexOf(key)
    if (i < 0) return null
    return this.order[dir === 'down' ? i + 1 : i - 1] ?? null
  }

  /** Move the caret out of `key` into its neighbour: true when there was one. */
  move(key: string, dir: 'up' | 'down'): boolean {
    const next = this.neighbour(key, dir)
    if (!next) return false
    this.focus(next, dir === 'down' ? 'start' : 'end')
    return true
  }
}

export const caretKey = (kind: 'heading' | 'scene' | 'shot' | 'beat' | 'end_card', id: string) => `${kind}:${id}`
