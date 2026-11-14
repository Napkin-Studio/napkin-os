// The Edit room's timeline (board Edit room): a toolbar, a ruler with the playhead and the I/O marks, the Text
// row, the box brackets, V1 (magnetic) with its clips, fades and transitions, the end card locked last, and a
// read-only Sound row. Drag an edge to trim (ripple on V1 unless Ripple is off), drag a clip to move it, drag a
// fade corner to fade, click a cut for a dissolve or dip, drop a take from the Bin. V2 comes with P3.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDoc } from '../app/context'
import { shotNumber } from '../model/selectors'
import { Float, MenuItem } from '../ui/Float'
import { GEN_DRAG } from './Bin'
import { clipEnd, clipLen, endCardStart, handleShort, MAX_TRANSITION_S, sortV1, type Cut, type CutClip, type CutText, type Transition } from './cut'
import { boxName, shotTitle, type Gen } from './model'
import { Poster } from './Poster'
import { tc } from './media'
import type { RoomData } from './Rooms'

export type Picked = { kind: 'clip'; id: string } | { kind: 'text'; id: string } | { kind: 'card' } | null

export interface TimelineActions {
  seek: (s: number) => void
  pick: (p: Picked) => void
  assemble: () => void
  trimHead: (c: CutClip, inS: number) => void
  trimTail: (c: CutClip, outS: number) => void
  move: (c: CutClip, to: number) => void
  fades: (c: CutClip, f: { inS?: number; outS?: number }) => void
  transition: (c: CutClip, t: Transition | undefined) => void
  split: () => void
  addText: () => void
  captions: () => void
  text: (t: CutText, patch: Partial<Omit<CutText, 'id'>>) => void
  drop: (genId: string, atS: number) => void
  menu: (c: CutClip, verb: 'change' | 'part' | 'feel' | 'remove' | 'takes') => void
  ready: (c: CutClip, take: Gen) => void
  openSound: () => void
}

const RULER = 32

