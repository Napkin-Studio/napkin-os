// The outline rail (ui-behaviour 3.10; item 3): scenes and shots in order, the current one
// blue, each shot with its length and who last wrote it. Shots drag to reorder: the row lifts,
// its old place stays a dashed slot, a blue drop line opens where it will land, and the numbers
// hold until the drop. Keyboard: focus a handle, Space, ↑↓, then Space to drop or Esc to cancel.
// A drop is one rank write (and the scene when it crosses scenes): script/edits.ts moveShotTo.

import { useMemo, useState, type ReactNode } from 'react'
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors,
  type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, type SortingStrategy } from '@dnd-kit/sortable'
import type { CameraSize } from '../contracts/types'
import type { ShotPlace } from '../../../clan-store/src'
import { neighboursAt, sceneAt, type ScriptRow } from './compose'

/** Rows never shift while dragging: the numbers and places hold until the drop. */
const still: SortingStrategy = () => null

export interface OutlineProps {
  rows: ScriptRow[]
  current?: string
  onShot(shotId: string): void
  onScene(sceneId: string): void
  onMove(shotId: string, place: ShotPlace): void
  writer(lastWriter: string | undefined, item: { kind: 'scene' | 'shot'; id: string; label: string }): ReactNode
  disabled?: boolean
  footer?: ReactNode
}

const words = (s: CameraSize) => s.replace(/_/g, ' ')

export function Outline({ rows, current, onShot, onScene, onMove, writer, disabled, footer }: OutlineProps) {
  const shotRows = rows.filter((r): r is Extract<ScriptRow, { kind: 'shot' }> => r.kind === 'shot')
  const ids = useMemo(() => shotRows.map((r) => r.id), [shotRows])
  const longest = shotRows.reduce<string | null>((m, r) => (!m || r.shot.duration_s > (shotRows.find((x) => x.id === m)?.shot.duration_s ?? 0) ? r.id : m), null)
  const [active, setActive] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const line = (() => {
    if (!active || !over || active === over) return null
    const a = ids.indexOf(active)
    const o = ids.indexOf(over)
    return { at: over, after: o > a }
  })()
  const end = (e: DragEndEvent) => {
    const from = String(e.active.id)
    const to = e.over ? String(e.over.id) : null
    setActive(null)
    setOver(null)
    if (!to || to === from) return
    // Into the place of `to`: without the moving shot, index o is after `to` when moving down and
    // before it when moving up, which is where the drop line showed.
    const place = neighboursAt(ids, from, ids.indexOf(to))
    onMove(from, { ...place, sceneId: sceneAt(rows, place.beforeId, place.afterId) })
  }
  const dragging = active ? shotRows.find((r) => r.id === active) : undefined
  return (
    <nav className="se-outline" aria-label="Outline">
      <DndContext sensors={sensors} collisionDetection={closestCenter}
        onDragStart={(e: DragStartEvent) => setActive(String(e.active.id))}
        onDragOver={(e: DragOverEvent) => setOver(e.over ? String(e.over.id) : null)}
        onDragCancel={() => { setActive(null); setOver(null) }}
        onDragEnd={end}
        accessibility={{
          screenReaderInstructions: { draggable: 'To move a shot, press Space. Use the up and down arrows to choose its place, then Space to drop it there, or Escape to leave it where it was.' },
        }}>
        <SortableContext items={ids} strategy={still}>
          <ol className="ol">
            {rows.map((r) => {
              if (r.kind === 'scene') {
                return (
                  <li key={r.id} className="ol-scene">
                    <button className="ol-btn" onClick={() => onScene(r.id)} title={r.scene.heading || `Scene ${r.number}`}>
                      <span className="ol-n">{r.number}</span>
                      <span className="ol-heading">{r.scene.heading || 'Scene with no heading'}</span>
                      {writer(r.scene.last_writer, { kind: 'scene', id: r.id, label: r.scene.heading || `Scene ${r.number}` })}
                    </button>
                  </li>
                )
              }
              if (r.kind === 'shot') {
                return (
                  <ShotItem key={r.id} id={r.id} on={r.id === current} disabled={disabled}
                    line={line?.at === r.id ? (line.after ? 'after' : 'before') : null}
                    onPick={() => onShot(r.id)}>
                    <span className="ol-n">{r.number}</span>
                    <span className="ol-words">{(r.shot.action ?? '').split('\n')[0] || words(r.shot.camera.size)}</span>
                    <span className={`ol-len ${r.id === longest && shotRows.length > 2 ? 'warn' : ''}`}>{r.shot.duration_s.toFixed(1)} s</span>
                    {writer(r.shot.last_writer, { kind: 'shot', id: r.id, label: `Shot ${r.number}` })}
                  </ShotItem>
                )
              }
              if (r.kind === 'end_card') {
                return (
                  <li key={r.id} className="ol-shot ol-end">
                    <button className="ol-btn" onClick={() => onShot(r.id)}><span className="ol-n">{r.number}</span><span className="ol-words">End card</span><span className="ol-len">{r.shot.duration_s.toFixed(1)} s</span></button>
                  </li>
                )
              }
              return null
            })}
          </ol>
        </SortableContext>
        <DragOverlay>
          {dragging && (
            <div className="ol-lifted">
              <span className="ol-n">{dragging.number}</span>
              <span className="ol-words">{(dragging.shot.action ?? '').split('\n')[0] || words(dragging.shot.camera.size)}</span>
              <span className="ol-len">{dragging.shot.duration_s.toFixed(1)} s</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>
      {footer}
    </nav>
  )
}

function ShotItem({ id, on, line, disabled, onPick, children }: { id: string; on: boolean; line: 'before' | 'after' | null; disabled?: boolean; onPick: () => void; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useSortable({ id, disabled })
  return (
    <li ref={setNodeRef} className={`ol-shot ${on ? 'on' : ''} ${isDragging ? 'slot' : ''} ${line ? `drop-${line}` : ''}`} aria-current={on ? 'true' : undefined}>
      <span ref={setActivatorNodeRef} className="ol-handle" aria-label="Move this shot" {...attributes} {...listeners}>⋮⋮</span>
      <button className="ol-btn" onClick={onPick}>{children}</button>
    </li>
  )
}
