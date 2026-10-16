// A film's tile on the Campaign board's Film lane (features/campaign-formats.clan, phases 5 and 6): its
// player, and its actions. Beats (keep or drop a shot; the windows refit and it renders again, free),
// Adjust crop (a still box per shot over its frame; free), Remake for vertical (the tile's shots made again
// at its shape on a model that carries the characters: paid, each its own job, through the send tray with
// shot × method × model and no price), Captions on or off (CF9), Lock.

import { useRef, useState } from 'react'
import { useConfig, useDoc } from '../app/context'
import { modelChoicesFor } from '../capabilities'
import type { FormatSet, Id, ModelChoice, PersonRef, PxBox, Size } from '../contracts/types'
import { useBlobUrl } from '../ui/hooks'
import { REMAKE_MODELS, cropKeys, isSocialShape, masterShots, reframeKey, sameShape, shapeOf } from './film'
import { remakeShots, setBeat, setCaptions, setShotCrop, type FilmDeps } from './filmJobs'

/** The film itself on the tile: its first frame, playing while hovered or picked. */
export function FilmPic({ sha, picked, label }: { sha?: string; picked: boolean; label: string }) {
  const url = useBlobUrl(sha)
  const ref = useRef<HTMLVideoElement>(null)
  if (!url) return null
  return (
    <video ref={ref} className="cb-made" src={url} muted loop playsInline preload="metadata" aria-label={label} controls={picked}
      onMouseEnter={() => { void ref.current?.play().catch(() => {}) }} onMouseLeave={() => { if (!picked) ref.current?.pause() }} />
  )
}

type Panel = 'beats' | 'crop' | 'remake' | null

export function FilmTools({ size, set, deps, by, say, onTray, onLock }: {
  size: Size
  set: FormatSet
  deps: FilmDeps
  by: PersonRef
  say(t: string): void
  onTray(t: { who: 'wren' | 'rhea'; title: string; rows: { id: string; name: string; words: string }[]; note?: string; send(): Promise<void> }): void
  onLock(on: boolean): void
}) {
  const doc = useDoc()
  const { config } = useConfig()
  const [panel, setPanel] = useState<Panel>(null)
  const video = set.master.kind === 'video' ? set.master.id : undefined
  const shots = video ? masterShots(doc, video).filter((s) => !s.endCard) : []
  const shape = shapeOf(size)
  const reframe = !sameShape(shape, { w: set.master.w ?? 16, h: set.master.h ?? 9 })
  const capsOn = size.layers?.captions ? !size.layers.captions.hidden : isSocialShape(shape)
  const remakes = (() => {
    const all = modelChoicesFor('clip', config)
    const carry = all.filter((m) => REMAKE_MODELS.includes(m.model))
    return carry.length ? carry : all
  })()
  const making = size.status === 'making'
  return (
    <>
      {panel === 'beats' && (
        <div className="cb-flags pt-panel" role="dialog" aria-label="Beats">
          <b>Beats · {size.length_s} s</b>
          {shots.map((s) => {
            const b = size.beats?.find((x) => x.shot_id === s.shotId)
            const on = !!size.edl?.some((w) => w.shot_id === s.shotId)
            return (
              <label key={s.shotId} className="cb-check">
                <span><input type="checkbox" checked={on} disabled={making || !!size.locked}
                  onChange={() => { void setBeat(deps, size.id, s.shotId, !on, by).then(() => say(`${on ? 'Dropped' : 'Kept'} shot ${s.number} · cutting it again`)) }} /> Shot {s.number}</span>
                <span className="faint">{b?.why ?? (on ? 'Kept' : 'Dropped')}{b?.by === 'person' ? ' · yours' : ''}</span>
              </label>
            )
          })}
        </div>
      )}
      {panel === 'crop' && <ShotCrop size={size} set={set} shots={shots} onSave={(id, crop) => { setPanel(null); void setShotCrop(deps, size.id, id, crop, by).then(() => say('Crop saved · cutting it again')) }} onClose={() => setPanel(null)} />}
      {panel === 'remake' && (
        <RemakePick size={size} shots={shots.filter((s) => size.edl?.some((w) => w.shot_id === s.shotId))} models={remakes}
          onClose={() => setPanel(null)}
          onNext={(ids, model, label) => {
            setPanel(null)
            onTray({
              who: 'wren', title: `Remake for ${shape.w}×${shape.h}`,
              rows: ids.map((id) => ({ id, name: `Shot ${shots.find((s) => s.shotId === id)?.number ?? '?'} · ${size.delivery.width}×${size.delivery.height}`, words: `Remake · ${label}` })),
              note: 'Each shot is made again at this shape from its frame, with its characters. Every version of this shape that keeps it is cut again.',
              send: async () => {
                await remakeShots(deps, size.id, ids, model)
                say(`Remaking ${ids.length} ${ids.length === 1 ? 'shot' : 'shots'}`)
              },
            })
          }} />
      )}
      <div className="cb-tools toolbar" role="toolbar" aria-label="Film actions">
        <button type="button" className="btn sm" aria-pressed={panel === 'beats'} onClick={() => setPanel(panel === 'beats' ? null : 'beats')}>Beats</button>
        <button type="button" className="btn sm" aria-pressed={panel === 'crop'} disabled={!reframe || !!size.locked} title={!reframe ? 'The ad\'s own shape: nothing to crop' : undefined}
          onClick={() => setPanel(panel === 'crop' ? null : 'crop')}>Adjust crop</button>
        <button type="button" className="btn sm" aria-pressed={panel === 'remake'} disabled={!reframe || !remakes.length || !!size.locked}
          title={!reframe ? 'The ad\'s own shape' : !remakes.length ? 'Off for your agency' : 'Make the shots again at this shape, with their characters'}
          onClick={() => setPanel(panel === 'remake' ? null : 'remake')}>Remake for {shape.h > shape.w ? 'vertical' : 'this shape'}</button>
        <button type="button" className="btn sm" aria-pressed={capsOn} disabled={making || !!size.locked}
          onClick={() => { void setCaptions(deps, size.id, !capsOn, by).then(() => say(capsOn ? 'Captions off · cutting it again' : 'Captions on · cutting it again')) }}>Captions {capsOn ? 'on' : 'off'}</button>
        <button type="button" className="btn sm" onClick={() => onLock(!size.locked)}>{size.locked ? 'Unlock' : 'Lock'}</button>
      </div>
    </>
  )
}