export function Timeline({ data, cut, t, marks, picked, ripple, onRipple, snap, onSnap, making, ready, actions }: {
  data: RoomData
  cut: Cut
  t: number
  marks: { in?: number; out?: number }
  picked: Picked
  ripple: boolean
  onRipple: (r: boolean) => void
  snap: boolean
  onSnap: (s: boolean) => void
  /** Clips whose box has a take being made. */
  making: Set<string>
  /** A newer take ready for a clip, by clip id. */
  ready: Map<string, Gen>
  actions: TimelineActions
}) {
  const doc = useDoc()
  const scroller = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(900)
  const [zoom, setZoom] = useState(1)
  const length = Math.max(cutEndOf(cut), data.targetS, 1)
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  const pps = Math.max(24, ((width - 24) / (length + 0.5)) * zoom)
  const x = (s: number) => s * pps
  const v1 = sortV1(cut.v1)
  const takeS = useCallback((genId: string) => data.gens.find((g) => g.id === genId)?.durationS ?? 0, [data.gens])
  const cardAt = endCardStart(cut)
  const total = (length + 1) * pps
  const snapTo = (s: number) => {
    if (!snap) return s
    const points = [0, t, ...v1.flatMap((c) => [c.startS, clipEnd(c)]), ...(marks.in !== undefined ? [marks.in] : []), ...(marks.out !== undefined ? [marks.out] : [])]
    const near = points.find((p) => Math.abs(p - s) * pps < 8)
    return near ?? s
  }
  const timeAt = (clientX: number) => {
    const el = scroller.current!
    const r = el.getBoundingClientRect()
    return Math.max(0, (clientX - r.left + el.scrollLeft) / pps)
  }
  // Boxes made together, as brackets over their clips: runs of neighbouring clips of one take.
  const brackets = useMemo(() => {
    const out: { from: number; to: number; label: string }[] = []
    let i = 0
    while (i < v1.length) {
      let j = i
      while (j + 1 < v1.length && v1[j + 1].genId === v1[i].genId && Math.abs(v1[j + 1].startS - clipEnd(v1[j])) < 0.01) j++
      const g = data.gens.find((x) => x.id === v1[i].genId)
      if (j > i && g) {
        const b = data.boxes.find((x) => x.key === g.boxKey)
        out.push({ from: v1[i].startS, to: clipEnd(v1[j]), label: `${b ? boxName(b) : 'One take'} · made together` })
      }
      i = j + 1
    }
    return out
  }, [v1, data.gens, data.boxes])

  const seekDrag = (e: React.PointerEvent) => {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    actions.seek(timeAt(e.clientX))
    const move = (ev: PointerEvent) => actions.seek(timeAt(ev.clientX))
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <section className="rm-timeline" aria-label="Timeline">
      <div className="rm-tltools" role="toolbar" aria-label="Timeline tools">
        <button type="button" className="btn" onClick={actions.split} title="Split the clip under the playhead (S)">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="3.5" cy="3.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.2" /><circle cx="3.5" cy="10.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.2" /><path d="M5.2 4.6 12.5 11M5.2 9.4 12.5 3" stroke="currentColor" strokeWidth="1.2" /></svg>
          Split <kbd>S</kbd>
        </button>
        <button type="button" className={`btn ${ripple ? 'on' : ''}`} aria-pressed={ripple} onClick={() => onRipple(!ripple)} title="Trims and deletes close up the cut">Ripple {ripple ? 'on' : 'off'}</button>
        <button type="button" className={`btn ${snap ? 'on' : ''}`} aria-pressed={snap} onClick={() => onSnap(!snap)} title="Snap to edges, the playhead and marks">Snap {snap ? 'on' : 'off'}</button>
        <span className="rm-tlsep" aria-hidden="true" />
        <button type="button" className="btn" onClick={actions.addText} title="Add text at the playhead (T)">+ Text <kbd>T</kbd></button>
        <button type="button" className="btn" onClick={actions.captions} title="Captions from the shots' spoken lines">Captions from the script</button>
        <span className="pt-grow" />
        <button type="button" className="rm-iconbtn" aria-label="Zoom out" onClick={() => setZoom(Math.max(0.5, zoom / 1.5))}>−</button>
        <span className="rm-faint pt-mono rm-zoom">{Math.round(zoom * 100)}%</span>
        <button type="button" className="rm-iconbtn" aria-label="Zoom in" onClick={() => setZoom(Math.min(8, zoom * 1.5))}>+</button>
      </div>
      <div className="rm-tlbody">
        <div className="rm-tlheads" aria-hidden="true">
          <span style={{ height: RULER }} />
          <span className="rm-tlhead" style={{ height: 40 }}>Text</span>
          <span style={{ height: 14 }} />
          <span className="rm-tlhead" style={{ height: 72 }}>V1</span>
          <span className="rm-tlhead" style={{ height: 32 }}>Sound</span>
        </div>
        <div className="rm-tlscroll" ref={scroller}>
          <div className="rm-tlinner" style={{ width: total }}>
            <div className="rm-ruler" style={{ height: RULER }} onPointerDown={seekDrag} role="slider" aria-label="Playhead" aria-valuemin={0} aria-valuemax={length} aria-valuenow={Math.round(t * 10) / 10} tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'ArrowRight') actions.seek(t + 1 / 24); if (e.key === 'ArrowLeft') actions.seek(Math.max(0, t - 1 / 24)) }}>
              {Array.from({ length: Math.ceil(length) + 1 }, (_, s) => (
                <span key={s} className="rm-rtick" style={{ left: x(s) }}><span className="pt-mono">{`0:${String(s).padStart(2, '0')}`}</span></span>
              ))}
              {marks.in !== undefined && marks.out !== undefined && <span className="rm-markrange" style={{ left: x(Math.min(marks.in, marks.out)), width: Math.abs(x(marks.out) - x(marks.in)) }} />}
              {marks.in !== undefined && <span className="rm-mark in" style={{ left: x(marks.in) }} title={`In ${tc(marks.in)}`}>I</span>}
              {marks.out !== undefined && <span className="rm-mark out" style={{ left: x(marks.out) }} title={`Out ${tc(marks.out)}`}>O</span>}
            </div>
            <div className="rm-row text" style={{ height: 40 }}>
              {cut.text.map((tx) => <TextBlock key={tx.id} tx={tx} x={x} pps={pps} picked={picked?.kind === 'text' && picked.id === tx.id} onPick={() => actions.pick({ kind: 'text', id: tx.id })} onChange={(p) => actions.text(tx, p)} snapTo={snapTo} />)}
              {!cut.text.length && <span className="rm-rowhint">T adds text at the playhead</span>}
            </div>
            <div className="rm-row brackets" style={{ height: 14 }}>
              {brackets.map((b) => <span key={b.from} className="rm-bracket" style={{ left: x(b.from), width: x(b.to) - x(b.from) }} title={b.label}><span className="rm-clamp1">{b.label}</span></span>)}
            </div>
            <div className="rm-row v1" style={{ height: 72 }}
              onDragOver={(e) => { if (e.dataTransfer.types.includes(GEN_DRAG)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } }}
              onDrop={(e) => { const id = e.dataTransfer.getData(GEN_DRAG); if (id) { e.preventDefault(); actions.drop(id, timeAt(e.clientX)) } }}>
              {!v1.length && (
                <div className="rm-assemble">
                  <button type="button" className="btn primary" onClick={actions.assemble} disabled={!data.gens.some((g) => g.state === 'ready')}>Assemble first cut</button>
                  <span className="rm-faint rm-clamp2">Fills V1 from the boxes in storyboard order, with the end card last. Or drag a take from the Bin.</span>
                </div>
              )}
              {v1.map((c, i) => (
                <ClipBlock key={c.id} c={c} n={i + 1} x={x} pps={pps} data={data} picked={picked?.kind === 'clip' && picked.id === c.id}
                  making={making.has(c.id)} ready={ready.get(c.id)} takeS={takeS(c.genId)} actions={actions} timeAt={timeAt} snapTo={snapTo} v1={v1}
                  title={c.follows?.shotId ? `Shot ${shotNumber(doc, c.follows.shotId)} · ${shotTitle(doc.shots[c.follows.shotId], shotNumber(doc, c.follows.shotId))}` : `Clip ${i + 1}`} />
              ))}
              {v1.slice(1).map((c, i) => (
                <CutMarker key={`cut:${c.id}`} c={c} at={x(c.startS)} short={handleShort(cut, c.id, takeS)} onSet={(tr) => actions.transition(c, tr)} prevLen={clipLen(v1[i])} />
              ))}
              {cut.endCard && (
                <button type="button" className={`rm-card ${picked?.kind === 'card' ? 'sel' : ''}`} style={{ left: x(cardAt), width: Math.max(44, x(cut.endCard.durS)), background: cut.endCard.bg }}
                  onClick={() => actions.pick({ kind: 'card' })} title={`End card: ${cut.endCard.line}. Locked last.`}>
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="5.5" width="8" height="5.5" rx="1" fill="currentColor" /><path d="M3.8 5.5V4a2.2 2.2 0 0 1 4.4 0v1.5" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
                  <span className="rm-clamp1">{cut.endCard.headline || cut.endCard.line}</span>
                </button>
              )}
            </div>
            <div className="rm-row sound" style={{ height: 32 }}>
              <span className="rm-rowhint">Sound is added in the Sound editor · <button type="button" className="btn link" onClick={actions.openSound}>Open Sound</button></span>
            </div>
            <span className="rm-playhead" style={{ left: x(t) }} aria-hidden="true" />
          </div>
        </div>
      </div>
    </section>
  )
}

