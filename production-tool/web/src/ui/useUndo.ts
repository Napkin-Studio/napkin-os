// One pending "Deleted · Undo" per place, gone after a few seconds or when used.

import { useCallback, useEffect, useRef, useState } from 'react'

export const UNDO_MS = 8000

export interface UndoOffer {
  /** What it says before "Undo" ("Shot 2 deleted"). */
  label: string
  undo: () => void | Promise<void>
  /** Where it shows (a component decides what this means: a shot id, a version…). */
  key?: string
  /** On the canvas: the scene point where the thing was. */
  at?: { x: number; y: number }
  /**
   * Has the step been taken back some other way (⌘Z, the undo buttons)? Then the offer leaves at
   * once: "2 deleted · Undo" never stays once the things are back. Read by offerGone.
   */
  gone?: (live: ReadonlySet<string>) => boolean
}

/** Is the offer's step already taken back, given the ids live on the canvas now? */
export const offerGone = (o: UndoOffer | null, live: ReadonlySet<string>): boolean => !!o?.gone?.(live)

/** A delete's offer leaves when any of what it deleted is live again; a make's when what it made is gone. */
export const backWhenLive = (ids: readonly string[]) => (live: ReadonlySet<string>) => ids.some((id) => live.has(id))
export const goneWhenDead = (ids: readonly string[]) => (live: ReadonlySet<string>) => ids.every((id) => !live.has(id))

/** One pending Undo, gone after UNDO_MS or when used. */
export function useUndo(ms = UNDO_MS): [UndoOffer | null, (o: UndoOffer | null) => void, () => void] {
  const [offer, setOffer] = useState<UndoOffer | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const set = useCallback((o: UndoOffer | null) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = o ? setTimeout(() => setOffer(null), ms) : null
    setOffer(o)
  }, [ms])
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  const run = useCallback(() => {
    const o = offer
    set(null)
    if (o) void o.undo()
  }, [offer, set])
  return [offer, set, run]
}
