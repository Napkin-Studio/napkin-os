// The Video · Audio view (ui-behaviour 3.10, artboard 7; features/script-editor.clan): the same
// rows as the screenplay (compose.ts), as a three-column table, Shot | Video | Audio.
//
// - Header: a running-time strip, shots in proportion ('15.0 of 15 s'); a shot being moved is dashed.
// - Gutter: handle, number, timecode and length, camera chip. The open shot shows the camera
//   fields (Size, Angle, Move, Lens) with Edit camera (field patches on shots[id].camera).
// - Video: the action and Direction (ShotEditor), reference chips with picture and role, and the
//   open shot's moments on a track from 0 to its length: drag a marker (or ←/→ on it) to move it;
//   a Line tied to it moves too, in one step.
// - Audio: VO, Line, Music and Sound rows with their time in the shot; '+ VO / + Line / + Music / + Sound'.

import { useState, type PointerEvent as ReactPointerEvent } from 'react'
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type DragOverEvent } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, type SortingStrategy } from '@dnd-kit/sortable'
import { useServices } from '../app/context'
import { CAMERA_ANGLES, CAMERA_MOVEMENTS, CAMERA_SIZES, type Beat, type BeatKind, type Camera, type ProductionDocument, type Shot } from '../contracts/types'
import { updateDoc } from '../doc/store'
import { editShot } from '../jobs/stale'
import { useBlobUrl } from '../ui/hooks'
import type { ModelStore } from '../model/store'
import { beatsOf } from '../model/selectors'
import type { CaretChain } from './caret'
import { caretKey } from './caret'
import { neighboursAt, sceneAt, type ComposedScript } from './compose'
import { addBeat, moveShotTo } from './edits'
import { FragmentEditor } from './FragmentEditor'
import type { MentionHooks } from './mentions'
import { AUDIO_KINDS, nextMomentTime, setBeatTime, tieLine, timeLabel } from './moments'
import { ShotEditor } from './ShotEditor'
import { TimePill } from './TimePill'

type Doc = ProductionDocument
const still: SortingStrategy = () => null
const words = (s: string) => s.replace(/_/g, ' ')
const secs = (n: number) => `${(Math.round(n * 10) / 10).toFixed(1)} s`

export interface AVViewProps {
  composed: ComposedScript
  doc: Doc
  store: ModelStore
  chain: CaretChain
  current?: string
  setCurrent(id: string): void
  mentions: MentionHooks
  say(m: string): void
  onError(m: string | null): void
  disabled?: boolean
}

export function AVView(p: AVViewProps) {
  const { composed, store, onError } = p
  const shots = composed.shots
  const ids = shots.filter((s) => s.kind !== 'end_card').map((s) => s.id)
  const [active, setActive] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const target = composed.storyboard?.target_s ?? composed.script.target_s
  const end = (e: DragEndEvent) => {
    const from = String(e.active.id)
    const to = e.over ? String(e.over.id) : null
    setActive(null)
    setOver(null)
    if (!to || to === from) return
    const place = neighboursAt(ids, from, ids.indexOf(to))
    store.flush().then(() => moveShotTo(store, from, { ...place, sceneId: sceneAt(composed.rows, place.beforeId, place.afterId) })).catch((x) => onError(x instanceof Error ? x.message : 'That shot could not move.'))
  }
  const line = active && over && active !== over ? { at: over, after: ids.indexOf(over) > ids.indexOf(active) } : null
  return (
    <div className="av">
      {/* The header (mock ScriptAV): the script's title and facts, and the length strip, one labelled segment per shot. */}
      <div className="av-header">
        <div className="av-title">
          <h2>{composed.script.title || 'Untitled script'}</h2>
          <span>{target} s · {composed.storyboard?.ratio ?? '16:9'} · {shots.length} {shots.length === 1 ? 'shot' : 'shots'}</span>
        </div>
        <div className="av-strip" role="img" aria-label={`${secs(composed.total_s)} of ${target} s`}>
          <div className="av-strip-head"><span className="pt-label">Length</span><span className="av-strip-words">{target} s target · {composed.total_s.toFixed(1)} s estimated</span></div>
          <div className="av-strip-bar">
            {shots.map((s, i) => <span key={s.id} className={`seg ${s.id === p.current ? 'cur' : ''} ${s.id === active ? 'moving' : ''}`} style={{ flexGrow: s.duration_s }}>{i + 1} · {s.duration_s.toFixed(1)}</span>)}
          </div>
        </div>
      </div>
      <div className="av-table" role="table" aria-label="Shots, video and audio">
        <div className="av-row av-headrow" role="row">
          <span role="columnheader">Shot</span><span role="columnheader">Video</span><span role="columnheader">Audio</span>
        </div>
        <DndContext sensors={sensors} collisionDetection={closestCenter}
          onDragStart={(e) => setActive(String(e.active.id))}
          onDragOver={(e: DragOverEvent) => setOver(e.over ? String(e.over.id) : null)}
          onDragCancel={() => { setActive(null); setOver(null) }}
          onDragEnd={end}>
          <SortableContext items={ids} strategy={still}>
            {composed.rows.map((r) => (r.kind === 'shot' || r.kind === 'end_card') && (
              <AVRow key={r.id} {...p} shot={r.shot} number={r.number} start={r.start_s} end={r.kind === 'end_card'}
                line={line?.at === r.id ? (line.after ? 'after' : 'before') : null} />
            ))}
          </SortableContext>
        </DndContext>
        {!shots.length && <div className="av-empty faint">No shots yet. Plan shots, and they show here with their video and audio.</div>}
      </div>
    </div>
  )
}