const cutEndOf = (cut: Cut) => {
  const ends = cut.v1.map(clipEnd)
  const last = ends.length ? Math.max(...ends) : 0
  return last + (cut.endCard?.durS ?? 0)
}

/** Drag with the pointer: `onMove` gets the seconds moved (snapped by the caller), `onEnd` the last. */
function dragSeconds(e: React.PointerEvent, pps: number, onMove: (ds: number) => void, onEnd: (ds: number) => void) {
  e.stopPropagation()
  e.preventDefault()
  const x0 = e.clientX
  let last = 0
  const move = (ev: PointerEvent) => { last = (ev.clientX - x0) / pps; onMove(last) }
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); onEnd(last) }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

function ClipBlock({ c, n, x, pps, data, picked, making, ready, takeS, actions, title, timeAt, snapTo, v1 }: {
  c: CutClip; n: number; x: (s: number) => number; pps: number; data: RoomData; picked: boolean; making: boolean; ready?: Gen; takeS: number
  actions: TimelineActions; title: string; timeAt: (clientX: number) => number; snapTo: (s: number) => number; v1: CutClip[]
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [ghost, setGhost] = useState<{ left: number; width: number; tip: string } | null>(null)
  const [menu, setMenu] = useState(false)
  const closeMenu = useCallback(() => setMenu(false), [])
  const len = clipLen(c)
  const w = x(len)
  const narrow = w < 64
  const thumb = w >= 132
  const g = data.gens.find((x) => x.id === c.genId)
  const takes = g ? data.gens.filter((x) => x.boxKey === g.boxKey && x.state === 'ready').length : 0

  const trim = (edge: 'head' | 'tail') => (e: React.PointerEvent) => dragSeconds(e, pps, (ds) => {
    const s = snapTo(edge === 'head' ? c.startS + ds : clipEnd(c) + ds) - (edge === 'head' ? c.startS : clipEnd(c))
    const inS = c.inS + s * c.speed
    const outS = c.outS + s * c.speed
    setGhost(edge === 'head'
      ? { left: x(c.startS + s), width: x(len - s), tip: `In ${tc(Math.max(0, inS))} · ${s >= 0 ? '−' : '+'}${tc(Math.abs(s))}` }
      : { left: x(c.startS), width: x(len + s), tip: outS > takeS + 1e-6 ? 'Not enough footage. Make more?' : `Out ${tc(outS)} · ${s >= 0 ? '+' : '−'}${tc(Math.abs(s))}` })
  }, (ds) => {
    setGhost(null)
    if (Math.abs(ds) < 0.01) return
    const s = snapTo(edge === 'head' ? c.startS + ds : clipEnd(c) + ds) - (edge === 'head' ? c.startS : clipEnd(c))
    if (edge === 'head') actions.trimHead(c, Math.max(0, c.inS + s * c.speed))
    else actions.trimTail(c, c.outS + s * c.speed)
  })
  const moveDrag = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const x0 = e.clientX
    let moved = false
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - x0) < 6) return
      moved = true
      setGhost({ left: x(c.startS) + (ev.clientX - x0), width: w, tip: 'Move' })
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setGhost(null)
      if (!moved) return
      const at = timeAt(ev.clientX)
      const to = v1.filter((o) => o.id !== c.id && o.startS + clipLen(o) / 2 < at).length
      actions.move(c, to)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const fade = (side: 'in' | 'out') => (e: React.PointerEvent) => dragSeconds(e, pps, (ds) => {
    const v = Math.max(0, Math.min(len, (side === 'in' ? c.fadeInS : c.fadeOutS) + (side === 'in' ? ds : -ds)))
    setGhost({ left: x(c.startS), width: w, tip: `Fade ${side} ${v.toFixed(1)} s` })
  }, (ds) => {
    setGhost(null)
    const v = Math.max(0, Math.round(((side === 'in' ? c.fadeInS : c.fadeOutS) + (side === 'in' ? ds : -ds)) * 10) / 10)
    actions.fades(c, side === 'in' ? { inS: v } : { outS: v })
  })
  return (
    <>
      <div ref={ref} className={`rm-clip ${picked ? 'sel' : ''} ${narrow ? 'narrow' : ''} ${c.transition ? 'joined' : ''}`} style={{ left: x(c.startS), width: Math.max(8, w) }}
        role="button" tabIndex={0} aria-pressed={picked} aria-label={`${title}, ${len.toFixed(1)} s`} title={title}
        onClick={() => actions.pick({ kind: 'clip', id: c.id })} onPointerDown={moveDrag}
        onKeyDown={(e) => { if (e.key === 'Enter') actions.pick({ kind: 'clip', id: c.id }) }}
        onContextMenu={(e) => { e.preventDefault(); actions.pick({ kind: 'clip', id: c.id }); setMenu(true) }}>
        {thumb && <Poster sha={g?.asset} atS={c.inS} className="rm-clipthumb" />}
        {narrow ? <span className="rm-clipchip">{n}</span> : <span className="rm-clipname rm-clamp1">{title}</span>}
        {c.holdS > 0 && <span className="rm-hold" style={{ width: x(c.holdS) }} title={`Holds its last frame ${c.holdS.toFixed(1)} s`} aria-hidden="true" />}
        {c.fadeInS > 0 && <span className="rm-fadewedge in" style={{ width: x(c.fadeInS) }} aria-hidden="true" />}
        {c.fadeOutS > 0 && <span className="rm-fadewedge out" style={{ width: x(c.fadeOutS) }} aria-hidden="true" />}
        {making && <span className="rm-clipstate" role="status"><span className="rm-spin sm" aria-hidden="true" />Making</span>}
        {picked && (
          <>
            <span className="rm-trim head" onPointerDown={trim('head')} role="slider" aria-label="Trim the start" aria-valuenow={c.inS} tabIndex={-1} />
            <span className="rm-trim tail" onPointerDown={trim('tail')} role="slider" aria-label="Trim the end" aria-valuenow={c.outS} tabIndex={-1} />
            <span className="rm-fadeh in" onPointerDown={fade('in')} title="Drag to fade in" aria-hidden="true" />
            <span className="rm-fadeh out" onPointerDown={fade('out')} title="Drag to fade out" aria-hidden="true" />
          </>
        )}
      </div>
      {ready && !making && (
        <button type="button" className="rm-readybadge" style={{ left: x(c.startS) + 4 }} onClick={(e) => { e.stopPropagation(); actions.ready(c, ready) }}
          title={`New take ready: v${ready.version}, ${ready.label}`}>New take ready</button>
      )}
      {ghost && <span className="rm-ghost" style={{ left: ghost.left, width: Math.max(4, ghost.width) }}><span className="rm-ghosttip pt-mono">{ghost.tip}</span></span>}
      <Float anchor={ref} open={menu} onClose={closeMenu} label={title}>
        <MenuItem icon="✎" onSelect={() => { closeMenu(); actions.menu(c, 'change') }}>New take…</MenuItem>
        <MenuItem icon="◐" onSelect={() => { closeMenu(); actions.menu(c, 'part') }}>Change this part…</MenuItem>
        <MenuItem icon="☼" onSelect={() => { closeMenu(); actions.menu(c, 'feel') }}>Change the feel…</MenuItem>
        <MenuItem icon="⇥" disabled hint="soon" onSelect={closeMenu}>Make more</MenuItem>
        <MenuItem icon="▤" onSelect={() => { closeMenu(); actions.menu(c, 'takes') }}>Show takes ({takes})</MenuItem>
        <div className="fsep" />
        <MenuItem icon="✕" danger onSelect={() => { closeMenu(); actions.menu(c, 'remove') }}>Remove from cut</MenuItem>
      </Float>
    </>
  )
}

