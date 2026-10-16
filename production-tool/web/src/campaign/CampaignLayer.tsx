// The Campaign board on the canvas (features/campaign-formats.clan, CF10): a format set's sizes as
// tiles at true proportion in channel lanes, drawn over its element (a transparent node box inside a
// board of purpose formats), positioned and scaled with the view like the node cards. The canvas below
// selects and moves the board; tiles take the pointer for their own actions.
//
// Per tile: status (making, ready, needs a look, out of date, locked, not made), the safe-area overlay
// (S), Jude's flags with Ignore, Adjust crop (drag to move, wheel to zoom; free, on device, then made
// again on the relay), Lock, Change method (crop now; the paid methods wait for phase 4) and Edit type.
// The board: Update sizes when the master changed, Export zip.

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useDoc, useServices, useUi } from '../app/context'
import type { CanvasAdapter, CanvasElement } from '../canvas/core/canvasAdapter'
import type { FormatCheckCode, FormatSet, PersonRef, PxBox, Size } from '../contracts/types'
import { updateDoc } from '../doc/store'
import { download } from '../export'
import { useBlobUrl } from '../ui/hooks'
import { useProjectName } from '../ui/useDownload'
import { boardLayout, CAPTION_H, type TileBox } from './board'
import { panCrop, zoomCrop } from './crop'
import { exportSizes } from './exportZip'
import { formatById, shortName, sizeWords } from './formats'
import { adjustCrop, channelOfSize, setLocked, sizesOf, staleSizes, updateSizes, type CampaignDeps } from './make'
import { METHOD_WORD, rowFracs, methodFor } from './rules'
import { campaignSheet } from './sheet'
import { TypeEditor, TypeOverlay } from './TypeEditor'
import './campaign.css'

const LOCAL_PERSON: PersonRef = 'human:p_local'

export function CampaignLayer({ canvas, tick }: { canvas: CanvasAdapter; tick: number }) {
  const doc = useDoc()
  void tick
  const view = canvas.view()
  const els = canvas.elements()
  const boards = els.filter((e) => !e.isDeleted && (e.customData as { kind?: string } | undefined)?.kind === 'format_set'
    && !!doc.format_sets?.[(e.customData as { id: string }).id])
  if (!boards.length) return null
  const moving = canvas.dragOffset?.() ?? null
  return (
    <div className="campaign-layer">
      {boards.map((el) => {
        const off = moving?.ids.has(el.id) ? moving : null
        const left = (el.x + (off?.dx ?? 0) + view.scrollX) * view.zoom
        const top = (el.y + (off?.dy ?? 0) + view.scrollY) * view.zoom
        return <CampaignBoard key={el.id} el={el} set={doc.format_sets[(el.customData as { id: string }).id]} canvas={canvas}
          zoom={view.zoom} style={{ left, top, width: el.width, transform: `scale(${view.zoom})` }} selected={view.selectedIds.includes(el.id)} els={els} />
      })}
    </div>
  )
}