function AVRow({ shot, number, start, end, line, doc, store, chain, current, setCurrent, mentions, say, onError, disabled }: AVViewProps & { shot: Shot; number: number; start: number; end: boolean; line: 'before' | 'after' | null }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useSortable({ id: shot.id, disabled: disabled || end })
  const open = current === shot.id
  const docStore = useServices().doc
  const beats = beatsOf(doc, shot.id)
  const moments = beats.filter((b) => b.kind === 'moment')
  const audio = beats.filter((b) => b.kind !== 'moment' && b.kind !== 'camera')
  const run = (fn: () => Promise<unknown>) => {
    onError(null)
    Promise.resolve().then(fn).catch((e) => onError(e instanceof Error ? e.message : 'That did not work.'))
  }
  const add = (kind: BeatKind) => run(() => addBeat(store, shot.id, kind, { at_s: kind === 'moment' ? nextMomentTime(doc, shot.id) : 0 }).then((id) => chain.focus(caretKey('beat', id), 'start')))
  return (
    <div ref={setNodeRef} role="row" className={`av-row ${open ? 'open' : ''} ${isDragging ? 'slot' : ''} ${line ? `drop-${line}` : ''}`} aria-current={open ? 'true' : undefined}>
      <div className="av-gutter" role="cell">
        {!end && <span ref={setActivatorNodeRef} className="ol-handle" aria-label={`Move shot ${number}`} {...attributes} {...listeners}>⋮⋮</span>}
        <button className="av-no" onClick={() => setCurrent(shot.id)} aria-label={`Shot ${number}: open`}>{end ? 'END' : number}</button>
        <span className="av-tc">{timeLabel(start)}–{timeLabel(start + shot.duration_s)}</span>
        <span className="av-len">{secs(shot.duration_s)}</span>
        <span className="sp-chip">{words(shot.camera.size)} · {words(shot.camera.movement ?? 'static')}</span>
        {open && <CameraFields shot={shot} />}
      </div>
      <div className="av-video" role="cell">
        {open ? (
          <>
            <ShotEditor store={store} shotId={shot.id} name={`Shot ${number}`} chain={chain} chainKey={caretKey('shot', shot.id)} mentions={mentions}
              keys={{ out: (dir) => chain.move(caretKey('shot', shot.id), dir), moment: () => { add('moment'); return true } }} />
            <RefChips shot={shot} doc={doc} />
            <div className="av-moments" aria-label="Moments in this shot">
              <div className="eyebrow">Moments in this shot</div>
              <MomentTrack shot={shot} moments={moments} onMove={(id, at) => run(() => updateDoc(docStore, (d) => setBeatTime(d, id, at), `move beats[${id}]`))} />
              {moments.map((m) => (
                <div key={m.id} className="sp-beat kind-moment">
                  <TimePill at={m.at_s} duration={shot.duration_s} onSet={(at) => run(() => updateDoc(docStore, (d) => setBeatTime(d, m.id, at), `move beats[${m.id}]`))} />
                  <FragmentEditor store={store} kind="beat" id={m.id} label={`Moment at ${timeLabel(m.at_s)}`} className="sp-beattext" mentions={mentions}
                    chain={chain} chainKey={caretKey('beat', m.id)} keys={{ out: (dir) => chain.move(caretKey('beat', m.id), dir) }} onNotice={say} placeholder="What happens then…" />
                </div>
              ))}
              <button className="linkbtn" onClick={() => add('moment')}>+ Moment</button>
            </div>
          </>
        ) : (
          <button className="av-line" onClick={() => setCurrent(shot.id)}>
            {(shot.action ?? '').split('\n')[0] || <i className="faint">No action yet</i>}
            {moments.length > 0 && <span className="faint"> · {moments.length} {moments.length === 1 ? 'moment' : 'moments'}</span>}
          </button>
        )}
      </div>
      <div className="av-audio" role="cell">
        {audio.map((b) => (
          <AudioRow key={b.id} beat={b} shot={shot} moments={moments} open={open} store={store} chain={chain} mentions={mentions} say={say} onError={onError} />
        ))}
        {open && (
          <div className="av-add">
            {AUDIO_KINDS.map((k) => <button key={k.kind} className="linkbtn" onClick={() => add(k.kind)}>{k.add}</button>)}
          </div>
        )}
        {!open && !audio.length && <span className="faint">—</span>}
      </div>
    </div>
  )
}

