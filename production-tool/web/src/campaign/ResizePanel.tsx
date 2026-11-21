// Resize… (features/resize-selection.clan): the panel over the picture bar. Shapes as chips (none ticked when it
// opens: UAT round 1 IMG-17), How (Redraw by default, Extend, Crop, Auto; the last How remembered in this browser)
// with one plain line, a preview of every selected picture with the shapes over it as dashed frames, and a footer
// that says exactly how many pictures it makes. A crop keeps what must stay (Make all sizes' subject and product
// boxes, marked here with the same editor) and its frame can be dragged to move it (IMG-4). Its button opens the
// send tray (each picture × shape with its method and model, never a price); Send places every result and starts
// one job each.

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useConfig, useDoc } from '../app/context'
import type { ProtectBox, PxBox } from '../contracts/types'
import { useBlobUrl, useFloating } from '../ui/hooks'
import type { Anchor } from '../lib/place'
import { AgentFigure } from '../ui/agents/AgentFigure'
import { methodModels } from './rules'
import {
  cropKeeps, frameOver, HOW_LINE, HOW_WORD, howOff, HOWS, knownProtect, rememberedProtect, rememberProtect, loadPick, makeWords, methodLine, methodOf, mixedLine, parseCustom, planResize, tooFarToExtend, tooFarWords,
  previewLayout, savePick, SHAPES, SKETCH_LINE, trayRows, type How, type Shape, type Source,
} from './resizeSelection'
import { panCrop } from './crop'
import { ProtectEditor } from './ProtectEditor'
import './campaign.css'

const KIND_WORD = { picture: 'Picture', drawing: 'Drawing', sketch: 'Sketch' } as const

