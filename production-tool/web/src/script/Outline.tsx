// The outline rail (ui-behaviour 3.10; item 3): scenes and shots in order, the current one
// blue, each shot with its length and who last wrote it. Shots drag to reorder: the row lifts,
// its old place stays a dashed slot, a blue drop line opens where it will land, and the numbers
// hold until the drop. Keyboard: focus a handle, Space, ↑↓, then Space to drop or Esc to cancel.
// A drop is one rank write (and the scene when it crosses scenes): script/edits.ts moveShotTo.
//
// Free text (features/script-freeform.clan) lists its paragraphs (¶1, ¶2, …); a screenplay with no shots yet
// lists each scene's lines under its heading; once Dex has planned, scenes and their shots.

import { useMemo, useState, type ReactNode } from 'react'
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors,
  type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, type SortingStrategy } from '@dnd-kit/sortable'
import type { CameraSize, Scene } from '../contracts/types'
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
  onAddScene?: () => void
  /** Free text: its paragraphs, in order (the outline lists them instead of scenes). */
  paragraphs?: { sceneId: string; index: number; text: string }[]
  /** A screenplay scene's lines to list under its heading (none once there are shots). */
  linesOf?: (scene: Scene) => { index: number; text: string }[]
  /** A paragraph or line picked: the caret goes there. */
  onLine?: (sceneId: string, index: number) => void
  /** The line the page is working on now (the Format menu's), marked. */
  currentLine?: { sceneId: string; index: number }
}

const words = (s: CameraSize) => s.replace(/_/g, ' ')
const cap = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1)

export function Outline({ rows, current, onShot, onScene, onMove, writer, disabled, footer, onAddScene, paragraphs, linesOf, onLine, currentLine }: OutlineProps) {
  const shotRows = rows.filter((r): r is Extract<ScriptRow, { kind: 'shot' }> => r.kind === 'shot')
  const ids = useMemo(() => shotRows.map((r) => r.id), [shotRows])
  const maxS = Math.max(0, ...shotRows.map((r) => r.shot.duration_s))
  const longest = shotRows.filter((r) => r.shot.duration_s === maxS).length === 1 ? shotRows.find((r) => r.shot.duration_s === maxS)?.id ?? null : null
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
  const sceneCount = rows.filter((r) => r.kind === 'scene').length
  const lines = (r: Extract<ScriptRow, { kind: 'scene' }>) => linesOf?.(r.scene) ?? []
  const nothing = paragraphs ? !paragraphs.length : !shotRows.length && rows.every((r) => r.kind !== 'scene' || (!r.scene.heading.trim() && !lines(r).length))
  const count = nothing ? 'nothing yet'
    : paragraphs ? `${paragraphs.length} ${paragraphs.length === 1 ? 'paragraph' : 'paragraphs'}`
      : shotRows.length ? `${sceneCount} ${sceneCount === 1 ? 'scene' : 'scenes'} · ${shotRows.length} ${shotRows.length === 1 ? 'shot' : 'shots'}`
        : `${sceneCount} ${sceneCount === 1 ? 'scene' : 'scenes'}`
  const lineItem = (sceneId: string, l: { index: number; text: string }, mark?: string) => (
    <li key={`${sceneId}:${l.index}`} className={`${mark ? 'ol-para' : 'ol-line'} ${currentLine?.sceneId === sceneId && currentLine.index === l.index ? 'on' : ''}`}>
      <button className="ol-btn" onClick={() => onLine?.(sceneId, l.index)} title={l.text}>
        {mark && <span className="ol-n">{mark}</span>}
        <span className="ol-words">{l.text}</span>
      </button>
    </li>
  )
  if (nothing || paragraphs) {
    return (
      <nav className={`se-outline ${nothing ? 'nothing' : ''}`} aria-label="Outline">
        <div className="ol-head"><span>Outline</span><span>{count}</span></div>
        {nothing
          ? <div className="ol-empty">Your outline builds as you write: paragraphs now, scenes and shots once there are some.</div>
          : <ol className="ol">{paragraphs!.map((p, i) => lineItem(p.sceneId, p, `¶${i + 1}`))}</ol>}
        {!nothing && <span className="ol-fill" />}
        {footer}
      </nav>
    )
  }
  return (
    <nav className="se-outline" aria-label="Outline">
      <div className="ol-head"><span>Outline</span><span>{count}</span></div>
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
                // A scene with no heading (free words before a screenplay) lists only its lines.
                const under = lines(r).map((l) => lineItem(r.id, l))
                if (!r.scene.heading.trim() && (under.length || !shotRows.length)) return under
                return [
                  <li key={r.id} className="ol-scene">
                    <button className="ol-btn" onClick={() => onScene(r.id)} title={r.scene.heading || `Scene ${r.number}`}>
                      <span className="ol-n">{r.number}</span>
                      <span className="ol-heading">{r.scene.heading || 'Scene with no heading'}</span>
                      {writer(r.scene.last_writer, { kind: 'scene', id: r.id, label: r.scene.heading || `Scene ${r.number}` })}
                    </button>
                  </li>,
                  ...under,
                ]
              }
              if (r.kind === 'shot') {
                return (
                  <ShotItem key={r.id} id={r.id} on={r.id === current} disabled={disabled}
                    line={line?.at === r.id ? (line.after ? 'after' : 'before') : null}
                    onPick={() => onShot(r.id)}>
                    <span className="ol-words">{r.number} · {cap(words(r.shot.camera.size))}</span>
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
      {onAddScene && <button type="button" className="ol-add" disabled={disabled} onClick={onAddScene}>+ Scene</button>}
      <span className="ol-fill" />
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