/** Adjust crop on a clip tile: pick a shot, drag its box over its frame. */
function ShotCrop({ size, set, shots, onSave, onClose }: {
  size: Size
  set: FormatSet
  shots: ReturnType<typeof masterShots>
  onSave(shotId: Id, crop: PxBox | null): void
  onClose(): void
}) {
  const kept = shots.filter((s) => size.edl?.some((w) => w.shot_id === s.shotId))
  const [shotId, setShotId] = useState<Id | undefined>(kept[0]?.shotId)
  const w = size.edl?.find((x) => x.shot_id === shotId)
  const shot = kept.find((s) => s.shotId === shotId)
  const take = w?.take_size ?? shot?.takeSize ?? { w: 1920, h: 1080 }
  const start = w?.crop ?? w?.crop_keys?.[0]?.box ?? cropKeys(take, shapeOf(size), []).keys[0].box
  const [box, setBox] = useState<PxBox>(start)
  const [drag, setDrag] = useState<{ x: number; y: number; box: PxBox } | null>(null)
  const url = useBlobUrl(shot?.frameAsset)
  // A shot made straight from the script has no frame: its take, held at the middle of its window.
  const clipUrl = useBlobUrl(shot?.frameAsset ? undefined : shot?.takeAsset)
  const mid = w ? (w.in_s + w.out_s) / 2 : 0
  const W = 300
  const k = W / take.w
  const H = Math.round(take.h * k)
  const r = w?.take_id ? set.reframes?.[reframeKey(w.take_id, size.delivery)] : undefined
  const pick = (id: Id) => {
    setShotId(id)
    const ww = size.edl?.find((x) => x.shot_id === id)
    const tk = ww?.take_size ?? kept.find((s) => s.shotId === id)?.takeSize ?? { w: 1920, h: 1080 }
    setBox(ww?.crop ?? ww?.crop_keys?.[0]?.box ?? cropKeys(tk, shapeOf(size), []).keys[0].box)
  }
  return (
    <div className="cb-flags pt-panel" role="dialog" aria-label="Adjust crop">
      <div className="cf-chips">
        {kept.map((s) => <button key={s.shotId} type="button" className={`cf-chip ${s.shotId === shotId ? 'on' : ''}`} onClick={() => pick(s.shotId)}>Shot {s.number}</button>)}
      </div>
      {r?.asset && <span className="faint">This shot is {r.method === 'outpaint' ? 'given new edges' : 'remade'} for this shape; its crop is used only if that is undone.</span>}
      <div className="cf-protect" style={{ width: W, height: H, cursor: 'grab' }} data-testid="clip-crop"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setDrag({ x: e.clientX, y: e.clientY, box }) }}
        onPointerMove={(e) => {
          if (!drag) return
          const zoom = e.currentTarget.getBoundingClientRect().width / W
          const dx = (e.clientX - drag.x) / zoom / k
          const dy = (e.clientY - drag.y) / zoom / k
          setBox({ ...drag.box, x: Math.min(Math.max(0, drag.box.x + dx), take.w - drag.box.w), y: Math.min(Math.max(0, drag.box.y + dy), take.h - drag.box.h) })
        }}
        onPointerUp={() => setDrag(null)}>
        {url && <img src={url} alt="" draggable={false} style={{ width: W, height: H }} />}
        {!url && clipUrl && <video src={clipUrl} muted preload="auto" style={{ width: W, height: H, display: 'block', pointerEvents: 'none', objectFit: 'fill' }}
          onLoadedMetadata={(e) => { e.currentTarget.currentTime = Math.min(mid, Math.max(0, e.currentTarget.duration - 0.05)) }} />}
        <span className="cf-pbox" style={{ left: box.x * k, top: box.y * k, width: box.w * k, height: box.h * k }} />
      </div>
      <div className="cb-row" style={{ display: 'flex', gap: 6 }}>
        <span className="cb-hint">Drag the box</span>
        <span className="pt-grow" />
        <button type="button" className="btn xs ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn xs ghost" disabled={!shotId} onClick={() => shotId && onSave(shotId, null)}>Reset</button>
        <button type="button" className="btn xs primary" disabled={!shotId} onClick={() => shotId && onSave(shotId, { x: Math.round(box.x * 10) / 10, y: Math.round(box.y * 10) / 10, w: box.w, h: box.h })}>Save</button>
      </div>
    </div>
  )
}