/** Size, Angle, Move and Lens as chips; Edit camera turns them into choices (field patches). */
function CameraFields({ shot }: { shot: Shot }) {
  const { doc: docStore } = useServices()
  const [editing, setEditing] = useState(false)
  const set = (patch: Partial<Camera>) => void updateDoc(docStore, (d) => editShot(d, shot.id, { camera: { ...shot.camera, ...patch } }), 'edit shot camera')
  const c = shot.camera
  if (!editing) {
    return (
      <div className="av-camera">
        <span className="sp-chip">Size · {words(c.size)}</span>
        {c.angle && <span className="sp-chip">Angle · {words(c.angle)}</span>}
        <span className="sp-chip">Move · {words(c.movement ?? 'static')}</span>
        {c.lens_mm && <span className="sp-chip">Lens · {c.lens_mm} mm</span>}
        <button className="linkbtn" onClick={() => setEditing(true)}>Edit camera</button>
      </div>
    )
  }
  return (
    <div className="av-camera editing">
      <label>Size <select className="select xs" value={c.size} onChange={(e) => set({ size: e.target.value as Camera['size'] })}>{CAMERA_SIZES.map((x) => <option key={x} value={x}>{words(x)}</option>)}</select></label>
      <label>Angle <select className="select xs" value={c.angle ?? ''} onChange={(e) => set({ angle: (e.target.value || undefined) as Camera['angle'] })}><option value="">—</option>{CAMERA_ANGLES.map((x) => <option key={x} value={x}>{words(x)}</option>)}</select></label>
      <label>Move <select className="select xs" value={c.movement ?? 'static'} onChange={(e) => set({ movement: e.target.value as Camera['movement'] })}>{CAMERA_MOVEMENTS.map((x) => <option key={x} value={x}>{words(x)}</option>)}</select></label>
      <label>Lens <input className="input xs" type="number" min={8} max={300} step={1} value={c.lens_mm ?? ''} placeholder="mm"
        onChange={(e) => set({ lens_mm: e.target.value ? Math.max(8, Math.min(300, Number(e.target.value))) : undefined })} /></label>
      <button className="linkbtn" onClick={() => setEditing(false)}>Done</button>
    </div>
  )
}

/** The shot's references: picture and role. */
function RefChips({ shot, doc }: { shot: Shot; doc: Doc }) {
  const refs = (shot.refs ?? []).map((id) => {
    const r = doc.refs[id]
    if (r) return { id, name: `${r.key}_${r.variant}`, role: r.role, asset: r.asset }
    const k = doc.keys[id]
    const front = k ? Object.values(doc.refs).find((x) => x.key === k.key && x.variant === 'front') : undefined
    return k ? { id, name: k.key, role: k.role, asset: front?.asset } : null
  }).filter((x) => x !== null) as { id: string; name: string; role: string; asset?: string }[]
  if (!refs.length) return null
  return <div className="av-refs">{refs.map((r) => <RefChip key={r.id} {...r} />)}</div>
}

function RefChip({ name, role, asset }: { name: string; role: string; asset?: string }) {
  const url = useBlobUrl(asset)
  return (
    <span className="av-ref">
      {url ? <img src={url} alt="" /> : <span className="av-noimg" />}
      <b>@{name}</b><span className="faint">{words(role)}</span>
    </span>
  )
}