export function ResizePanel({ anchor, total, load, send, onClose }: {
  anchor: Anchor
  /** How many things are selected in all ("3 of 5 selected are pictures"). */
  total: number
  /** The selected pictures, ready (a scamp's picture exported). */
  load(): Promise<Source[]>
  /** Place the results and start their jobs. */
  send(planned: ReturnType<typeof planResize>): Promise<void>
  onClose(): void
}) {
  const { ref, style } = useFloating<HTMLDivElement>(anchor)
  const { config } = useConfig()
  const doc = useDoc()
  const models = useMemo(() => methodModels(config), [config])
  const first = useMemo(() => loadPick(), [])
  const [shapes, setShapes] = useState<Shape[]>([])
  const [how, setHow] = useState<How>(howOff(first.how, models) ? 'auto' : first.how)
  const [custom, setCustom] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<Source[] | null>(null)
  /** What must stay, per picture (its elId), in its pixels: marked here, else from a Make all sizes set of it. */
  const [kept, setKept] = useState<Record<string, ProtectBox[]>>({})
  /** Crops the person moved, per picture and shape (`elId:shapeId`), in the picture's pixels. */
  const [moved, setMoved] = useState<Record<string, PxBox>>({})
  /** The picture whose "What must stay" is open. */
  const [marking, setMarking] = useState<string | null>(null)
  const [step, setStep] = useState<'pick' | 'tray'>('pick')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Read once, when the panel opens (a scamp's picture is exported then).
  const [loading] = useState(() => load())
  useEffect(() => {
    let alive = true
    loading.then((s) => { if (alive) setLoaded(s) }).catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Those pictures could not be read.') })
    return () => { alive = false }
  }, [loading])
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const toggle = (s: Shape) => setShapes(shapes.some((x) => x.id === s.id) ? shapes.filter((x) => x.id !== s.id) : [...shapes, s])
  const pickHow = (h: How) => {
    setHow(h)
    savePick({ how: h })
  }
  // Each picture with what must stay: marked here, else a Make all sizes set's boxes for it.
  const sources = useMemo(() => loaded?.map((src) => {
    const protect = kept[src.elId] ?? rememberedProtect(src.asset, src) ?? knownProtect(doc, src)
    return protect?.length ? { ...src, protect } : src
  }) ?? null, [loaded, kept, doc])
  const customs = shapes.filter((s) => !SHAPES.some((x) => x.id === s.id))
  const parsed = custom !== null ? parseCustom(custom) : null
  const addCustom = () => {
    if (!parsed) return
    if (!shapes.some((x) => x.id === parsed.id)) toggle(parsed)
    setCustom(null)
  }

  const planned = sources ? planResize(sources, shapes, how, models).map((p) => {
    const m = moved[`${p.source.elId}:${p.shape.id}`]
    return p.method === 'crop' && m ? { ...p, crop: m } : p
  }) : []
  const crops = planned.some((p) => p.method === 'crop')
  const markingSrc = marking ? sources?.find((x) => x.elId === marking) : undefined
  const n = planned.length
  const scamp = !!sources?.some((s) => s.kind !== 'picture')
  const mixed = sources ? mixedLine(sources.length, total) : undefined
  const pictures = sources?.length ?? 0
  // Extend picked, and a shape it cannot reach in three steps (UAT round 4 S1-1): redrawn instead, said plainly.
  const tooFar = tooFarWords(tooFarToExtend(how, sources ?? [], shapes), models)

  const go = async () => {
    setBusy(true)
    setError(null)
    try {
      await send(planned)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work. Try again.')
      setBusy(false)
    }
  }

  return (
    <div ref={ref} className="popover rs-panel" style={style} role="dialog" aria-label="Resize" onPointerDown={(e) => e.stopPropagation()}>
      <header className="rs-head">
        <b>Resize {pictures ? `${pictures} ${pictures === 1 ? 'picture' : 'pictures'}` : '…'}</b>
        <span className="pt-grow" />
        <button type="button" className="btn xs ghost" onClick={onClose}>Cancel</button>
      </header>
      {mixed && <p className="rs-mixed" role="note">{mixed}. Only they are resized.</p>}

      {step === 'pick' && (
        <>
          <div className="cf-label">Shapes</div>
          <div className="cf-chips rs-chips" role="group" aria-label="Shapes">
            {[...SHAPES, ...customs].map((s) => {
              const on = shapes.some((x) => x.id === s.id)
              return (
                <button key={s.id} type="button" aria-pressed={on} className={`cf-chip rs-chip ${on ? 'on' : ''}`} onClick={() => toggle(s)}>
                  <ShapeIcon s={s} /> {s.id}{s.name ? <span className="rs-name"> {s.name}</span> : null}
                </button>
              )
            })}
            {custom === null
              ? <button type="button" className="cf-chip rs-chip rs-add" onClick={() => setCustom('')}>+ Custom</button>
              : (
                <span className="rs-custom">
                  <input autoFocus className="cf-len rs-input" value={custom} placeholder="1200×628 or 4:1" aria-label="Custom size or ratio"
                    onChange={(e) => setCustom(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addCustom(); if (e.key === 'Escape') { e.stopPropagation(); setCustom(null) } }} />
                  <button type="button" className="btn xs" disabled={!parsed} onClick={addCustom}>Add</button>
                </span>
              )}
          </div>
          {custom !== null && custom.trim() && !parsed && <p className="rs-line faint">Write a size in pixels (1200×628) or a ratio (4:1), at most 8 to 1.</p>}

          <div className="cf-label">How</div>
          <div className="rs-seg" role="radiogroup" aria-label="How">
            {HOWS.map((h) => {
              const off = howOff(h, models)
              return (
                <button key={h} type="button" role="radio" aria-checked={how === h} disabled={!!off} title={off}
                  className={`rs-segbtn ${how === h ? 'on' : ''}`} onClick={() => pickHow(h)}>{HOW_WORD[h]}</button>
              )
            })}
          </div>
          <p className="rs-line">{HOW_LINE[how]}{scamp && (how === 'regenerate' || how === 'auto') ? ` ${SKETCH_LINE}` : ''}</p>

          <div className="rs-previews" aria-label="Preview">
            {!sources && !error && <span className="rs-line faint">Getting the pictures ready…</span>}
            {sources?.map((s) => (
              <div key={s.elId} className="rs-prevcol">
                <Preview s={s} shapes={shapes} how={how} models={models} moved={moved}
                  onMove={(shapeId, box) => setMoved((m) => ({ ...m, [`${s.elId}:${shapeId}`]: box }))} />
                {crops && s.kind === 'picture' && (
                  <button type="button" className="btn xs ghost rs-keep" aria-pressed={marking === s.elId} onClick={() => setMarking(marking === s.elId ? null : s.elId)}>
                    {s.protect?.length ? `What must stay · ${s.protect.length}` : 'What must stay…'}
                  </button>
                )}
              </div>
            ))}
          </div>
          {crops && sources && !sources.some((s) => s.protect?.length) && <p className="rs-line faint">Mark what must stay and every crop keeps it in; else the crop keeps the middle.</p>}
          {tooFar && <p className="rs-line rs-toofar" role="note">{tooFar}</p>}
          {markingSrc && createPortal(
            // On the page, not over the canvas (as the Campaign board's ProtectSheet): the canvas never sees its drags.
            <div className="cf-scrim" role="presentation" onPointerDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) setMarking(null) }}>
              <section className="cf-sheet pt-panel" role="dialog" aria-modal="true" aria-label="What must stay">
                <header className="cf-sheethead">
                  <h2>What must stay in every shape</h2>
                  <button type="button" className="btn xs ghost" onClick={() => setMarking(null)}>Close</button>
                </header>
                <div className="cf-body">
                  <div className="faint cf-note">Every crop keeps these in; an extend centres on them and a redraw is told them. Make all sizes uses the same boxes.</div>
                  <ProtectEditor master={{ asset: markingSrc.asset, w: markingSrc.w, h: markingSrc.h }} boxes={markingSrc.protect ?? []}
                    setBoxes={(b) => {
                      setKept((k) => ({ ...k, [markingSrc.elId]: b }))
                      rememberProtect(markingSrc.asset, markingSrc, b)
                      // A crop moved by hand stays where it was put while it keeps every box in; else it follows the boxes.
                      setMoved((m) => Object.fromEntries(Object.entries(m).filter(([key, crop]) => !key.startsWith(`${markingSrc.elId}:`) || cropKeeps(crop, b))))
                    }} />
                  <footer className="cf-foot"><span className="pt-grow" /><button type="button" className="btn primary" onClick={() => setMarking(null)}>Done</button></footer>
                </div>
              </section>
            </div>,
            document.body,
          )}

          {error && <p className="cf-error" role="alert">{error}</p>}
          <footer className="cf-foot">
            <span className="rs-line faint">{shapes.length ? `${pictures} × ${shapes.length} ${shapes.length === 1 ? 'shape' : 'shapes'} · each beside its original` : 'Pick one or more shapes.'}</span>
            <span className="pt-grow" />
            <button type="button" className="btn primary" disabled={!n} onClick={() => setStep('tray')}>{makeWords(n)}</button>
          </footer>
        </>
      )}

      {step === 'tray' && (
        <>
          <div className="cf-trayhead">
            <AgentFigure agent="wren" size={22} decorative />
            <span><b>The Camera agent</b> will make</span>
          </div>
          <div className="cb-trayrows rs-trayrows" role="list" aria-label="What the Camera agent will make">
            {trayRows(planned, models, (s, i) => `${KIND_WORD[s.kind]} ${i + 1}`).map((r) => (
              <div key={r.id} className="cb-trayrow" role="listitem"><span className="cb-trayname">{r.name}</span><span className="cf-dots" /><span className="cb-traywords">{r.words}</span></div>
            ))}
          </div>
          {tooFar && <p className="rs-line rs-toofar" role="note">{tooFar}</p>}
          <p className="rs-line faint">Each is its own job: one that fails says so on its card, the others carry on.</p>
          {error && <p className="cf-error" role="alert">{error}</p>}
          <footer className="cf-foot">
            <button type="button" className="btn ghost" onClick={() => setStep('pick')}>Back</button>
            <span className="pt-grow" />
            <button type="button" className="btn primary" disabled={busy || !n} onClick={() => void go()}>{busy ? 'Starting…' : `Send ${n}`}</button>
          </footer>
        </>
      )}
    </div>
  )
}

