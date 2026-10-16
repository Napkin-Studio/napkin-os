// The Campaign board on the canvas (features/campaign-formats.clan, CF10): a format set's sizes as
// tiles at true proportion in channel lanes, drawn over its element (a transparent node box inside a
// board of purpose formats), positioned and scaled with the view like the node cards. The canvas below
// selects and moves the board; tiles take the pointer for their own actions.
//
// Per tile: status (making, ready, needs a look, out of date, locked, not made), the safe-area overlay
// (S), Jude's flags with Ignore, Adjust crop (drag to move, wheel to zoom; free, on device, then made
// again on the relay), Lock, Change method and Redo (a paid method goes through the tile's send tray,
// which names the method and the model, never a price), and Edit type.
// The board: Update sizes when the master changed, Export zip, Export at full size (Magnific upscales,
// through the same tray).

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { placeFloating } from '../lib/place'
import { keepsPick, onScreen, tilePick } from './pick'
import { useConfig, useDoc, useServices, useUi } from '../app/context'
import { modelChoicesFor } from '../capabilities'
import type { CanvasAdapter, CanvasElement } from '../canvas/core/canvasAdapter'
import type { FormatCheckCode, FormatSet, PersonRef, PxBox, Size, SizeMethod } from '../contracts/types'
import { updateDoc } from '../doc/store'
import { download } from '../export'
import { useBlobUrl } from '../ui/hooks'
import { useProjectName } from '../ui/useDownload'
import { boardLayout, CAPTION_H, type TileBox } from './board'
import { panCrop, zoomCrop } from './crop'
import { fullPlan } from './delivery'
import { exportSizes } from './exportZip'
import { formatById, shortName, sizeWords } from './formats'
import { adjustCrop, changeMethod, channelOfSize, redoSize, setLocked, sizesOf, staleSizes, updateSizes, upscaleForDelivery, type CampaignDeps } from './make'
import { METHOD_WORD, methodModels, methodWords, PAID, rowFracs, STILL_METHODS, type MethodModel } from './rules'
import { campaignSheet } from './sheet'
import { TypeEditor, TypeOverlay } from './TypeEditor'
import { FilmPic, FilmTools } from './FilmTile'
import { filmWords } from './film'
import './campaign.css'

const LOCAL_PERSON: PersonRef = 'human:p_local'