/** A track from 0 to the shot's length with a marker per moment: drag one, or ←/→ on it, half a second at a time. */
function MomentTrack({ shot, moments, onMove }: { shot: Shot; moments: Beat[]; onMove: (id: string, at: number) => void }) {
  const [drag, setDrag] = useState<{ id: string; at: number } | null>(null)
  const pct = (s: number) => `${Math.min(100, (s / shot.duration_s) * 100)}%`
  const atFrom = (e: ReactPointerEvent, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    return Math.max(0, Math.min(shot.duration_s, ((e.clientX - r.left) / Math.max(1, r.width)) * shot.duration_s))
  }
  return (
    <div className="av-track" role="group" aria-label={`0 to ${secs(shot.duration_s)}`}
      onPointerMove={(e) => { if (drag) setDrag({ id: drag.id, at: Math.round(atFrom(e, e.currentTarget) * 2) / 2 }) }}
      onPointerUp={() => { if (drag) { onMove(drag.id, drag.at); setDrag(null) } }}
      onPointerLeave={() => setDrag(null)}>
      {moments.map((m) => {
        const at = drag?.id === m.id ? drag.at : m.at_s
        return (
          <button key={m.id} className={`av-marker ${drag?.id === m.id ? 'dragging' : ''}`} style={{ left: pct(at) }}
            aria-label={`Moment at ${timeLabel(at)}; arrows move it half a second`}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); setDrag({ id: m.id, at: m.at_s }) }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault()
                onMove(m.id, Math.max(0, Math.min(shot.duration_s, m.at_s + (e.key === 'ArrowLeft' ? -0.5 : 0.5))))
              }
            }}>{timeLabel(at)}</button>
        )
      })}
    </div>
  )
}

/** One audio row: its kind, its time, a Line's speaker and the moment it is tied to, and its words. */
function AudioRow({ beat, shot, moments, open, store, chain, mentions, say, onError }: { beat: Beat; shot: Shot; moments: Beat[]; open: boolean; store: ModelStore; chain: CaretChain; mentions: MentionHooks; say(m: string): void; onError(m: string | null): void }) {
  const { doc: docStore } = useServices()
  const label = AUDIO_KINDS.find((k) => k.kind === beat.kind)?.label ?? beat.kind
  const run = (fn: () => Promise<unknown>) => {
    onError(null)
    Promise.resolve().then(fn).catch((e) => onError(e instanceof Error ? e.message : 'That did not work.'))
  }
  if (!open) {
    return <div className="av-audiorow"><span className="av-kind">{label}</span><span className="faint">{timeLabel(beat.at_s)}</span> {beat.speaker && <b>{beat.speaker}</b>} <span>{beat.text}</span></div>
  }
  return (
    <div className="av-audiorow open">
      <span className="av-kind">{label}</span>
      <TimePill at={beat.at_s} duration={shot.duration_s} onSet={(at) => run(() => updateDoc(docStore, (d) => setBeatTime(d, beat.id, at), `move beats[${beat.id}]`))} />
      {beat.kind === 'line' && (
        <>
          <input className="sp-speaker" aria-label="Who speaks" placeholder="WHO" defaultValue={beat.speaker ?? ''}
            onBlur={(e) => void docStore.change((d) => { if (d.beats[beat.id]) d.beats[beat.id].speaker = e.target.value.toUpperCase().slice(0, 60) || undefined }, { action: `set beats[${beat.id}] speaker` })} />
          {moments.length > 0 && (
            <select className="select xs" aria-label="Tied to a moment" value={beat.moment_id ?? ''}
              onChange={(e) => run(() => updateDoc(docStore, (d) => tieLine(d, beat.id, e.target.value || null), `set beats[${beat.id}] moment`))}>
              <option value="">not tied</option>
              {moments.map((m) => <option key={m.id} value={m.id}>tied to moment {timeLabel(m.at_s)}</option>)}
            </select>
          )}
        </>
      )}
      <FragmentEditor store={store} kind="beat" id={beat.id} label={`${label} at ${timeLabel(beat.at_s)}`} className="sp-beattext" mentions={mentions}
        chain={chain} chainKey={caretKey('beat', beat.id)} keys={{ out: (dir) => chain.move(caretKey('beat', beat.id), dir) }} onNotice={say}
        placeholder={beat.kind === 'line' ? 'What they say…' : beat.kind === 'music' ? 'The music…' : beat.kind === 'sound' ? 'The sound…' : 'The voice-over…'} />
    </div>
  )
}
