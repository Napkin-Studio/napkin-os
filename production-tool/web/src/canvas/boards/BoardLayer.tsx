// The boards on our own canvas (features/art-boards.clan): seeds the Ad template's
// seven boards once (document boards and board frames, with the nodes in theirs)
// and takes the rail's ⌥1…⌥9 and ⌥0 jumps onto the real frames. It draws
// nothing itself: the engine draws the frames; the rail is the chrome's.

import { useEffect } from 'react'
import { useServices } from '../../app/context'
import { systemUpdate } from '../../doc/store'
import type { CanvasAdapter } from '../core/canvasAdapter'
import { boardKey, jumpTo, seedBoards } from './boards'

export function BoardLayer({ canvas }: { canvas: CanvasAdapter }) {
  const services = useServices()

  useEffect(() => {
    const seeded = seedBoards(canvas, services.doc.get())
    if (!seeded) return
    canvas.transact((els) => seeded.apply(els), { undoable: false })
    if (seeded.boards.length) {
      void systemUpdate(services.doc, (d) => {
        for (const b of seeded.boards) d.boards[b.id] = b
      }, 'create the Ad template boards').catch((e) => console.warn('could not write the boards', e))
    }
    canvas.fit(canvas.elements(), { zoomFactor: 0.9, animate: false })
  }, [canvas, services])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const which = boardKey(e)
      if (which === null) return
      if (jumpTo(canvas, services.doc.get(), which, !matchMedia?.('(prefers-reduced-motion: reduce)').matches)) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canvas, services])

  return null
}
