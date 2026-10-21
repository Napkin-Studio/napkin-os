// The Change drawer (board Change a take): the one place to make a take again with one thing changed. It
// opens as the Make room's Change tab, or as a drawer over the Edit room so the cut stays in view. It always
// names the parent, says what is kept and what changes, and sends remakeWith(parent, delta): a new take
// beside the parent, never over it. Camera, Words, A moment and The whole feel are built (P1); Cast and
// look, Make it longer and Blend come later and say so.

import { useMemo, useRef, useState } from 'react'
import { useConfig, useDoc, useServices } from '../app/context'
import { momentWindow } from '../../../clan-store/src'
import { CAMERA_MOVEMENTS, type CameraMovement, type Region, type Strength } from '../contracts/types'
import { updateDoc } from '../doc/store'
import { rectToRegion } from '../lib/region'
import { modelLabel } from '../capabilities'
import { remakeWith, type RemakeDelta } from '../jobs/remake'
import { shotNumber } from '../model/selectors'
import { useSending } from '../ui/hooks'
import { cameraWord, changesSomething, clock, diffLines, keepsWords, VERBS, type ChangeVerb, type DeltaRow } from './delta'
import { boxName, genTitle, repeatsTake, shotTitle, shotWindow, type Gen } from './model'
import { TakePlayer } from './Players'
import { tc } from './media'
import type { RoomData } from './Rooms'

/** What the drawer opens on. `mark`: a stretch of the parent (its own time) marked in Edit with I/O. */
export interface ChangeOpen {
  parentId: string
  shotId?: string
  verb?: ChangeVerb
  /** The clip in the cut it was opened from (Edit), for the ad-time readout. */
  clip?: { startS: number; inS: number; speed: number }
  mark?: { inS: number; outS: number }
}

const STRENGTHS: { id: Strength; label: string }[] = [
  { id: 'adhere', label: 'Keep close' }, { id: 'flex', label: 'Balanced' }, { id: 'reimagine', label: 'Reimagine' },
]
const LATER: { label: string; why: string }[] = [
  { label: 'Cast and look', why: 'Coming soon: swap who or what is in it' },
  { label: 'Make it longer', why: 'Coming soon: carry the take on' },
  { label: 'Blend with other clips', why: 'Coming soon: make one shot from several' },
]