function ShapeIcon({ s }: { s: Shape }) {
  const k = 12 / Math.max(s.w, s.h)
  return <span aria-hidden="true" className="rs-icon" style={{ width: Math.max(3, s.w * k), height: Math.max(3, s.h * k) }} />
}

/** One picture with each chosen shape over it as a dashed frame: inside it for a crop (round what must stay, and
 *  dragged to move it), round it otherwise. Each frame's tag sits on a line of its own, so two never overlap (IMG-17). */
function Preview({ s, shapes, how, models, moved, onMove }: {
  s: Source; shapes: Shape[]; how: How; models: ReturnType<typeof methodModels>
  moved: Record<string, PxBox>
  onMove(shapeId: string, box: PxBox): void
}) {
  const url = useBlobUrl(s.asset)
  const drag = useRef<{ id: string; x: number; y: number; from: PxBox; k: number } | null>(null)
  const frames = shapes.map((sh) => {
    const m = methodOf(how, s, sh, models)
    return { id: sh.id, box: frameOver(s, sh, m ?? 'crop', moved[`${s.elId}:${sh.id}`]), method: m }
  })
  const lay = previewLayout(s, frames, { w: 180, h: 132 })
  const k = lay.picture.w / s.w
  return (
    <figure className="rs-prev" style={{ width: lay.w, height: lay.h }} title={frames.map((f) => `${f.id}: ${f.method ? methodLine(f.method, models) : 'off'}`).join('\n')}>
      {url ? <img src={url} alt="" style={{ left: lay.picture.x, top: lay.picture.y, width: lay.picture.w, height: lay.picture.h }} />
        : <span className="rs-ph" style={{ left: lay.picture.x, top: lay.picture.y, width: lay.picture.w, height: lay.picture.h }} />}
      {(s.protect ?? []).map((b, i) => (
        <span key={`keep${i}`} className={`rs-keepbox ${b.role}`} aria-hidden="true"
          style={{ left: lay.picture.x + b.x * k, top: lay.picture.y + b.y * k, width: b.w * k, height: b.h * k }} />
      ))}
      {lay.frames.map((f, i) => {
        const own = frames[i]
        const movable = own.method === 'crop'
        return (
          <span key={f.id} className={`rs-frame${movable ? ' move' : ''}`} data-shape={f.id} style={{ left: f.box.x, top: f.box.y, width: f.box.w, height: f.box.h }}
            title={movable ? `${f.id}: drag to move the crop` : undefined}
            onPointerDown={movable ? (e) => {
              e.preventDefault()
              ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
              drag.current = { id: f.id, x: e.clientX, y: e.clientY, from: own.box, k }
            } : undefined}
            onPointerMove={movable ? (e) => {
              const d = drag.current
              if (!d || d.id !== f.id) return
              onMove(f.id, panCrop(d.from, (e.clientX - d.x) / d.k, (e.clientY - d.y) / d.k, { w: s.w, h: s.h }))
            } : undefined}
            onPointerUp={movable ? () => { drag.current = null } : undefined}>
            <span className="rs-tag" style={{ top: 2 + i * 15 }}>{f.id}</span>
          </span>
        )
      })}
    </figure>
  )
}