function CampaignBoard({ el, set, canvas, style, selected, els, zoom }: { el: CanvasElement; set: FormatSet; canvas: CanvasAdapter; style: React.CSSProperties; selected: boolean; els: CanvasElement[]; zoom: number }) {
  const doc = useDoc()
  const ui = useUi()
  const services = useServices()
  const project = useProjectName()
  const by: PersonRef = ui.me ? `human:${ui.me.participantId}` : LOCAL_PERSON
  const deps: CampaignDeps = { canvas, doc: services.doc, runner: services.runner, relay: services.relay }
  const safe = useSyncExternalStore(campaignSheet.subscribe, campaignSheet.safeAreas)
  const [picked, setPicked] = useState<string | null>(null)
  const [adjusting, setAdjusting] = useState<{ id: string; crop: PxBox } | null>(null)
  const [typing, setTyping] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const sizes = sizesOf(doc, set.id)
  const layout = boardLayout(sizes.map((s) => ({ id: s.id, channel: channelOfSize(s), aspect: { w: s.delivery.width, h: s.delivery.height } })))
  const stale = staleSizes(doc, els, set.id)
  const staleIds = new Set(stale.map((s) => s.id))
  const masterUrl = useBlobUrl(set.master.asset)

  // The board grows with its sizes (a new length, a new format): its element and frame follow the layout.
  useEffect(() => {
    if (Math.abs(layout.w - el.width) < 1 && Math.abs(layout.h - el.height) < 1) return
    const frame = el.frameId ? canvas.elements().find((e) => e.id === el.frameId) : undefined
    canvas.transact((all) => all.map((e) => {
      if (e.id === el.id) return canvas.patch(e, { width: layout.w, height: layout.h })
      if (frame && e.id === frame.id) return canvas.patch(e, { width: Math.max(e.width, layout.w + (el.x - e.x) * 2), height: Math.max(e.height, layout.h + (el.y - e.y) + (el.x - e.x)) })
      return e
    }), { undoable: false })
  }, [layout.w, layout.h, el, canvas])

  // S shows or hides the safe areas while this board or one of its tiles is selected.
  useEffect(() => {
    if (!selected && !picked) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest?.('input, textarea, select, [contenteditable="true"]')) return
      if ((e.key === 's' || e.key === 'S') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        campaignSheet.toggleSafeAreas()
      }
      if (e.key === 'Escape') {
        setPicked(null)
        setAdjusting(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, picked])

  const say = useCallback((t: string) => {
    setNote(t)
    setTimeout(() => setNote(null), 4000)
  }, [])

  const counts = {
    ready: sizes.filter((s) => s.status === 'ready').length,
    look: sizes.filter((s) => s.status === 'look').length,
    making: sizes.filter((s) => s.status === 'making').length,
    notMade: sizes.filter((s) => !s.status).length,
  }
  const exportAll = async () => {
    try {
      const out = await exportSizes(doc, set.id, project || doc.project.title)
      download(out.blob, out.name)
      say(`Exported ${out.files} ${out.files === 1 ? 'size' : 'sizes'}${out.missing ? ` · ${out.missing} not in this browser` : ''}`)
    } catch (e) {
      say(e instanceof Error ? e.message : 'The export did not work.')
    }
  }
  const title = doc.boards ? Object.values(doc.boards).find((b) => b.id === (els.find((e) => e.id === el.frameId)?.customData as { id?: string } | undefined)?.id)?.title : undefined

  return (
    <div className={`cb-board ${selected ? 'selected' : ''}`} style={{ ...style, height: layout.h }} data-set={set.id}>
      <header className="cb-head">
        <b className="cb-title">{(title ?? 'Campaign').replace(/^Campaign · /, '')}</b>
        <span className="cb-count">{sizes.length} formats · {counts.ready} ready{counts.look ? ` · ${counts.look} need a look` : ''}{counts.making ? ` · ${counts.making} making` : ''}{counts.notMade ? ` · ${counts.notMade} not made yet` : ''}</span>
        <span className="pt-grow" />
        {stale.length > 0 && (
          <span className="cb-stale" role="status">Master changed · {stale.length} out of date
            <button type="button" className="btn xs primary" onClick={() => void updateSizes(deps, set.id, by).then((n) => say(`Updating ${n} sizes`))}>Update sizes</button>
          </span>
        )}
        <button type="button" className={`btn xs ${safe ? 'on' : 'ghost'}`} aria-pressed={safe} title="Safe areas (S)" onClick={() => campaignSheet.toggleSafeAreas()}>Safe areas <kbd>S</kbd></button>
        <button type="button" className="btn xs" onClick={() => void exportAll()}>Export zip</button>
      </header>
      {layout.lanes.map((l) => (
        <div key={l.channel} className="cb-lane" style={{ top: l.y }}>{l.label}<span className="cb-lanecount">{l.count}</span></div>
      ))}
      {sizes.map((s) => {
        const box = layout.tiles[s.id]
        if (!box) return null
        return <Tile key={s.id} size={s} set={set} box={box} masterUrl={masterUrl} safe={safe} stale={staleIds.has(s.id)} zoom={zoom}
          picked={picked === s.id} adjusting={adjusting?.id === s.id ? adjusting.crop : null} typing={typing === s.id}
          onPick={() => { setPicked(s.id); canvas.select([]) }}
          onAdjust={(crop) => setAdjusting(crop ? { id: s.id, crop } : null)}
          onAdjustDone={(crop) => { setAdjusting(null); void adjustCrop(deps, s.id, crop, by) }}
          onLock={(on) => void setLocked(services.doc, s.id, on)}
          onType={(on) => setTyping(on ? s.id : null)}
          onIgnore={(code) => void updateDoc(services.doc, (x) => {
            const c = x.sizes[s.id]?.checks?.[code as FormatCheckCode]
            if (c) c.ignored = { by, at: new Date().toISOString() }
            const sz = x.sizes[s.id]
            if (sz && sz.status === 'look' && !Object.values(sz.checks ?? {}).some((k) => k && k.result === 'flag' && !k.ignored)) sz.status = 'ready'
          }, `ignore Jude's ${code} check on sizes[${s.id}]`)}
          deps={deps} by={by} say={say} />
      })}
      {note && <div className="cb-note" role="status">{note}</div>}
    </div>
  )
}

const STATUS: Record<NonNullable<Size['status']>, string> = { making: 'Making…', ready: 'Ready', look: 'Needs a look', stale: 'Out of date' }

function Tile({ size, set, box, masterUrl, safe, stale, zoom, picked, adjusting, typing, onPick, onAdjust, onAdjustDone, onLock, onType, onIgnore, deps, by, say }: {
  size: Size
  set: FormatSet
  box: TileBox
  masterUrl?: string
  safe: boolean
  stale: boolean
  zoom: number
  picked: boolean
  adjusting: PxBox | null
  typing: boolean
  onPick(): void
  onAdjust(crop: PxBox | null): void
  onAdjustDone(crop: PxBox | null): void
  onLock(on: boolean): void
  onType(on: boolean): void
  onIgnore(code: FormatCheckCode): void
  deps: CampaignDeps
  by: PersonRef
  say(t: string): void
}) {
  const doc = useDoc()
  const { runner } = useServices()
  const url = useBlobUrl(size.asset)
  const f = formatById(size.format.format_id)
  const fr = f ? rowFracs({ format: f.format }) : [0, 0, 0, 0] as const
  const master = { w: set.master.w ?? 1, h: set.master.h ?? 1 }
  const job = size.job_id ? doc.jobs[size.job_id] : undefined
  const live = size.job_id ? runner.liveInfo(size.job_id)?.state ?? job?.state : undefined
  const failed = live === 'failed'
  const status = failed ? 'failed' : (size.status === 'ready' || size.status === 'look') && stale ? 'stale' : size.status
  const ideal = f ? methodFor({ key: f.format.id, pack: f.pack, format: f.format, channel: channelOfSize(size), media: size.media, ...(size.length_s ? { length_s: size.length_s } : {}) },
    { ...master, media: set.master.kind === 'video' ? 'video' : 'image' }, set.protect?.boxes) : null
  const crop = adjusting ?? size.crop
  const flags = Object.entries(size.checks ?? {}).filter(([, c]) => c && c.result === 'flag')
  const [drag, setDrag] = useState<{ x: number; y: number; crop: PxBox } | null>(null)
  const [flagsOpen, setFlagsOpen] = useState(false)
  const [methodOpen, setMethodOpen] = useState(false)

  const s = crop ? box.w / crop.w : 1
  const showMaster = !!crop && !!masterUrl && (adjusting || !url || status === 'making')
  const methodLine = size.media === 'video'
    ? `${METHOD_WORD[size.method]} · needs ${size.method === 'reframe' ? 'phase 6' : 'phase 5'}`
    : ideal && ideal.method !== size.method ? `${METHOD_WORD[size.method]} · ${METHOD_WORD[ideal.method]} needs phase 4` : METHOD_WORD[size.method]

  return (
    <div className={`cb-tile ${picked ? 'picked' : ''} ${size.locked ? 'locked' : ''} ${status ?? 'notmade'} ${adjusting ? 'adjusting' : ''}`}
      style={{ left: box.x, top: box.y, width: box.w }} data-format={size.format.format_id} data-size={size.id}
      onPointerDown={(e) => { e.stopPropagation(); if (!adjusting) onPick() }}>
      <div className="cb-pic" style={{ height: box.h }}
        onPointerDown={(e) => {
          if (!adjusting) return
          e.stopPropagation()
          e.currentTarget.setPointerCapture(e.pointerId)
          setDrag({ x: e.clientX, y: e.clientY, crop: adjusting })
        }}
        onPointerMove={(e) => {
          if (!drag || !adjusting) return
          // The picture moves with the pointer, so the crop moves the other way (in master pixels).
          const zoom = e.currentTarget.getBoundingClientRect().width / box.w
          onAdjust(panCrop(drag.crop, -(e.clientX - drag.x) / zoom / s, -(e.clientY - drag.y) / zoom / s, master))
        }}
        onPointerUp={() => setDrag(null)}
        onWheel={(e) => { if (adjusting) { e.stopPropagation(); onAdjust(zoomCrop(adjusting, e.deltaY > 0 ? 1.06 : 1 / 1.06, master)) } }}>
        {showMaster && crop
          ? <img className="cb-master" src={masterUrl} alt="" draggable={false} style={{ width: master.w * s, height: master.h * s, left: -crop.x * s, top: -crop.y * s }} />
          : url ? <img className="cb-made" src={url} alt={`${f ? shortName(f.format) : size.format.format_id}`} draggable={false} />
            : <div className="cb-empty">{size.media === 'video' ? 'Film' : 'Not made yet'}</div>}
        {(typing || showMaster) && crop && <TypeOverlay size={size} set={set} box={box} />}
        {safe && (fr[0] || fr[1] || fr[2] || fr[3]) ? (
          <div className="cb-safe" aria-hidden="true">
            <span style={{ left: 0, top: 0, right: 0, height: `${fr[1] * 100}%` }} />
            <span style={{ left: 0, bottom: 0, right: 0, height: `${fr[3] * 100}%` }} />
            <span style={{ left: 0, top: `${fr[1] * 100}%`, bottom: `${fr[3] * 100}%`, width: `${fr[0] * 100}%` }} />
            <span style={{ right: 0, top: `${fr[1] * 100}%`, bottom: `${fr[3] * 100}%`, width: `${fr[2] * 100}%` }} />
          </div>
        ) : null}
        {safe && adjusting && set.protect?.boxes?.map((b, i) => (
          <span key={i} className="cb-pbox" style={{ left: (b.x - adjusting.x) * s, top: (b.y - adjusting.y) * s, width: b.w * s, height: b.h * s }} />
        ))}
        <span className={`cb-status ${status ?? 'notmade'}`}>{status === 'failed' ? 'Failed' : status ? STATUS[status] : 'Not made'}</span>
        {size.locked && <span className="cb-lock" title="Locked: Update sizes never changes it">🔒</span>}
        {flags.length > 0 && (
          <button type="button" className={`cb-flag ${flags.every(([, c]) => c!.ignored) ? 'ignored' : ''}`} onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setFlagsOpen(!flagsOpen)} aria-expanded={flagsOpen}>⚑ Jude · {flags.length}</button>
        )}
      </div>
      <div className="cb-caption" style={{ height: CAPTION_H }}>
        <span className="cb-name">{f ? shortName(f.format) : size.format.format_id}{size.length_s ? ` · ${size.length_s} s` : ''}</span>
        <span className="cb-meta">{f ? sizeWords(f.format) : `${size.delivery.width}×${size.delivery.height}`} · {methodLine}</span>
      </div>
      {flagsOpen && (
        <div className="cb-pop pt-panel" style={{ transform: `scale(${1 / zoom})` }} role="dialog" aria-label="Jude's checks" onPointerDown={(e) => e.stopPropagation()}>
          {flags.map(([code, c]) => (
            <div key={code} className="cb-check">
              <span>{c!.note}</span>
              {c!.ignored ? <span className="faint">Ignored</span> : <button type="button" className="btn xs ghost" onClick={() => onIgnore(code as FormatCheckCode)}>Ignore</button>}
            </div>
          ))}
        </div>
      )}
      {picked && !adjusting && !typing && (
        <div className="cb-tools toolbar" style={{ transform: `scale(${1 / zoom})` }} role="toolbar" aria-label="Size actions" onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" className="btn sm" disabled={size.media !== 'image' || !size.crop || size.method !== 'crop'} title={size.media !== 'image' ? 'Films are reframed in phase 6' : undefined}
            onClick={() => onAdjust(size.crop!)}>Adjust crop</button>
          <button type="button" className="btn sm" disabled={size.media !== 'image'} onClick={() => onType(true)}>Edit type</button>
          <span className="cb-menuwrap">
            <button type="button" className="btn sm" aria-haspopup="menu" aria-expanded={methodOpen} onClick={() => setMethodOpen(!methodOpen)}>Change method</button>
            {methodOpen && (
              <div className="cb-menu pt-panel" role="menu">
                {(['crop', 'extend', 'regenerate', 'layout'] as const).map((m) => (
                  <button key={m} type="button" role="menuitemradio" aria-checked={size.method === m} className="pt-menurow" disabled={m !== 'crop' || size.media !== 'image'}
                    title={m !== 'crop' ? `${METHOD_WORD[m]} needs phase 4` : undefined}
                    onClick={() => setMethodOpen(false)}>
                    {METHOD_WORD[m]}{m !== 'crop' && <span className="hint">phase 4</span>}{size.method === m && ' ✓'}
                  </button>
                ))}
              </div>
            )}
          </span>
          <button type="button" className="btn sm" disabled title="Redo is another take of a paid method (phase 4); a crop is the same each time.">Redo</button>
          <button type="button" className="btn sm" disabled title="Fix in image editor comes with a later build">Fix in image editor</button>
          <button type="button" className="btn sm" onClick={() => onLock(!size.locked)}>{size.locked ? 'Unlock' : 'Lock'}</button>
        </div>
      )}
      {adjusting && (
        <div className="cb-tools toolbar" style={{ transform: `scale(${1 / zoom})` }} role="toolbar" aria-label="Adjust crop" onPointerDown={(e) => e.stopPropagation()}>
          <span className="cb-hint">Drag to move · scroll to zoom</span>
          <button type="button" className="btn sm ghost" onClick={() => onAdjust(zoomCrop(adjusting, 1 / 1.15, master))} aria-label="Closer">+</button>
          <button type="button" className="btn sm ghost" onClick={() => onAdjust(zoomCrop(adjusting, 1.15, master))} aria-label="Wider">−</button>
          <button type="button" className="btn sm ghost" onClick={() => onAdjustDone(null)}>Reset</button>
          <button type="button" className="btn sm ghost" onClick={() => onAdjust(null)}>Cancel</button>
          <button type="button" className="btn sm primary" onClick={() => { onAdjustDone(adjusting); say('Crop saved · making it again') }}>Done</button>
        </div>
      )}
      {typing && <TypeEditor size={size} set={set} deps={deps} by={by} zoom={zoom} onClose={() => onType(false)} />}
    </div>
  )
}
