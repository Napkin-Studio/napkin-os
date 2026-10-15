// The Storyboard editor's drag (ui-behaviour 3.11): dnd-kit over the shot cards, by their handles.
// The rules (where a drop lands, Dex's words, the write) are in shotDrag.ts.

import { useState, type ReactNode } from 'react'
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors,
  type Announcements, type DragEndEvent, type DragMoveEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, type SortingStrategy } from '@dnd-kit/sortable'
import type { ProductionDocument } from '../contracts/types'
import { DragCtx, dragWords, dropPlace, dropSide, type Drop } from './shotDrag'

type Doc = ProductionDocument

/** Cards never shift while dragging: the numbers and places hold until the drop. */
const still: SortingStrategy = () => null

const centreX = (r: { left: number; width: number } | null | undefined) => (r ? r.left + r.width / 2 : null)

export interface ShotSortProps {
  /** The shots in rank order. */
  ids: string[]
  doc: Doc
  /** The drop: the shot and its new neighbours. Errors show where the page shows them. */
  onMove(shotId: string, place: { beforeId: string | null; afterId: string | null }): void
  /** The lifted card under the pointer. */
  overlay(shotId: string): ReactNode
  /** Dex's line while dragging (the page puts it in its toast slot). */
  note(words: string | null): ReactNode
  children: ReactNode
}

export function ShotSort({ ids, doc, onMove, overlay, note, children }: ShotSortProps) {
  const [active, setActive] = useState<string | null>(null)
  const [drop, setDrop] = useState<Drop | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const place = active && drop ? dropPlace(ids, active, drop) : null
  const num = (id: string) => ids.indexOf(id) + 1
  const track = (e: DragMoveEvent) => {
    const from = String(e.active.id)
    const over = e.over ? String(e.over.id) : null
    if (!over) return setDrop(null)
    const a = centreX(e.active.rect.current.translated)
    const o = centreX(e.over?.rect)
    const side = dropSide(ids, from, over, a !== null && o !== null ? { active: a, over: o } : undefined)
    setDrop((was) => (was?.over === over && was.side === side ? was : { over, side }))
  }
  const clear = () => { setActive(null); setDrop(null) }
  const end = (e: DragEndEvent) => {
    const from = String(e.active.id)
    const at = drop
    clear()
    if (!e.over || !at) return
    const p = dropPlace(ids, from, at)
    if (p) onMove(from, p)
  }
  const where = (from: string, d: Drop | null) => {
    const p = d ? dropPlace(ids, from, d) : null
    if (!p) return `Shot ${num(from)} stays where it is.`
    return p.beforeId && p.afterId ? `Shot ${num(from)} moves between ${num(p.beforeId)} and ${num(p.afterId)}.`
      : p.afterId ? `Shot ${num(from)} moves to the start.` : `Shot ${num(from)} moves to the end.`
  }
  const announcements: Announcements = {
    onDragStart: ({ active: a }) => `Picked up shot ${num(String(a.id))}.`,
    onDragOver: ({ active: a }) => where(String(a.id), drop),
    onDragMove: () => undefined,
    onDragEnd: ({ active: a, over }) => (over && drop && dropPlace(ids, String(a.id), drop) ? `${where(String(a.id), drop)} Dropped.` : `Shot ${num(String(a.id))} stays where it was.`),
    onDragCancel: ({ active: a }) => `Shot ${num(String(a.id))} stays where it was.`,
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter}
      onDragStart={(e: DragStartEvent) => { setActive(String(e.active.id)); setDrop(null) }}
      onDragMove={track}
      onDragOver={track}
      onDragCancel={clear}
      onDragEnd={end}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: 'To move a shot, press Space. Use the arrow keys to choose its place, then Space to drop it there, or Escape to leave it where it was.' },
      }}>
      <DragCtx.Provider value={{ ids, active, drop, place }}>
        <SortableContext items={ids} strategy={still}>{children}</SortableContext>
      </DragCtx.Provider>
      <DragOverlay dropAnimation={null}>{active ? overlay(active) : null}</DragOverlay>
      {note(active && place ? dragWords(doc, ids, active, place) : null)}
    </DndContext>
  )
}
