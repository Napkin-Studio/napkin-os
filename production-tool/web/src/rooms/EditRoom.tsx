// The Edit room (board Edit room): cut like a normal editor. The Program viewer plays the compiled plan (Preview)
// or a render (Rendered); the Inspector edits what is picked; the timeline below holds V1, Text and the end card.
// Change this… opens the Change drawer over the room; a new take comes back as "New take ready" on its clips,
// and Use this take swaps it into the same slot. Edit never spends: Render ad is the only send, and it is free.
// Keys: space plays, J/K/L back/stop/play, I and O mark, S splits, T adds text, Delete removes (Shift keeps the
// gap), arrows step a frame.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { adTimeToSource } from '../../../clan-store/src'
import { useDoc, useJobsTick, useServices, useUi } from '../app/context'
import { assetRef } from '../jobs/assets'
import { isMoving, jobAt } from '../jobs/select'
import { spokenOf } from '../campaign/film'
import { currentRender, rendersOf, shotNumber } from '../model/selectors'
import { Float } from '../ui/Float'
import { useSending } from '../ui/hooks'
import type { ChangeOpen } from './ChangeDrawer'
import { clipEnd, clipLen, fitWords, handleShort, type CutClip } from './cut'
import { appendTake, assembleFirstCut, editCut } from './editOps'
import { Inspector } from './Inspector'
import { boxName, type Gen } from './model'
import { NewTakeSheet } from './NewTakeSheet'
import { tc } from './media'
import { isStill, useAssetUrl } from './media'
import type { RoomData, Selection } from './Rooms'
import { Timeline, type Picked } from './Timeline'
import { compileFor, dismissedTakes, newerTake, readCut, renderPlan, whereWords } from './timeline'
import { Viewer } from './Viewer'

const FRAME = 1 / 24

