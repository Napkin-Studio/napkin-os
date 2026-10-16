// The one picked tile on every Campaign board (owner bug, 2026-10-16: tile bars and Jude's flag popovers
// stayed on screen, several at once, from two boards). One store for all boards: exactly one tile is
// picked at a time, and its bar is the only one shown; its flag list is open or not. Picking another
// tile, clearing (a click on empty canvas, Esc, a canvas selection, the tile panned or zoomed off
// screen) closes both. Pure, with a tiny subscribe for useSyncExternalStore.

export interface Picked { setId: string; sizeId: string; flags: boolean }

let picked: Picked | null = null
const subs = new Set<() => void>()
const emit = () => { for (const f of subs) f() }

export const tilePick = {
  subscribe(fn: () => void) {
    subs.add(fn)
    return () => { subs.delete(fn) }
  },
  get: (): Picked | null => picked,
  /** Pick a tile (its flag list closed), or keep it picked and open or close its flag list. */
  pick(setId: string, sizeId: string, flags = false) {
    if (picked?.setId === setId && picked.sizeId === sizeId && picked.flags === flags) return
    picked = { setId, sizeId, flags }
    emit()
  },
  toggleFlags(setId: string, sizeId: string) {
    const same = picked?.setId === setId && picked.sizeId === sizeId
    tilePick.pick(setId, sizeId, !(same && picked!.flags))
  },
  closeFlags() {
    if (!picked?.flags) return
    picked = { ...picked, flags: false }
    emit()
  },
  clear() {
    if (!picked) return
    picked = null
    emit()
  },
}

/** Whether a pointer-down at `target` keeps the pick: inside a tile, its bar or flag list, a board's
 *  send tray or Edit type, or a menu opened from them. Anywhere else (empty canvas, another board's
 *  header, the app's chrome) clears it. */
export function keepsPick(target: Element | null): boolean {
  return !!target?.closest?.('.cb-tile, .cb-float, .cb-tray, .cb-pop, .float')
}

/** Whether a tile's box on screen is still in the view (a tile panned or zoomed off closes its bar). */
export function onScreen(r: { left: number; top: number; right: number; bottom: number }, view: { w: number; h: number }): boolean {
  return r.right > 0 && r.bottom > 0 && r.left < view.w && r.top < view.h
}