/** The cut between two V1 clips: a cut, a dissolve (a bow-tie) or a dip; click to choose. */
function CutMarker({ c, at, short, onSet, prevLen }: { c: CutClip; at: number; short: number; onSet: (t: Transition | undefined) => void; prevLen: number }) {
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const tr = c.transition
  const [s, setS] = useState(tr?.s ?? 0.5)
  const max = Math.min(MAX_TRANSITION_S, clipLen(c), Math.max(0.1, prevLen))
  const label = !tr ? 'Cut' : tr.kind === 'dissolve' ? `Dissolve ${tr.s} s` : `Dip to ${tr.kind === 'dip_white' ? 'white' : 'black'} ${tr.s} s`
  return (
    <>
      <button ref={ref} type="button" className={`rm-cutmark ${tr ? tr.kind : 'cut'}`} style={{ left: at }} aria-haspopup="dialog" aria-expanded={open} aria-label={`The join: ${label}`} title={label} onClick={(e) => { e.stopPropagation(); setOpen(!open) }}>
        {tr ? <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true"><path d="M1 1 L9 6 L1 11 Z M17 1 L9 6 L17 11 Z" fill="currentColor" /></svg> : <span className="rm-cutline-v" />}
      </button>
      <Float anchor={ref} open={open} onClose={close} role="dialog" label="The join" className="rm-joinpop">
        <div className="rm-floathead">The join</div>
        <div className="rm-seg" role="radiogroup" aria-label="Join">
          <button type="button" role="radio" aria-checked={!tr} className={!tr ? 'on' : ''} onClick={() => onSet(undefined)}>Cut</button>
          <button type="button" role="radio" aria-checked={tr?.kind === 'dissolve'} className={tr?.kind === 'dissolve' ? 'on' : ''} onClick={() => onSet({ kind: 'dissolve', s: Math.min(s, max) })}>Dissolve</button>
          <button type="button" role="radio" aria-checked={tr?.kind === 'dip_black'} className={tr?.kind === 'dip_black' ? 'on' : ''} onClick={() => onSet({ kind: 'dip_black', s: Math.min(s, max) })}>Dip to black</button>
        </div>
        <label className="rm-fieldlabel">Length <span className="pt-mono">{s.toFixed(1)} s</span>
          <input type="range" min={0.1} max={Math.max(0.1, max)} step={0.1} value={Math.min(s, max)} onChange={(e) => { const v = Number(e.target.value); setS(v); if (tr) onSet({ ...tr, s: v }) }} />
        </label>
        {tr && short > 0 && <p className="rm-note">The clip before has {Math.max(0, tr.s - short).toFixed(1)} s of footage after its cut: its last frame holds for {short.toFixed(1)} s. Trim it {short.toFixed(1)} s shorter for a smooth {tr.kind === 'dissolve' ? 'dissolve' : 'dip'}.</p>}
      </Float>
    </>
  )
}

function TextBlock({ tx, x, pps, picked, onPick, onChange, snapTo }: {
  tx: CutText; x: (s: number) => number; pps: number; picked: boolean; onPick: () => void; onChange: (p: Partial<Omit<CutText, 'id'>>) => void; snapTo: (s: number) => number
}) {
  const [ghost, setGhost] = useState<number | null>(null)
  const drag = (e: React.PointerEvent) => {
    onPick()
    dragSeconds(e, pps, (ds) => setGhost(ds), (ds) => {
      setGhost(null)
      if (Math.abs(ds) > 0.02) onChange({ startS: Math.max(0, snapTo(tx.startS + ds)) })
    })
  }
  return (
    <div className={`rm-textblock ${picked ? 'sel' : ''} ${tx.style}`} style={{ left: x(tx.startS + (ghost ?? 0)), width: Math.max(28, x(tx.durS)) }}
      role="button" tabIndex={0} aria-pressed={picked} title={`${tx.words} · ${tc(tx.startS)}-${tc(tx.startS + tx.durS)}`}
      onPointerDown={drag} onKeyDown={(e) => { if (e.key === 'Enter') onPick() }}>
      <span className="rm-clamp1">{tx.words || 'Text'}</span>
    </div>
  )
}