export function CampaignLayer({ canvas, tick }: { canvas: CanvasAdapter; tick: number }) {
  const doc = useDoc()
  void tick
  const view = canvas.view()
  const els = canvas.elements()
  const boards = els.filter((e) => !e.isDeleted && (e.customData as { kind?: string } | undefined)?.kind === 'format_set'
    && !!doc.format_sets?.[(e.customData as { id: string }).id])
  const selection = view.selectedIds.join(',')
  // One tile bar at a time, for the picked tile only (owner bug 2026-10-16): a canvas selection, a click
  // on empty canvas or anywhere outside the boards' own surfaces, and Esc close it, on every board.
  useEffect(() => { if (selection) tilePick.clear() }, [selection])
  useEffect(() => {
    const down = (e: PointerEvent) => { if (!keepsPick(e.target as Element | null)) tilePick.clear() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') tilePick.clear() }
    document.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key)
    }
  }, [])
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
  const pk = useSyncExternalStore(tilePick.subscribe, tilePick.get)
  const picked = pk?.setId === set.id ? pk.sizeId : null
  const [adjusting, setAdjusting] = useState<{ id: string; crop: PxBox } | null>(null)
  const [typing, setTyping] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const sizes = sizesOf(doc, set.id)
  const layout = boardLayout(sizes.map((s) => ({ id: s.id, channel: channelOfSize(s), aspect: { w: s.delivery.width, h: s.delivery.height } })))
  const stale = staleSizes(doc, els, set.id)
  const staleIds = new Set(stale.map((s) => s.id))
  const masterUrl = useBlobUrl(set.master.asset)
  const { config } = useConfig()
  const models = methodModels(config)
  const upscaler = modelChoicesFor('upscale', config)[0]
  const [tray, setTray] = useState<TrayOpen | null>(null)
  const [fullWanted, setFullWanted] = useState(false)

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
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, picked])
  // Adjust crop and Edit type belong to the picked tile: they end when it is no longer picked.
  const adjustingNow = adjusting && adjusting.id === picked ? adjusting : null
  const typingNow = typing && typing === picked ? typing : null

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
  const exportAll = async (full = false) => {
    try {
      const out = await exportSizes(doc, set.id, project || doc.project.title, undefined, full ? { model: upscaler?.label ?? 'Magnific' } : undefined)
      download(out.blob, out.name)
      say(`Exported ${out.files} ${out.files === 1 ? 'size' : 'sizes'}${full ? ' at full size' : ''}${out.missing ? ` · ${out.missing} not in this browser` : ''}`)
    } catch (e) {
      say(e instanceof Error ? e.message : 'The export did not work.')
    }
  }
  // Export at full size: the sizes Magnific upscales first (through the tray), then the zip.
  const plans = sizes.map((s) => ({ s, plan: fullPlan(s) }))
  const toUpscale = plans.filter((p) => p.plan?.kind === 'upscale')
  const upscaling = sizes.filter((s) => s.full?.job_id && !s.full.asset && s.full.from === s.asset && isLive(services.runner, doc, s.full.job_id))
  const exportFull = () => {
    if (!toUpscale.length) {
      void exportAll(true)
      return
    }
    if (!upscaler) {
      say('Upscaling is off for your agency: Export zip has the previews.')
      return
    }
    setTray({
      who: 'rhea', title: 'Export at full size',
      rows: toUpscale.map(({ s, plan }) => ({ id: s.id, name: tileName(s), words: `Upscale ×${plan!.kind === 'upscale' ? plan!.scale : 4} · ${upscaler.label}` })),
      note: `${plans.filter((p) => p.plan && p.plan.kind !== 'upscale').length} more go as they are. The type is drawn again at full size on our server.`,
      send: async () => {
        setFullWanted(true)
        for (const { s, plan } of toUpscale) if (plan?.kind === 'upscale') await upscaleForDelivery(deps, s.id, plan.scale)
        say(`Upscaling ${toUpscale.length} for delivery`)
      },
    })
  }
  const update = () => {
    const paid = stale.filter((s) => PAID.has(s.method))
    const go = () => void updateSizes(deps, set.id, by).then((n) => say(`Updating ${n} sizes`))
    if (!paid.length) return go()
    setTray({
      who: 'wren', title: 'Update sizes',
      rows: stale.map((s) => ({ id: s.id, name: tileName(s), words: methodWords(s.method, models) })),
      note: 'Locked sizes stay as they are.',
      send: async () => go(),
    })
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
            <button type="button" className="btn xs primary" onClick={update}>Update sizes</button>
          </span>
        )}
        <button type="button" className={`btn xs ${safe ? 'on' : 'ghost'}`} aria-pressed={safe} title="Safe areas (S)" onClick={() => campaignSheet.toggleSafeAreas()}>Safe areas <kbd>S</kbd></button>
        <button type="button" className="btn xs" onClick={() => void exportAll()}>Export zip</button>
        {upscaling.length > 0
          ? <span className="cb-stale" role="status">Upscaling {upscaling.length} for delivery…</span>
          : fullWanted && !toUpscale.length
            ? <button type="button" className="btn xs primary" onClick={() => { setFullWanted(false); void exportAll(true) }}>Full size ready · Download</button>
            : <button type="button" className="btn xs" onClick={exportFull} title="Each size at its delivery size: Magnific upscales what needs it">Export at full size</button>}
      </header>
      {layout.lanes.map((l) => (
        <div key={l.channel} className="cb-lane" style={{ top: l.y }}>{l.label}<span className="cb-lanecount">{l.count}</span></div>
      ))}
      {sizes.map((s) => {
        const box = layout.tiles[s.id]
        if (!box) return null
        return <Tile key={s.id} size={s} set={set} box={box} masterUrl={masterUrl} safe={safe} stale={staleIds.has(s.id)} zoom={zoom}
          picked={picked === s.id} flagsOpen={picked === s.id && !!pk?.flags} adjusting={adjustingNow?.id === s.id ? adjustingNow.crop : null} typing={typingNow === s.id}
          onPick={() => { tilePick.pick(set.id, s.id, picked === s.id && !!pk?.flags); canvas.select([]) }}
          onAdjust={(crop) => setAdjusting(crop ? { id: s.id, crop } : null)}
          onAdjustDone={(crop) => { setAdjusting(null); void adjustCrop(deps, s.id, crop, by) }}
          onLock={(on) => void setLocked(services.doc, s.id, on)}
          onType={(on) => setTyping(on ? s.id : null)}
          models={models}
          onTray={setTray}
          onIgnore={(code) => void updateDoc(services.doc, (x) => {
            const c = x.sizes[s.id]?.checks?.[code as FormatCheckCode]
            if (c) c.ignored = { by, at: new Date().toISOString() }
            const sz = x.sizes[s.id]
            if (sz && sz.status === 'look' && !Object.values(sz.checks ?? {}).some((k) => k && k.result === 'flag' && !k.ignored)) sz.status = 'ready'
          }, `ignore Jude's ${code} check on sizes[${s.id}]`)}
          deps={deps} by={by} say={say} />
      })}
      {note && <div className="cb-note" role="status">{note}</div>}
      {tray && <SendTray tray={tray} zoom={zoom} onClose={() => setTray(null)} />}
    </div>
  )
}