export function EditRoom({ data, sel, onSel, onChange, onSound, register }: {
  data: RoomData
  sel: Selection
  onSel: (s: Selection) => void
  onChange: (c: ChangeOpen) => void
  onSound: () => void
  register: (close: () => void) => () => void
}) {
  const { doc: docStore } = useServices()
  const doc = useDoc()
  const ui = useUi()
  useJobsTick()
  const cut = useMemo(() => readCut(doc, data.videoId), [doc, data.videoId])
  const plan = useMemo(() => compileFor(doc, data.videoId), [doc, data.videoId])
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [marks, setMarks] = useState<{ in?: number; out?: number }>({})
  const [ripple, setRipple] = useState(true)
  const [snap, setSnap] = useState(true)
  const [sheet, setSheet] = useState<{ clip: CutClip; take: Gen } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'preview' | 'rendered'>('preview')
  const [, rerender] = useState(0)
  const v1 = cut.v1
  // What is picked: a clip (the selection carries across: Make's take or shot picks its clip here), a text, the card.
  const [picked, setPicked] = useState<Picked>(() => {
    const c = v1.find((x) => (sel.clipId && x.id === sel.clipId)) ?? v1.find((x) => sel.shotId && x.follows?.shotId === sel.shotId)
    return c ? { kind: 'clip', id: c.id } : null
  })
  const pickedClip = picked?.kind === 'clip' ? v1.find((c) => c.id === picked.id) : undefined
  const pick = (p: Picked) => {
    setPicked(p)
    if (p?.kind === 'clip') {
      const c = v1.find((x) => x.id === p.id)
      const g = c ? data.gens.find((x) => x.id === c.genId) : undefined
      if (c) onSel({ ...sel, clipId: c.id, genId: c.genId, ...(g ? { boxKey: g.boxKey } : {}), ...(c.follows?.shotId ? { shotId: c.follows.shotId } : {}) })
      if (c) setT(c.startS + 0.001)
    }
  }
  useEffect(() => (sheet ? register(() => setSheet(null)) : undefined), [sheet, register])

  // A take being made for a clip's box (a remake of its take, or the box made again).
  const making = useMemo(() => {
    const out = new Set<string>()
    for (const c of v1) {
      const g = data.gens.find((x) => x.id === c.genId)
      const busy = jobAt(doc, ui, (x) => x.for === 'remake' && x.parentId === c.genId)
      if ((busy && isMoving(doc, busy)) || data.gens.some((x) => x.state === 'making' && g && x.boxKey === g.boxKey)) out.add(c.id)
    }
    return out
  }, [v1, data.gens, doc, ui])
  const ready = useMemo(() => {
    const out = new Map<string, Gen>()
    const gone = dismissedTakes()
    for (const c of v1) {
      const n = newerTake(c, data.gens)
      if (n && !gone.has(`${c.genId}>${n.id}`)) out.set(c.id, n)
    }
    return out
  }, [v1, data.gens])

  const nameOf = (genId: string) => {
    const g = data.gens.find((x) => x.id === genId)
    const b = g ? data.boxes.find((x) => x.key === g.boxKey) : undefined
    return b ? boxName(b) : 'A take'
  }
  const run = (p: Promise<unknown>) => void p.catch((e) => setError(e instanceof Error ? e.message : 'That did not work.'))
  const clipAtPlayhead = () => [...v1].reverse().find((c) => t >= c.startS && t < clipEnd(c))

  const changeFrom = (c: CutClip, verb?: ChangeOpen['verb'], mark?: ChangeOpen['mark']) => onChange({
    parentId: c.genId, ...(c.follows?.shotId ? { shotId: c.follows.shotId } : {}), ...(verb ? { verb } : {}), ...(mark ? { mark } : {}),
    clip: { startS: c.startS, inS: c.inS, speed: c.speed },
  })
  /** Change this part…: the I/O marks (or the playhead's second), mapped from ad time to the take's own time. */
  const changePart = (c?: CutClip) => {
    const lo = marks.in !== undefined && marks.out !== undefined ? Math.min(marks.in, marks.out) : t
    const hi = marks.in !== undefined && marks.out !== undefined ? Math.max(marks.in, marks.out) : t + 1
    const a = adTimeToSource(doc.videos[data.videoId]?.timeline ?? {}, lo)
    const b = adTimeToSource(doc.videos[data.videoId]?.timeline ?? {}, Math.max(lo, hi - 0.001))
    const clip = c ?? v1.find((x) => x.id === a?.item_id)
    if (!clip) { setError('Mark a stretch over a clip first (I and O).'); return }
    const inS = a?.item_id === clip.id ? a.source_s : clip.inS
    const outS = b?.item_id === clip.id ? b.source_s : clip.outS
    changeFrom(clip, 'moment', { inS, outS: Math.max(outS, inS + 0.1) })
  }

  const addText = () => run(editCut.addText(docStore, data.videoId, { words: 'New text', style: 'super', startS: Math.round(t * 10) / 10, durS: 3, fadeInS: 0.2, fadeOutS: 0.2 }).then((id) => setPicked({ kind: 'text', id })))
  const captions = () => {
    // The shots' spoken lines, each over its clip in the cut.
    const lines = v1.flatMap((c) => (c.follows?.shotId ? spokenOf(doc, c.follows.shotId).map((x) => ({ c, x })) : []))
    if (!lines.length) { setError('No spoken lines in these shots yet. Add lines in the Script editor, or press T to add text.'); return }
    void (async () => {
      for (const { c, x } of lines) {
        await editCut.addText(docStore, data.videoId, { words: x.text.slice(0, 300), style: 'caption', startS: Math.round((c.startS + x.atS) * 10) / 10, durS: Math.min(3, clipLen(c)), fadeInS: 0.1, fadeOutS: 0.1 })
      }
    })().catch((e) => setError(e instanceof Error ? e.message : 'That did not work.'))
  }
  const split = () => {
    const c = pickedClip && t > pickedClip.startS && t < clipEnd(pickedClip) ? pickedClip : clipAtPlayhead()
    if (c) run(editCut.split(docStore, data.videoId, c, t))
  }

  // Keys (not while typing, and not while a menu or a drawer has them).
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
    if ((e.target as Element | null)?.closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return
    const k = e.key
    if (k === ' ' || k === 'k' || k === 'K') { e.preventDefault(); setPlaying(k === ' ' ? !playing : false) }
    else if (k === 'l' || k === 'L') setPlaying(true)
    else if (k === 'j' || k === 'J') { setPlaying(false); setT(Math.max(0, t - 1)) }
    else if (k === 'i' || k === 'I') setMarks({ ...marks, in: t })
    else if (k === 'o' || k === 'O') setMarks({ ...marks, out: t })
    else if (k === 's' || k === 'S') split()
    else if (k === 't' || k === 'T') addText()
    else if (k === 'ArrowRight') { e.preventDefault(); setT(Math.min(plan.lengthS, t + (e.shiftKey ? 1 : FRAME))) }
    else if (k === 'ArrowLeft') { e.preventDefault(); setT(Math.max(0, t - (e.shiftKey ? 1 : FRAME))) }
    else if ((k === 'Delete' || k === 'Backspace') && picked) {
      e.preventDefault()
      if (picked.kind === 'clip' && pickedClip) run(editCut.remove(docStore, data.videoId, pickedClip, ripple && !e.shiftKey))
      if (picked.kind === 'text') run(editCut.removeText(docStore, data.videoId, picked.id))
      setPicked(null)
    }
  }
  useEffect(() => { keyRef.current = onKey })
  useEffect(() => {
    const on = (e: KeyboardEvent) => keyRef.current(e)
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])

  const fit = fitWords(plan.lengthS, data.targetS)
  const render = currentRender(doc, data.videoId)
  const where = whereWords(plan, t, nameOf)
  const takeS = (genId: string) => data.gens.find((g) => g.id === genId)?.durationS ?? 0

  return (
    <>
      <section className="rm-program" aria-label="Program">
        <div className="rm-viewerhead">
          <div className="rm-seg sm" role="radiogroup" aria-label="What plays">
            <button type="button" role="radio" aria-checked={view === 'preview'} className={view === 'preview' ? 'on' : ''} onClick={() => setView('preview')}>Preview</button>
            <button type="button" role="radio" aria-checked={view === 'rendered'} className={view === 'rendered' ? 'on' : ''} disabled={!render} onClick={() => setView('rendered')}
              title={render ? undefined : 'Render ad to see the rendered film'}>{render ? `Rendered v${render.version}` : 'Rendered'}</button>
          </div>
          <span className="pt-grow" />
          {plan.lengthS > 0 && <span className={`rm-pill ${fit.ok ? 'ok' : 'warn'}`} title={`The film is ${plan.lengthS.toFixed(1)} s; it is meant to be ${data.targetS} s`}>{fit.words}</span>}
        </div>
        {view === 'rendered' && render ? (
          <RenderedPlayer sha={render.asset} onSound={onSound} />
        ) : (
          <div className="rm-viewer">
            <Viewer label="Preview" plan={plan} t={t} onTime={setT} ratio={data.ratio} playing={playing} onPlaying={setPlaying} />
          </div>
        )}
        {view === 'preview' && (
          <div className="rm-transport">
            <button type="button" className="rm-iconbtn" aria-label="Back one frame" onClick={() => setT(Math.max(0, t - FRAME))}>
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 2v10M11.5 2.5 5 7l6.5 4.5z" fill="currentColor" stroke="currentColor" strokeWidth="1.2" /></svg>
            </button>
            <button type="button" className="rm-iconbtn dark" aria-label={playing ? 'Pause (space)' : 'Play (space)'} onClick={() => setPlaying(!playing)} disabled={!plan.clips.length && !plan.endCard}>
              {playing ? <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="3" y="2" width="3" height="10" fill="currentColor" /><rect x="8" y="2" width="3" height="10" fill="currentColor" /></svg>
                : <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 2 L12 7 L3.5 12 Z" fill="currentColor" /></svg>}
            </button>
            <button type="button" className="rm-iconbtn" aria-label="Forward one frame" onClick={() => setT(Math.min(plan.lengthS, t + FRAME))}>
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M11 2v10M2.5 2.5 9 7l-6.5 4.5z" fill="currentColor" stroke="currentColor" strokeWidth="1.2" /></svg>
            </button>
            <span className="rm-tc pt-mono">ad {tc(t)} / {tc(plan.lengthS)}</span>
            {where && <span className="rm-faint pt-mono rm-clamp1 rm-where" title={where}>{where}</span>}
            <span className="pt-grow" />
            {(marks.in !== undefined || marks.out !== undefined) && <button type="button" className="btn ghost" onClick={() => setMarks({})}>Clear marks</button>}
            <button type="button" className="btn" disabled={!v1.length} onClick={() => changePart()} title="Change the marked stretch (I and O), or the second at the playhead">Change this part…</button>
          </div>
        )}
        {error && <div role="alert" className="rm-error">{error} <button type="button" className="btn link" onClick={() => setError(null)}>OK</button></div>}
      </section>
      <aside className="rm-inspector" aria-label="Inspector">
        <Inspector data={data} cut={cut} picked={picked} t={t} onPick={setPicked}
          onChange={(c) => changeFrom(c)} onFeel={(c) => changeFrom(c, 'feel')}
          onSwap={(c, take) => setSheet({ clip: c, take })}
          handleShort={(c) => handleShort(cut, c.id, takeS)} />
      </aside>
      <div className="rm-tlwrap">
        <Timeline data={data} cut={cut} t={t} marks={marks} picked={picked} ripple={ripple} onRipple={setRipple} snap={snap} onSnap={setSnap}
          making={making} ready={ready}
          actions={{
            seek: (s) => { setPlaying(false); setT(Math.min(Math.max(0, s), Math.max(plan.lengthS, 0))) },
            pick,
            assemble: () => run(assembleFirstCut(docStore, data)),
            trimHead: (c, inS) => run(editCut.trimHead(docStore, data.videoId, c, inS, ripple)),
            trimTail: (c, outS) => {
              if (outS > takeS(c.genId) + 1e-3) setError('Not enough footage after this clip. Making it longer comes soon; for now trim it shorter or use another take.')
              run(editCut.trimTail(docStore, data.videoId, c, outS, takeS(c.genId), ripple))
            },
            move: (c, to) => run(editCut.move(docStore, data.videoId, c, to)),
            fades: (c, f) => run(editCut.fades(docStore, data.videoId, c, f)),
            transition: (c, tr) => run(editCut.transition(docStore, data.videoId, c, tr)),
            split,
            addText,
            captions,
            text: (tx, p) => run(editCut.text(docStore, data.videoId, tx.id, p)),
            drop: (genId, atS) => {
              const g = data.gens.find((x) => x.id === genId)
              if (!g) return
              run(appendTake(docStore, doc, data, g).then(() => {
                // Dropped mid-film: the new clips move to where they were dropped.
                const after = readCut(docStore.get(), data.videoId).v1
                const fresh = after.filter((c) => c.genId === genId && !v1.some((o) => o.id === c.id))
                const to = after.filter((o) => !fresh.includes(o) && o.startS + clipLen(o) / 2 < atS).length
                return fresh.reduce((p, c, i) => p.then(() => editCut.move(docStore, data.videoId, c, to + i)), Promise.resolve() as Promise<unknown>)
              }))
            },
            menu: (c, verb) => {
              if (verb === 'change') changeFrom(c)
              else if (verb === 'feel') changeFrom(c, 'feel')
              else if (verb === 'part') { pick({ kind: 'clip', id: c.id }); changePart(c) }
              else if (verb === 'remove') run(editCut.remove(docStore, data.videoId, c, ripple))
              else if (verb === 'takes') onSel({ ...sel, genId: c.genId, clipId: c.id })
            },
            ready: (c, take) => { pick({ kind: 'clip', id: c.id }); setSheet({ clip: c, take }) },
            openSound: onSound,
          }} />
      </div>
      {sheet && (
        <NewTakeSheet data={data} cut={cut} clip={sheet.clip} take={sheet.take} onClose={() => { setSheet(null); rerender((n) => n + 1) }} onError={setError} />
      )}
    </>
  )
}

function RenderedPlayer({ sha, onSound }: { sha: string; onSound: () => void }) {
  const doc = useDoc()
  const url = useAssetUrl(sha)
  return (
    <div className="rm-viewer">
      <div className="rm-viewbox"><div className="rm-canvaswrap rendered">
        {url && !isStill(doc, sha) ? <video src={url} controls playsInline className="rm-rendered" /> : url ? <img src={url} alt="The rendered ad" className="rm-rendered" /> : <div className="rm-stage-empty">The render is on its way</div>}
        <span className="rm-viewlabel rendered">Rendered</span>
      </div></div>
      <div className="rm-banner info">This render has no sound yet. <button type="button" className="btn link" onClick={onSound}>Open Sound</button> to add it.</div>
    </div>
  )
}

/** Render ad (the Edit room's main action): Jude checks the cut, then the compiled plan goes to stitch in timeline
 *  mode. Free; the render lands as the video's new render and in the Bin's Renders. */
export function RenderAd({ data }: { data: RoomData }) {
  const { relay, runner } = useServices()
  const doc = useDoc()
  const ui = useUi()
  useJobsTick()
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const [sending, send] = useSending()
  const [error, setError] = useState<string | null>(null)
  const plan = useMemo(() => compileFor(doc, data.videoId), [doc, data.videoId])
  const cut = useMemo(() => readCut(doc, data.videoId), [doc, data.videoId])
  const job = jobAt(doc, ui, (c) => c.for === 'stitch' && c.videoId === data.videoId)
  const rendering = isMoving(doc, job)
  const takeS = (genId: string) => doc.generations[genId]?.duration_s ?? 0
  const checks: { text: string; ok: boolean }[] = []
  if (plan.missing.length) checks.push({ text: `${plan.missing.length} ${plan.missing.length === 1 ? 'clip has' : 'clips have'} no footage yet and ${plan.missing.length === 1 ? 'is' : 'are'} left out`, ok: false })
  for (const c of cut.v1) {
    const short = handleShort(cut, c.id, takeS)
    const n = c.follows?.shotId ? shotNumber(doc, c.follows.shotId) : 0
    if (short > 0) checks.push({ text: `The ${c.transition?.kind === 'dissolve' ? 'dissolve' : 'dip'} into ${n ? `shot ${n}` : 'a clip'} holds a last frame for ${short.toFixed(1)} s`, ok: false })
    else if (c.transition) checks.push({ text: `The ${c.transition.kind === 'dissolve' ? 'dissolve' : 'dip'} into ${n ? `shot ${n}` : 'a clip'} has enough footage`, ok: true })
  }
  if (!cut.endCard) checks.push({ text: 'No end card of your own: the film ends on the studio card', ok: true })
  checks.push({ text: 'This render has no sound yet. Open Sound to add it.', ok: false })
  const go = () => send(async () => {
    setError(null)
    try {
      const timeline = await renderPlan(plan, (sha) => assetRef(relay, sha, doc))
      const parents = [...new Set(plan.clips.map((c) => (c.generation_id ? doc.generations[c.generation_id]?.job_id : undefined)).filter((x): x is string => !!x))]
      await runner.submit('stitch', { timeline, ratio: data.ratio as never }, parents, { for: 'stitch', videoId: data.videoId })
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  })
  const empty = !plan.clips.length
  return (
    <>
      <button ref={ref} type="button" className="btn primary rm-primary" aria-haspopup="dialog" aria-expanded={open} disabled={empty || rendering || sending}
        title={empty ? 'Assemble the cut first' : undefined} onClick={() => setOpen(!open)}>{rendering ? 'Rendering…' : sending ? 'Sending…' : 'Render ad'}</button>
      <Float anchor={ref} open={open} onClose={close} role="dialog" align="end" label="Jude checked the cut" className="rm-checks">
        <div className="rm-floathead">Jude checked the cut</div>
        <p className="rm-note">None of these stop the render. {rendersOf(doc, data.videoId).length ? `This makes render v${rendersOf(doc, data.videoId).length + 1}.` : ''}</p>
        <ul className="rm-checklist">
          {checks.map((c) => <li key={c.text} className={c.ok ? 'ok' : 'warn'}><span aria-hidden="true">{c.ok ? '✓' : '!'}</span><span className="rm-clamp2" title={c.text}>{c.text}</span></li>)}
        </ul>
        <p className="rm-faint">The film is {plan.lengthS.toFixed(1)} s, then the studio card.</p>
        {error && <div role="alert" className="rm-error">{error}</div>}
        <div className="rm-row end">
          <button type="button" className="btn" onClick={close}>Back to the cut</button>
          <button type="button" className="btn primary" disabled={sending} onClick={() => void go()}>{sending ? 'Sending…' : 'Render ad'}</button>
        </div>
      </Float>
    </>
  )
}
