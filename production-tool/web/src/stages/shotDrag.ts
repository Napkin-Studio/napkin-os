// Drag reorder on the Storyboard editor: the rules (ShotSort.tsx is the drag itself) (ui-behaviour 3.11 "Drag reorder"; review item 3).
// The card lifts by its handle only, so the card's text fields and buttons keep working: it
// tilts with a blue outline and a shadow, its old spot stays dashed, and a 4px blue drop line
// carries "Shot 5 moves here". The numbers hold until the drop. While dragging, Dex names the
// clips the move will mark. The drop is script/edits.ts moveShotTo: one rank write (and the
// scene when it crosses scenes) with the drift marks, one undo step. Keyboard as in 3.10:
// focus a handle, Space, the arrows, then Space to drop or Esc to cancel.

import { createContext, useContext } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import type { ShotPlace } from '../../../clan-store/src'
import type { ProductionDocument } from '../contracts/types'
import { currentTake } from '../model/selectors'
import { moveShotTo } from '../script/edits'
import type { ModelStore } from '../model/store'

type Doc = ProductionDocument
export type Side = 'before' | 'after'
export interface Drop { over: string; side: Side }

/**
 * The shots either side of the drop, or null when it would leave the shot where it is.
 * `ids` are the shots in rank order, the moving one included.
 */
export function dropPlace(ids: string[], moving: string, drop: Drop): { beforeId: string | null; afterId: string | null } | null {
  if (drop.over === moving || !ids.includes(moving) || !ids.includes(drop.over)) return null
  const rest = ids.filter((x) => x !== moving)
  const i = rest.indexOf(drop.over) + (drop.side === 'after' ? 1 : 0)
  const place = { beforeId: rest[i - 1] ?? null, afterId: rest[i] ?? null }
  const was = ids.indexOf(moving)
  if ((ids[was - 1] ?? null) === place.beforeId && (ids[was + 1] ?? null) === place.afterId) return null
  return place
}

/**
 * Which side of the card under it the dragged card lands on: the side its centre is on, and
 * when the centres meet (the keyboard puts one exactly on the other) the side it came from
 * decides, as in the outline: moving forward lands after, moving back lands before.
 */
export function dropSide(ids: string[], moving: string, over: string, centres?: { active: number; over: number }): Side {
  if (centres && Math.abs(centres.active - centres.over) > 2) return centres.active < centres.over ? 'before' : 'after'
  return ids.indexOf(over) > ids.indexOf(moving) ? 'after' : 'before'
}

/** The scene the moved shot joins: the one above's, else the one below's (script/compose sceneAt). */
export function sceneOfPlace(d: Doc, place: { beforeId: string | null; afterId: string | null }): string | null | undefined {
  const sceneOf = (id: string | null) => (id && d.shots[id] ? d.shots[id].scene_id ?? null : undefined)
  const above = sceneOf(place.beforeId)
  if (above !== undefined) return above
  return sceneOf(place.afterId)
}

const list = (ns: number[]) => (ns.length <= 1 ? String(ns[0] ?? '') : `${ns.slice(0, -1).join(', ')} and ${ns.at(-1)}`)

/**
 * Dex's line while a shot is dragged (3.11): where it would land, and which clips the move
 * marks to check. The clips are the ones script/edits.ts orderMarks marks: the moved shot's and
 * its new neighbours', where each has one.
 */
export function dragWords(d: Doc, ids: string[], moving: string, place: { beforeId: string | null; afterId: string | null }): string {
  const n = (id: string | null) => (id ? ids.indexOf(id) + 1 : 0)
  const me = n(moving)
  const where = place.beforeId && place.afterId ? `lands between ${n(place.beforeId)} and ${n(place.afterId)}, the cuts on both sides change`
    : place.afterId ? `goes first, before ${n(place.afterId)}, the cut into ${n(place.afterId)} changes`
      : `goes last, after ${n(place.beforeId)}, the cut out of ${n(place.beforeId)} changes`
  const clips = [moving, place.beforeId, place.afterId].filter((x): x is string => !!x && !!currentTake(d, x)).map(n).sort((a, b) => a - b)
  const then = clips.length ? `I will mark ${clips.length === 1 ? 'clip' : 'clips'} ${list(clips)} to check.` : 'No clips are made yet, so nothing needs checking.'
  return `If shot ${me} ${where}. ${then}`
}

/** The drop, written: one undo step with its drift marks, into the scene of the shot above. */
export function moveOnStoryboard(store: ModelStore, shotId: string, place: { beforeId: string | null; afterId: string | null }) {
  const d = store.get()
  const sceneId = sceneOfPlace(d, place)
  return moveShotTo(store, shotId, { ...place, ...(sceneId !== undefined ? { sceneId } : {}) } satisfies ShotPlace)
}

export interface DragState { ids: string[]; active: string | null; drop: Drop | null; place: { beforeId: string | null; afterId: string | null } | null }
export const DragCtx = createContext<DragState>({ ids: [], active: null, drop: null, place: null })

/** One card's part in the drag: its handle's props, its dashed slot, and its drop line. */
export function useShotSort(id: string, disabled?: boolean) {
  const s = useSortable({ id, disabled })
  const state = useContext(DragCtx)
  const line = state.place && state.drop?.over === id ? state.drop.side : null
  return {
    setNodeRef: s.setNodeRef,
    setActivatorNodeRef: s.setActivatorNodeRef,
    attributes: s.attributes,
    listeners: s.listeners,
    lifted: s.isDragging,
    line,
    dragging: state.active !== null,
    /** The moving shot's number, for the drop line. */
    moving: state.active ? state.ids.indexOf(state.active) + 1 : 0,
  }
}