/** A job of this browser's runner, or of the document, still under way. */
function isLive(runner: CampaignDeps['runner'], doc: ReturnType<typeof useDoc>, jobId: string): boolean {
  const state = runner.liveInfo(jobId)?.state ?? doc.jobs[jobId]?.state
  return !!state && !['completed', 'failed', 'cancelled', 'uncertain'].includes(state)
}

function tileName(s: Size): string {
  const f = formatById(s.format.format_id)
  return `${f ? shortName(f.format) : s.format.format_id} · ${s.delivery.width}×${s.delivery.height}`
}

/** What a send tray lists: who makes it, each size with its method and model (never a price), Send. */
interface TrayOpen {
  who: 'wren' | 'rhea'
  title: string
  rows: { id: string; name: string; words: string }[]
  note?: string
  send(): Promise<void>
}

function SendTray({ tray, zoom, onClose }: { tray: TrayOpen; zoom: number; onClose(): void }) {
  const [busy, setBusy] = useState(false)
  return (
    <div className="cb-tray pt-panel" role="dialog" aria-label={tray.title} style={{ transform: `scale(${1 / zoom})` }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="cb-trayhead"><b>{tray.title}</b><span className="faint">{tray.who === 'rhea' ? 'Rhea' : 'Wren'} will make</span></div>
      <div className="cb-trayrows" role="list">
        {tray.rows.map((r) => (
          <div key={r.id} className="cb-trayrow" role="listitem"><span className="cb-trayname">{r.name}</span><span className="cf-dots" /><span className="cb-traywords">{r.words}</span></div>
        ))}
      </div>
      {tray.note && <p className="cb-hint">{tray.note}</p>}
      <div className="cb-row">
        <span className="pt-grow" />
        <button type="button" className="btn xs ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn xs primary" disabled={busy} onClick={() => { setBusy(true); void tray.send().finally(onClose) }}>
          {busy ? 'Sending…' : `Send ${tray.rows.length === 1 ? '' : tray.rows.length}`.trim()}
        </button>
      </div>
    </div>
  )
}

const STATUS: Record<NonNullable<Size['status']>, string> = { making: 'Making…', ready: 'Ready', look: 'Needs a look', stale: 'Out of date' }

function Tile({ size, set, box, masterUrl, safe, stale, zoom, picked, flagsOpen, adjusting, typing, onPick, onAdjust, onAdjustDone, onLock, onType, onIgnore, deps, by, say, models, onTray }: {
  size: Size
  set: FormatSet
  box: TileBox
  masterUrl?: string
  safe: boolean
  stale: boolean
  zoom: number
  picked: boolean
  flagsOpen: boolean
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
  models: Partial<Record<SizeMethod, MethodModel>>
  onTray(t: TrayOpen): void
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
  const crop = adjusting ?? size.crop
  const flags = Object.entries(size.checks ?? {}).filter(([, c]) => c && c.result === 'flag')
  const [drag, setDrag] = useState<{ x: number; y: number; crop: PxBox } | null>(null)
  const pic = useRef<HTMLDivElement>(null)
  const [methodOpen, setMethodOpen] = useState(false)

  const s = crop ? box.w / crop.w : 1
  // The master shows through while a crop is adjusted or made; a paid method's tile waits on its own picture.
  const showMaster = !!crop && !!masterUrl && size.method === 'crop' && (adjusting || !url || status === 'making')
  const methodLine = size.media === 'video' ? filmWords(set, size) : methodWords(size.method, models)
  const failure = failed ? job?.error?.message : undefined
  const name = `${f ? shortName(f.format) : size.format.format_id} · ${size.delivery.width}×${size.delivery.height}`
  const paidTray = (method: SizeMethod, title: string, send: () => Promise<unknown>) => onTray({
    who: 'wren', title, rows: [{ id: size.id, name, words: methodWords(method, models) }],
    note: method === 'extend' ? 'Keeps the picture exactly and makes its new edges.' : 'Remakes the picture at this shape from the master.',
    send: async () => { await send() },
  })
  const pickMethod = (m: SizeMethod) => {
    setMethodOpen(false)
    if (PAID.has(m)) paidTray(m, 'Change method', () => changeMethod(deps, size.id, m, by))
    else void changeMethod(deps, size.id, m, by).then(() => say(`${METHOD_WORD[m]} · making it again`))
  }

  return (
    <div className={`cb-tile ${picked ? 'picked' : ''} ${size.locked ? 'locked' : ''} ${status ?? 'notmade'} ${adjusting ? 'adjusting' : ''}`}
      style={{ left: box.x, top: box.y, width: box.w }} data-format={size.format.format_id} data-size={size.id}
      onPointerDown={(e) => { e.stopPropagation(); if (!adjusting) onPick() }}>
      <div ref={pic} className="cb-pic" style={{ height: box.h }}
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
          : size.media === 'video' && size.asset ? <FilmPic sha={size.asset} picked={picked} label={`${f ? shortName(f.format) : size.format.format_id} · ${size.length_s ?? ''} s`} />
            : url ? <img className="cb-made" src={url} alt={`${f ? shortName(f.format) : size.format.format_id}`} draggable={false} />
              : <div className="cb-empty">{size.media === 'video' ? (status === 'making' ? 'Cutting…' : 'Film') : 'Not made yet'}</div>}
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
        <span className={`cb-status ${status ?? 'notmade'}`} title={failure}>{status === 'failed' ? 'Failed' : status ? STATUS[status] : 'Not made'}</span>
        {size.locked && <span className="cb-lock" title="Locked: Update sizes never changes it">🔒</span>}
        {flags.length > 0 && (
          <button type="button" className={`cb-flag ${flags.every(([, c]) => c!.ignored) ? 'ignored' : ''}`} onPointerDown={(e) => e.stopPropagation()}
            onClick={() => tilePick.toggleFlags(set.id, size.id)} aria-expanded={flagsOpen}>⚑ Jude · {flags.length}</button>
        )}
      </div>
      <div className="cb-caption" style={{ height: CAPTION_H }}>
        <span className="cb-name">{f ? shortName(f.format) : size.format.format_id}{size.length_s ? ` · ${size.length_s} s` : ''}</span>
        <span className="cb-meta">{f ? sizeWords(f.format) : `${size.delivery.width}×${size.delivery.height}`} · {methodLine}</span>
      </div>
      {picked && !typing && <TileFloat anchor={pic}>
      {flagsOpen && flags.length > 0 && (
        <div className="cb-flags pt-panel" role="dialog" aria-label="Jude's checks">
          {flags.map(([code, c]) => (
            <div key={code} className="cb-check">
              <span>{c!.note}</span>
              {c!.ignored ? <span className="faint">Ignored</span> : <button type="button" className="btn xs ghost" onClick={() => onIgnore(code as FormatCheckCode)}>Ignore</button>}
            </div>
          ))}
        </div>
      )}
      {!adjusting && size.media === 'video' && (
        <FilmTools size={size} set={set} deps={deps} by={by} say={say} onTray={onTray} onLock={onLock} />
      )}
      {!adjusting && size.media !== 'video' && (
        <div className="cb-tools toolbar" role="toolbar" aria-label="Size actions">
          <button type="button" className="btn sm" disabled={size.media !== 'image' || !size.crop || size.method !== 'crop'} title={size.media !== 'image' ? 'Films are reframed in phase 6' : undefined}
            onClick={() => onAdjust(size.crop!)}>Adjust crop</button>
          <button type="button" className="btn sm" disabled={size.media !== 'image'} onClick={() => onType(true)}>Edit type</button>
          <span className="cb-menuwrap">
            <button type="button" className="btn sm" aria-haspopup="menu" aria-expanded={methodOpen} onClick={() => setMethodOpen(!methodOpen)}>Change method</button>
            {methodOpen && (
              <div className="cb-menu pt-panel" role="menu">
                {STILL_METHODS.map((m) => {
                  const off = size.media !== 'image' || (PAID.has(m) && !models[m])
                  return (
                    <button key={m} type="button" role="menuitemradio" aria-checked={size.method === m} className="pt-menurow" disabled={off || size.method === m}
                      title={PAID.has(m) && !models[m] ? 'Off for your agency' : undefined}
                      onClick={() => pickMethod(m)}>
                      {METHOD_WORD[m]}<span className="hint">{PAID.has(m) ? models[m]?.label ?? 'off' : 'free'}</span>{size.method === m && ' ✓'}
                    </button>
                  )
                })}
              </div>
            )}
          </span>
          <button type="button" className="btn sm" disabled={!PAID.has(size.method) || !models[size.method] || status === 'making' || !!size.locked}
            title={!PAID.has(size.method) ? 'A crop is the same each time: Redo is another take of Extend or Regenerate.' : size.locked ? 'Unlock it first' : undefined}
            onClick={() => paidTray(size.method, 'Redo', () => redoSize(deps, size.id, by))}>Redo</button>
          <button type="button" className="btn sm" disabled title="Fix in image editor comes with a later build">Fix in image editor</button>
          <button type="button" className="btn sm" onClick={() => onLock(!size.locked)}>{size.locked ? 'Unlock' : 'Lock'}</button>
        </div>
      )}
      {adjusting && (
        <div className="cb-tools toolbar" role="toolbar" aria-label="Adjust crop">
          <span className="cb-hint">Drag to move · scroll to zoom</span>
          <button type="button" className="btn sm ghost" onClick={() => onAdjust(zoomCrop(adjusting, 1 / 1.15, master))} aria-label="Closer">+</button>
          <button type="button" className="btn sm ghost" onClick={() => onAdjust(zoomCrop(adjusting, 1.15, master))} aria-label="Wider">−</button>
          <button type="button" className="btn sm ghost" onClick={() => onAdjustDone(null)}>Reset</button>
          <button type="button" className="btn sm ghost" onClick={() => onAdjust(null)}>Cancel</button>
          <button type="button" className="btn sm primary" onClick={() => { onAdjustDone(adjusting); say('Crop saved · making it again') }}>Done</button>
        </div>
      )}
      </TileFloat>}
      {typing && <TypeEditor size={size} set={set} deps={deps} by={by} zoom={zoom} onClose={() => onType(false)} />}
    </div>
  )
}

/**
 * The picked tile's bar (and Jude's flag list above it), on the page rather than on the canvas: a fixed
 * size whatever the zoom, placed as the canvas's floating toolbars are (lib/place.ts placeFloating:
 * centred above the tile, below it only when there is no room above), so it never covers the next
 * row. The tile panned or zoomed off screen closes it.
 */
function TileFloat({ anchor, children }: { anchor: RefObject<HTMLDivElement | null>; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const a = anchor.current?.getBoundingClientRect()
    const el = panel.current
    if (!a || !el) return
    const view = { w: window.innerWidth, h: window.innerHeight }
    if (!onScreen(a, view)) {
      tilePick.clear()
      return
    }
    const p = placeFloating({ x: (a.left + a.right) / 2, top: a.top, bottom: a.bottom }, { w: el.offsetWidth, h: el.offsetHeight }, view, 10)
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
