import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { placeFloating } from '../lib/place'
import { onScreen, tilePick } from './pick'

/**
 * The picked tile's bar (and Jude's flag list above it), on the page rather than on the canvas: a fixed
 * size whatever the zoom, placed as the canvas's floating toolbars are (lib/place.ts placeFloating:
 * centred above the tile, below it only when there is no room above), so it never covers the next
 * row. The tile panned or zoomed off screen closes it.
 */
export function TileFloat({ anchor, children, onOffscreen = () => tilePick.clear() }: { anchor: RefObject<HTMLDivElement | null>; children: ReactNode; /** What to do when the picture is panned or scrolled out of view: the board clears its pick. */ onOffscreen?: () => void }) {
  const panel = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const a = anchor.current?.getBoundingClientRect()
    const el = panel.current
    if (!a || !el) return
    const view = { w: window.innerWidth, h: window.innerHeight }
    if (!onScreen(a, view)) {
      onOffscreen()
      return
    }
    // Never over the board's own header (See all sizes, Safe areas, Export): a tile in the top row would
    // otherwise put its bar right across them.
    const head = anchor.current?.closest('.cb-board')?.querySelector('.cb-head')?.getBoundingClientRect()
    const avoid = head ? [{ left: head.left, top: head.top, right: head.right, bottom: head.bottom }] : []
    // Below the tile's caption, not across it.
    const bottom = anchor.current?.closest('.cb-tile')?.getBoundingClientRect().bottom ?? a.bottom
    const p = placeFloating({ x: (a.left + a.right) / 2, top: a.top, bottom }, { w: el.offsetWidth, h: el.offsetHeight }, view, 10, 8, avoid)
    // Placed on the element itself after every render (the board moves with the canvas's view).
    el.style.left = `${p.left}px`
    el.style.top = `${p.top}px`
    el.style.visibility = 'visible'
  })
  return createPortal(
    <div ref={panel} className="cb-float" style={{ left: 0, top: 0, visibility: 'hidden' }}
      onPointerDown={(e) => e.stopPropagation()}>
      {children}
    </div>,
    document.body,
  )
}
