// Resize… (features/resize-selection.clan): the panel over the picture bar. Shapes as chips (the last
// pick remembered in this browser), How (Redraw by default, Extend, Crop, Auto) with one plain line, a
// preview of every selected picture with the shapes over it as dashed frames, and a footer that says
// exactly how many pictures it makes. Its button opens the send tray (each picture × shape with its
// method and model, never a price); Send places every result and starts one job each.

import { useEffect, useMemo, useState } from 'react'
import { useConfig } from '../app/context'
import { useBlobUrl, useFloating } from '../ui/hooks'
import type { Anchor } from '../lib/place'
import { AgentFigure } from '../ui/agents/AgentFigure'
import { methodModels } from './rules'
import {
  frameOver, HOW_LINE, HOW_WORD, howOff, HOWS, loadPick, makeWords, methodLine, methodOf, mixedLine, parseCustom, planResize,
  previewLayout, savePick, SHAPES, SKETCH_LINE, trayRows, type How, type Shape, type Source,
} from './resizeSelection'
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
  const models = useMemo(() => methodModels(config), [config])
  const first = useMemo(() => loadPick(), [])
  const [shapes, setShapes] = useState<Shape[]>(first.shapes)
  const [how, setHow] = useState<How>(howOff(first.how, models) ? 'auto' : first.how)
  const [custom, setCustom] = useState<string | null>(null)
  const [sources, setSources] = useState<Source[] | null>(null)
  const [step, setStep] = useState<'pick' | 'tray'>('pick')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Read once, when the panel opens (a scamp's picture is exported then).
  const [loading] = useState(() => load())
  useEffect(() => {
    let alive = true
    loading.then((s) => { if (alive) setSources(s) }).catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Those pictures could not be read.') })
    return () => { alive = false }
  }, [loading])
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const remember = (next: { shapes?: Shape[]; how?: How }) => savePick({ shapes: next.shapes ?? shapes, how: next.how ?? how })
  const toggle = (s: Shape) => {
    const next = shapes.some((x) => x.id === s.id) ? shapes.filter((x) => x.id !== s.id) : [...shapes, s]
    setShapes(next)
    remember({ shapes: next })
  }
  const pickHow = (h: How) => {
    setHow(h)
    remember({ how: h })
  }
  const customs = shapes.filter((s) => !SHAPES.some((x) => x.id === s.id))
  const parsed = custom !== null ? parseCustom(custom) : null
  const addCustom = () => {
    if (!parsed) return
    if (!shapes.some((x) => x.id === parsed.id)) toggle(parsed)
    setCustom(null)
  }

  const planned = sources ? planResize(sources, shapes, how, models) : []
  const n = planned.length
  const scamp = !!sources?.some((s) => s.kind !== 'picture')
  const mixed = sources ? mixedLine(sources.length, total) : undefined
  const pictures = sources?.length ?? 0

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
            {sources?.map((s) => <Preview key={s.elId} s={s} shapes={shapes} how={how} models={models} />)}
          </div>

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
            <span><b>Wren</b> will make</span>
          </div>
          <div className="cb-trayrows rs-trayrows" role="list" aria-label="What Wren will make">
            {trayRows(planned, models, (s, i) => `${KIND_WORD[s.kind]} ${i + 1}`).map((r) => (
              <div key={r.id} className="cb-trayrow" role="listitem"><span className="cb-trayname">{r.name}</span><span className="cf-dots" /><span className="cb-traywords">{r.words}</span></div>
            ))}
          </div>
          <p className="rs-line faint">Each is its own job: one that fails says so on its card, the others carry on. What each costs is in History.</p>
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

/** One picture with each chosen shape over it as a dashed frame: inside it for a crop, round it otherwise. */
function Preview({ s, shapes, how, models }: { s: Source; shapes: Shape[]; how: How; models: ReturnType<typeof methodModels> }) {
  const url = useBlobUrl(s.asset)
  const frames = shapes.map((sh) => {
    const m = methodOf(how, s, sh, models)
    return { id: sh.id, box: frameOver(s, sh, m ?? 'crop'), method: m }
  })
  const lay = previewLayout(s, frames)
  return (
    <figure className="rs-prev" style={{ width: lay.w, height: lay.h }} title={frames.map((f) => `${f.id}: ${f.method ? methodLine(f.method, models) : 'off'}`).join('\n')}>
      {url ? <img src={url} alt="" style={{ left: lay.picture.x, top: lay.picture.y, width: lay.picture.w, height: lay.picture.h }} />
        : <span className="rs-ph" style={{ left: lay.picture.x, top: lay.picture.y, width: lay.picture.w, height: lay.picture.h }} />}
      {lay.frames.map((f) => (
        <span key={f.id} className="rs-frame" data-shape={f.id} style={{ left: f.box.x, top: f.box.y, width: f.box.w, height: f.box.h }}>
          <span className="rs-tag">{f.id}</span>
        </span>
      ))}
    </figure>
  )
}