export function ChangeDrawer({ data, open, variant, onClose, onMade, onApart }: {
  data: RoomData
  open: ChangeOpen
  variant: 'tab' | 'drawer'
  onClose: () => void
  /** The take was sent: its job id. */
  onMade: (jobId?: string) => void
  /** "Make shot n apart instead": the box tab with that shot. */
  onApart?: (shotId: string) => void
}) {
  const services = useServices()
  const { doc: docStore } = services
  const doc = useDoc()
  const { controls } = useConfig()
  const parent = data.gens.find((g) => g.id === open.parentId)
  const record = doc.generations?.[open.parentId]
  const [verb, setVerb] = useState<ChangeVerb>(open.verb ?? (open.mark ? 'moment' : 'camera'))
  const [shotId, setShotId] = useState<string | undefined>(open.shotId ?? parent?.shotIds[0])
  const shot = shotId ? doc.shots[shotId] : undefined
  const [move, setMove] = useState<CameraMovement | null>(null)
  const [words, setWords] = useState(shot?.action ?? '')
  const [feel, setFeel] = useState('')
  const [strength, setStrength] = useState<Strength>('flex')
  const [note, setNote] = useState('')
  const [mark, setMark] = useState(open.mark ?? (parent ? { inS: shotWindow(parent, shotId).inS, outS: Math.min(parent.durationS, shotWindow(parent, shotId).inS + 1) } : { inS: 0, outS: 1 }))
  const [region, setRegion] = useState<Region | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [future, setFuture] = useState(false)
  const [t, setT] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [sending, send] = useSending()
  const shotNo = (id: string) => shotNumber(doc, id)
  // Another shot picked: its own words to start from.
  const [wordsOf, setWordsOf] = useState(shot?.id)
  if (wordsOf !== shot?.id) {
    setWordsOf(shot?.id)
    setWords(shot?.action ?? '')
  }
  if (!parent) return <div className={`rm-change ${variant}`}><p className="rm-note rm-pad">That take is gone.</p></div>

  const together = parent.shotIds.length > 1
  const was = (record?.inputs?.camera?.[shotId ?? '']?.movement ?? shot?.camera.movement ?? 'static') as CameraMovement
  const win = verb === 'moment' ? momentWindow(mark.inS, mark.outS, parent.durationS) : null
  const delta: DeltaRow[] = verb === 'camera'
    ? (move && move !== was ? [{ field: 'camera.movement', from: was, to: move, ...(shotId ? { shot_id: shotId } : {}) }] : [])
    : verb === 'words'
      ? (words.trim() && words.trim() !== (shot?.action ?? '').trim() ? [{ field: 'words', from: shot?.action ?? null, to: words.trim(), ...(shotId ? { shot_id: shotId } : {}) }] : [])
      : verb === 'moment'
        ? (note.trim() && win ? [{ field: 'moment', to: note.trim(), window: win.window }] : [])
        : (feel.trim() ? [{ field: 'feel', to: feel.trim() }] : [])
  const refs = (record?.inputs?.refs ?? []).map((r) => r.name?.split('_')[0]).filter((x): x is string => !!x)
  const seed = repeatsTake(parent.provider, parent.model)
  const keeps = keepsWords(verb, { refs, lengthS: parent.durationS, seed, ...(win ? { window: win.window } : {}) })
  const diff = diffLines(delta, shotNo)
  const ready = changesSomething(delta) && (verb !== 'moment' || controls.fixMoment)
  const adAt = open.clip ? open.clip.startS + Math.max(0, t - open.clip.inS) / (open.clip.speed || 1) : undefined
  const why = verb === 'moment' && !controls.fixMoment ? 'Changing a moment is off on this stack.' : !delta.length ? 'Choose what changes first.' : undefined

  const make = () => send(async () => {
    setError(null)
    try {
      const rd: RemakeDelta[] = delta.map((r): RemakeDelta => {
        if (r.field === 'moment') return { field: 'moment', to: { inS: win!.window.from_s, outS: win!.window.to_s, note: String(r.to), ...(region ? { region } : {}) } }
        if (r.field === 'feel') return { field: 'feel', to: { words: String(r.to), strength } }
        if (r.field === 'camera.movement') return { field: 'camera.movement', to: r.to as CameraMovement, ...(r.shot_id ? { shotId: r.shot_id } : {}) }
        return { field: 'words', to: String(r.to), ...(r.shot_id ? { shotId: r.shot_id } : {}) }
      })
      const jobId = await remakeWith(services, { videoId: data.videoId, parentId: parent.id, delta: rd, label: diffLabel(delta, shotNo) })
      // "Also use this for future takes": the shot itself changes too, so the next Make keeps it.
      if (future && shotId && (verb === 'camera' || verb === 'words')) {
        await updateDoc(docStore, (d) => {
          const s = d.shots[shotId]
          if (!s) return
          if (verb === 'camera' && move) s.camera = { ...s.camera, movement: move }
          if (verb === 'words') s.action = words.trim()
        }, `shot ${shotNo(shotId)} ${verb === 'camera' ? 'camera movement' : 'words'} for future takes`)
      }
      onMade(jobId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  })

  const header = `Change: ${genTitle(parent, data.boxes)}`
  return (
    <section className={`rm-change ${variant}`} aria-label={header} role={variant === 'drawer' ? 'dialog' : undefined}>
      <header className="rm-changehead">
        <b className="rm-clamp2" title={header}>{header}</b>
        {variant === 'drawer' && <button type="button" className="rm-iconbtn ghost" aria-label="Close" title="Close (Esc)" onClick={onClose}>×</button>}
      </header>
      <div className="rm-changebody">
        <SourcePlayer parent={parent} mark={verb === 'moment' ? (win ? { inS: win.window.from_s, outS: win.window.to_s } : mark) : undefined}
          drawing={verb === 'moment' && drawing} region={region} onRegion={(r) => { setRegion(r); setDrawing(false) }} onTime={setT}
          readout={`${boxName(data.boxes.find((b) => b.key === parent.boxKey) ?? { n: 0, endCard: false })} at ${tc(t)}${adAt !== undefined ? ` · ad ${tc(adAt)}` : ''}`} />
        <div className="rm-verbs" role="radiogroup" aria-label="What to change">
          {VERBS.map((v) => (
            <div key={v.id} className={`rm-verb ${verb === v.id ? 'open' : ''}`}>
              <button type="button" role="radio" aria-checked={verb === v.id} className="rm-verbrow" title={v.hint} onClick={() => setVerb(v.id)}>
                <span>{v.label}</span><span className="rm-faint rm-clamp1">{v.hint}</span>
              </button>
              {verb === v.id && (
                <div className="rm-verbbody">
                  {(v.id === 'camera' || v.id === 'words') && together && (
                    <div className="rm-row"><span className="rm-rowname">Shot</span>
                      <div className="rm-chiprow" role="radiogroup" aria-label="Which shot">
                        {parent.shotIds.map((id) => <button key={id} type="button" role="radio" aria-checked={shotId === id} className={`rm-chip ${shotId === id ? 'on' : ''}`} onClick={() => { setShotId(id); setMove(null) }}>{shotNo(id)}</button>)}
                      </div>
                    </div>
                  )}
                  {v.id === 'camera' && (
                    <>
                      <div className="rm-rowname">Movement <span className="rm-faint">· was {cameraWord('movement', was)}</span></div>
                      <div className="rm-movegrid" role="radiogroup" aria-label="Movement">
                        {CAMERA_MOVEMENTS.filter((m) => m !== 'crane_down').map((m) => (
                          <button key={m} type="button" role="radio" aria-checked={(move ?? was) === m} className={`rm-chip ${(move ?? was) === m ? 'on' : ''} ${m === was ? 'was' : ''}`} onClick={() => setMove(m)}>{cameraWord('movement', m)}</button>
                        ))}
                      </div>
                      <p className="rm-note">Made as a new take from the same start frame and references. The camera can't be changed on a finished clip.{seed ? '' : ' Other details may change too.'}</p>
                    </>
                  )}
                  {v.id === 'words' && (
                    <label className="rm-fieldlabel">What happens in shot {shotId ? shotNo(shotId) : ''}
                      <textarea className="rm-textarea" rows={3} maxLength={600} value={words} onChange={(e) => setWords(e.target.value)} placeholder={shot ? shotTitle(shot, shotNo(shot.id)) : ''} />
                    </label>
                  )}
                  {v.id === 'moment' && (
                    <>
                      <MomentScrub lengthS={parent.durationS} mark={mark} onMark={setMark} snapped={win?.window} />
                      <p className="rm-note" role="status">{win
                        ? `Changes ${clock(win.window.from_s)}-${clock(win.window.to_s)} of this take (whole seconds, at least 2 s)${momentShots(parent, win.window, shotNo)}.`
                        : 'This take is too short to change part of it. Change the whole feel instead.'}</p>
                      <div className="rm-row">
                        <button type="button" className={`btn ${drawing ? 'on' : ''}`} aria-pressed={drawing} onClick={() => setDrawing(!drawing)}>{region ? 'Draw the box again' : 'Draw a box on the frame'}</button>
                        {region && <button type="button" className="btn ghost" onClick={() => setRegion(null)}>Remove the box</button>}
                      </div>
                      <label className="rm-fieldlabel">What should change here?
                        <textarea className="rm-textarea" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="his shirt is deep red" />
                      </label>
                      <p className="rm-note">A change to part of a clip takes a few minutes. The rest of the take, its sound and its length stay.</p>
                    </>
                  )}
                  {v.id === 'feel' && (
                    <>
                      <label className="rm-fieldlabel">The whole feel
                        <textarea className="rm-textarea" rows={2} maxLength={1000} value={feel} onChange={(e) => setFeel(e.target.value)} placeholder="golden hour, warmer, softer" />
                      </label>
                      {controls.feelStrength && (
                        <div className="rm-seg" role="radiogroup" aria-label="How much to change">
                          {STRENGTHS.map((s) => <button key={s.id} type="button" role="radio" aria-checked={strength === s.id} className={strength === s.id ? 'on' : ''} onClick={() => setStrength(s.id)}>{s.label}</button>)}
                        </div>
                      )}
                    </>
                  )}
                  {(v.id === 'camera' || v.id === 'words') && together && shotId && (
                    <div className="rm-banner info">
                      Shot {shotNo(shotId)} was filmed with {parent.shotIds.filter((x) => x !== shotId).map((x) => `shot ${shotNo(x)}`).join(' and ')}, so all {parent.shotIds.length} are remade. Only shot {shotNo(shotId)}'s {v.id === 'camera' ? 'camera' : 'words'} change{v.id === 'camera' ? 's' : ''}.
                      {onApart && <button type="button" className="btn link" onClick={() => onApart(shotId)}>Make shot {shotNo(shotId)} apart instead</button>}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {LATER.map((l) => (
            <div key={l.label} className="rm-verb later"><button type="button" className="rm-verbrow" disabled title={l.why}><span>{l.label}</span><span className="rm-faint rm-clamp1">{l.why}</span></button></div>
          ))}
        </div>
      </div>
      <footer className="rm-changefoot">
        <div className="rm-keeps rm-clamp2" title={keeps}><b>Keeps:</b> {keeps}</div>
        <div className={`rm-diff ${diff.length ? '' : 'empty'}`} aria-live="polite">{diff.length ? diff.map((l) => <div key={l} className="rm-clamp2" title={l}>{l}</div>) : 'Nothing changes yet.'}</div>
        <div className="rm-faint rm-clamp1" title="The model it is made on">Made on {modelLabel(parent.provider, parent.model) ?? 'the same model'}{seed ? ', which can repeat the take' : ", which can't repeat the take exactly"}</div>
        {(verb === 'camera' || verb === 'words') && (
          <label className="rm-check"><input type="checkbox" checked={future} onChange={(e) => setFuture(e.target.checked)} /> Also use this for future takes of this shot</label>
        )}
        {error && <div role="alert" className="rm-error">{error}</div>}
        <button type="button" className="btn primary rm-wide" disabled={!ready || sending} title={why} onClick={() => void make()}>{sending ? 'Sending…' : 'Make new take'}</button>
      </footer>
    </section>
  )
}

/** The take's one-line label for its delta. */
function diffLabel(delta: DeltaRow[], shotNo: (id: string) => number): string {
  return diffLines(delta, shotNo)[0]?.replace(/^Shot (\d+) camera movement: .* → (.*)$/, 'Camera: $2 (shot $1)').replace(/^Shot (\d+) words: .*“(.*)”$/, 'Words: $2 (shot $1)').slice(0, 120) ?? ''
}

/** "(shot 4 and the start of shot 5)": the shots a window covers. */
function momentShots(g: Gen, w: { from_s: number; to_s: number }, shotNo: (id: string) => number): string {
  if (g.segments.length < 2) return ''
  const hit = g.segments.filter((s) => s.inS < w.to_s && s.outS > w.from_s).map((s) => `shot ${shotNo(s.shotId)}`)
  return hit.length ? `: ${hit.join(' and ')}` : ''
}

/** The parent's player, with the mark and the box drawn over it. */
function SourcePlayer({ parent, mark, drawing, region, onRegion, onTime, readout }: {
  parent: Gen; mark?: { inS: number; outS: number }; drawing: boolean; region: Region | null; onRegion: (r: Region) => void
  onTime: (s: number) => void; readout: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null)
  const at = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height }
  }
  const shown = drag
    ? { left: Math.min(drag.a.x, drag.b.x), top: Math.min(drag.a.y, drag.b.y), width: Math.abs(drag.b.x - drag.a.x), height: Math.abs(drag.b.y - drag.a.y) }
    : region ? { left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.w * 100}%`, height: `${region.h * 100}%` } : null
  const seekTo = useMemo(() => mark?.inS, [mark?.inS])
  return (
    <div className="rm-source">
      <TakePlayer sha={parent.asset} label="" onTime={onTime} seekTo={seekTo}
        overlay={(
          <div ref={box} className={`rm-drawlayer ${drawing ? 'on' : ''}`}
            onPointerDown={drawing ? (e) => { (e.target as Element).setPointerCapture?.(e.pointerId); const p = at(e); setDrag({ a: p, b: p }) } : undefined}
            onPointerMove={drawing ? (e) => drag && setDrag({ ...drag, b: at(e) }) : undefined}
            onPointerUp={drawing ? (e) => { if (drag) { const p = at(e); const r = rectToRegion(drag.a, p, { w: p.w, h: p.h }); if (r) onRegion(r); setDrag(null) } } : undefined}>
            {shown && <div className="rm-region" style={shown} />}
          </div>
        )} />
      <div className="rm-readout pt-mono rm-clamp1" title={readout}>{readout}</div>
    </div>
  )
}

/** A strip of the take with the marked stretch to drag, and the window it snaps to drawn as a band. */
function MomentScrub({ lengthS, mark, onMark, snapped }: { lengthS: number; mark: { inS: number; outS: number }; onMark: (m: { inS: number; outS: number }) => void; snapped?: { from_s: number; to_s: number } }) {
  const ref = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<'in' | 'out' | null>(null)
  const pct = (s: number) => `${(Math.max(0, Math.min(lengthS, s)) / Math.max(0.01, lengthS)) * 100}%`
  const toS = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    return Math.round(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * lengthS * 10) / 10
  }
  return (
    <div className="rm-moment" ref={ref} aria-label="The stretch to change"
      onPointerMove={(e) => {
        if (!dragging) return
        const s = toS(e.clientX)
        onMark(dragging === 'in' ? { inS: Math.min(s, mark.outS - 0.1), outS: mark.outS } : { inS: mark.inS, outS: Math.max(s, mark.inS + 0.1) })
      }}
      onPointerUp={() => setDragging(null)} onPointerLeave={() => setDragging(null)}>
      {snapped && <span className="rm-moment-snap" style={{ left: pct(snapped.from_s), width: `calc(${pct(snapped.to_s)} - ${pct(snapped.from_s)})` }} aria-hidden="true" />}
      <span className="rm-moment-mark" style={{ left: pct(mark.inS), width: `calc(${pct(mark.outS)} - ${pct(mark.inS)})` }} aria-hidden="true" />
      <button type="button" className="rm-moment-h" style={{ left: pct(mark.inS) }} aria-label={`Start of the stretch, ${tc(mark.inS)}`}
        onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); setDragging('in') }}
        onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') onMark({ inS: Math.max(0, Math.min(mark.outS - 0.1, mark.inS + (e.key === 'ArrowLeft' ? -0.1 : 0.1))), outS: mark.outS }) }} />
      <button type="button" className="rm-moment-h" style={{ left: pct(mark.outS) }} aria-label={`End of the stretch, ${tc(mark.outS)}`}
        onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); setDragging('out') }}
        onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') onMark({ inS: mark.inS, outS: Math.min(lengthS, Math.max(mark.inS + 0.1, mark.outS + (e.key === 'ArrowLeft' ? -0.1 : 0.1))) }) }} />
      <span className="rm-moment-tc pt-mono">{tc(mark.inS)}-{tc(mark.outS)}</span>
    </div>
  )
}