/** Remake for vertical: which of the tile's shots, and on which model; then the send tray. */
function RemakePick({ size, shots, models, onNext, onClose }: {
  size: Size
  shots: ReturnType<typeof masterShots>
  models: { provider: string; model: string; label: string }[]
  onNext(ids: Id[], model: ModelChoice, label: string): void
  onClose(): void
}) {
  const [ids, setIds] = useState<Set<Id>>(new Set())
  const [model, setModel] = useState(models[0])
  void size
  return (
    <div className="cb-flags pt-panel" role="dialog" aria-label="Remake for vertical">
      <b>Remake which shots?</b>
      {shots.map((s) => (
        <label key={s.shotId} className="cb-check">
          <span><input type="checkbox" checked={ids.has(s.shotId)} onChange={() => setIds((x) => { const n = new Set(x); if (n.has(s.shotId)) n.delete(s.shotId); else n.add(s.shotId); return n })} /> Shot {s.number}</span>
          <span className="faint">{(s.words ?? '').slice(0, 60)}</span>
        </label>
      ))}
      <label className="cb-check"><span>On</span>
        <select aria-label="Remake model" value={model?.model} onChange={(e) => setModel(models.find((m) => m.model === e.target.value) ?? models[0])}>
          {models.map((m) => <option key={`${m.provider}:${m.model}`} value={m.model}>{m.label}</option>)}
        </select>
      </label>
      <div style={{ display: 'flex', gap: 6 }}>
        <span className="pt-grow" />
        <button type="button" className="btn xs ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn xs primary" disabled={!ids.size || !model} onClick={() => onNext([...ids], { provider: model.provider as ModelChoice['provider'], model: model.model }, model.label)}>Next</button>
      </div>
    </div>
  )
}
