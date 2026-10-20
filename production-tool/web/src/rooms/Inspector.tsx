// The Edit room's Inspector (board Edit room, right): for a clip its take with Change this… and Swap take, in and
// out, speed, fades and the join into it; for a text its words, style and timing; for the end card its words,
// colour and length. Nothing picked: the cut in numbers and the keys. Every field writes one undo step.

import { useState } from 'react'
import { useDoc, useServices } from '../app/context'
import { shotNumber } from '../model/selectors'
import { clipLen, MAX_SPEED, MIN_SPEED, type Cut, type CutClip, type TextStyle } from './cut'
import { editCut } from './editOps'
import { genTitle, shotTitle, type Gen } from './model'
import { tc } from './media'
import type { RoomData } from './Rooms'
import type { Picked } from './Timeline'

const STYLES: { id: TextStyle; label: string }[] = [{ id: 'super', label: 'Lower third' }, { id: 'title', label: 'Centre title' }, { id: 'caption', label: 'Caption' }]
const r1 = (x: number) => Math.round(x * 10) / 10

/** A number field with − and + (44px each): its value in seconds, committed on blur or Enter. */
function Seconds({ label, value, step = 0.1, min = 0, max = 600, onSet, suffix = 's' }: { label: string; value: number; step?: number; min?: number; max?: number; onSet: (v: number) => void; suffix?: string }) {
  const shown = value.toFixed(suffix === '×' ? 2 : 1)
  const [text, setText] = useState(shown)
  const [was, setWas] = useState(shown)
  if (was !== shown) {
    setWas(shown)
    setText(shown)
  }
  const commit = (v: number) => { const c = Math.min(max, Math.max(min, Math.round(v * 100) / 100)); if (Math.abs(c - value) > 1e-6) onSet(c) }
  return (
    <div className="rm-num">
      <span className="rm-rowname">{label}</span>
      <button type="button" className="rm-iconbtn" aria-label={`${label}: less`} onClick={() => commit(value - step)}>−</button>
      <input className="pt-mono" inputMode="decimal" aria-label={label} value={text} onChange={(e) => setText(e.target.value)}
        onBlur={() => { const v = Number(text); if (Number.isFinite(v)) commit(v); else setText(value.toFixed(1)) }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
      <span className="rm-faint">{suffix}</span>
      <button type="button" className="rm-iconbtn" aria-label={`${label}: more`} onClick={() => commit(value + step)}>+</button>
    </div>
  )
}

export function Inspector({ data, cut, picked, t, onPick, onChange, onFeel, onSwap, handleShort }: {
  data: RoomData
  cut: Cut
  picked: Picked
  t: number
  onPick: (p: Picked) => void
  onChange: (c: CutClip) => void
  onFeel: (c: CutClip) => void
  onSwap: (c: CutClip, take: Gen) => void
  handleShort: (c: CutClip) => number
}) {
  const { doc: docStore } = useServices()
  const doc = useDoc()
  const v = data.videoId
  if (picked?.kind === 'clip') {
    const c = cut.v1.find((x) => x.id === picked.id)
    if (!c) return <Empty data={data} cut={cut} t={t} />
    const g = data.gens.find((x) => x.id === c.genId)
    const n = c.follows?.shotId ? shotNumber(doc, c.follows.shotId) : 0
    const others = g ? data.gens.filter((x) => x.boxKey === g.boxKey && x.state === 'ready' && x.id !== g.id) : []
    const src = g ? `${genTitle(g, data.boxes)}${n ? ` · shot ${n}` : ''}` : 'A take'
    const short = handleShort(c)
    return (
      <div className="rm-tab">
        <div className="rm-tabhead">
          <span className="rm-kicker pt-mono">Clip · V1</span>
          <b className="rm-clamp2" title={n ? shotTitle(doc.shots[c.follows!.shotId!], n) : src}>{n ? `Shot ${n} · ${shotTitle(doc.shots[c.follows!.shotId!], n)}` : src}</b>
          <span className="rm-faint rm-clamp2" title={src}>Source: {src}{g ? ` · ${g.label}` : ''}</span>
        </div>
        <div className="rm-row wrap">
          <button type="button" className="btn primary" onClick={() => onChange(c)}>Change this…</button>
          <SwapTake others={others} onPick={(take) => onSwap(c, take)} />
          <button type="button" className="btn" onClick={() => onFeel(c)}>Change the feel…</button>
        </div>
        <fieldset className="rm-field">
          <legend className="rm-label">Window</legend>
          <Seconds label="In" value={c.inS} max={c.outS - 0.2} onSet={(x) => void editCut.trimHead(docStore, v, c, x, true)} />
          <Seconds label="Out" value={c.outS} min={c.inS + 0.2} max={g?.durationS ?? 600} onSet={(x) => void editCut.trimTail(docStore, v, c, x, g?.durationS ?? x, true)} />
          <p className="rm-faint">Plays {tc(c.inS)}-{tc(c.outS)} of the take · {clipLen(c).toFixed(1)} s in the cut{c.holdS ? ` · holds its last frame ${c.holdS.toFixed(1)} s` : ''}</p>
          <Seconds label="Speed" value={c.speed} step={0.05} min={MIN_SPEED} max={MAX_SPEED} suffix="×" onSet={(x) => void editCut.speed(docStore, v, c, x)} />
        </fieldset>
        <fieldset className="rm-field">
          <legend className="rm-label">Fades</legend>
          <Seconds label="Fade in" value={c.fadeInS} max={clipLen(c)} onSet={(x) => void editCut.fades(docStore, v, c, { inS: x })} />
          <Seconds label="Fade out" value={c.fadeOutS} max={clipLen(c)} onSet={(x) => void editCut.fades(docStore, v, c, { outS: x })} />
        </fieldset>
        {cut.v1.indexOf(c) !== 0 && cut.v1[0]?.id !== c.id && (
          <fieldset className="rm-field">
            <legend className="rm-label">Join into this clip</legend>
            <div className="rm-seg" role="radiogroup" aria-label="Join into this clip">
              <button type="button" role="radio" aria-checked={!c.transition} className={!c.transition ? 'on' : ''} onClick={() => void editCut.transition(docStore, v, c, undefined)}>Cut</button>
              <button type="button" role="radio" aria-checked={c.transition?.kind === 'dissolve'} className={c.transition?.kind === 'dissolve' ? 'on' : ''} onClick={() => void editCut.transition(docStore, v, c, { kind: 'dissolve', s: c.transition?.s ?? 0.5 })}>Dissolve</button>
              <button type="button" role="radio" aria-checked={c.transition?.kind === 'dip_black'} className={c.transition?.kind === 'dip_black' ? 'on' : ''} onClick={() => void editCut.transition(docStore, v, c, { kind: 'dip_black', s: c.transition?.s ?? 0.5 })}>Dip to black</button>
            </div>
            {c.transition && <Seconds label="Length" value={c.transition.s} min={0.1} max={Math.min(2, clipLen(c))} onSet={(x) => void editCut.transition(docStore, v, c, { ...c.transition!, s: x })} />}
            {c.transition && short > 0 && <p className="rm-note">The clip before runs out of footage: its last frame holds for {short.toFixed(1)} s.</p>}
          </fieldset>
        )}
        <button type="button" className="btn ghost rm-wide" onClick={() => { void editCut.remove(docStore, v, c, true); onPick(null) }}>Remove from the cut</button>
      </div>
    )
  }
  if (picked?.kind === 'text') {
    const tx = cut.text.find((x) => x.id === picked.id)
    if (!tx) return <Empty data={data} cut={cut} t={t} />
    return (
      <div className="rm-tab">
        <div className="rm-tabhead"><span className="rm-kicker pt-mono">Text</span><b className="rm-clamp2" title={tx.words}>{tx.words || 'Text'}</b></div>
        <TextWords key={tx.id} words={tx.words} onSet={(w) => void editCut.text(docStore, v, tx.id, { words: w })} />
        <fieldset className="rm-field">
          <legend className="rm-label">Style</legend>
          <div className="rm-seg" role="radiogroup" aria-label="Style">
            {STYLES.map((s) => <button key={s.id} type="button" role="radio" aria-checked={tx.style === s.id} className={tx.style === s.id ? 'on' : ''} onClick={() => void editCut.text(docStore, v, tx.id, { style: s.id })}>{s.label}</button>)}
          </div>
        </fieldset>
        <fieldset className="rm-field">
          <legend className="rm-label">Timing</legend>
          <Seconds label="From" value={tx.startS} onSet={(x) => void editCut.text(docStore, v, tx.id, { startS: x })} />
          <Seconds label="To" value={r1(tx.startS + tx.durS)} min={tx.startS + 0.3} onSet={(x) => void editCut.text(docStore, v, tx.id, { durS: x - tx.startS })} />
          <Seconds label="Fade in" value={tx.fadeInS} max={tx.durS / 2} onSet={(x) => void editCut.text(docStore, v, tx.id, { fadeInS: x })} />
          <Seconds label="Fade out" value={tx.fadeOutS} max={tx.durS / 2} onSet={(x) => void editCut.text(docStore, v, tx.id, { fadeOutS: x })} />
        </fieldset>
        <button type="button" className="btn ghost rm-wide" onClick={() => { void editCut.removeText(docStore, v, tx.id); onPick(null) }}>Remove this text</button>
      </div>
    )
  }
  if (picked?.kind === 'card') {
    const e = cut.endCard
    if (!e) return <Empty data={data} cut={cut} t={t} />
    return (
      <div className="rm-tab">
        <div className="rm-tabhead"><span className="rm-kicker pt-mono">End card · locked last</span><b className="rm-clamp2" title={e.headline || e.line}>{e.headline || e.line}</b></div>
        <CardField label="Headline" value={e.headline} max={120} onSet={(x) => void editCut.endCard(docStore, v, { headline: x })} />
        <CardField label="Line" value={e.line} max={200} onSet={(x) => void editCut.endCard(docStore, v, { line: x || e.headline || 'Your brand' })} />
        <CardField label="Call to action" value={e.cta ?? ''} max={80} onSet={(x) => void editCut.endCard(docStore, v, { cta: x })} />
        <label className="rm-num"><span className="rm-rowname">Colour</span>
          <input type="color" className="rm-colour" value={e.bg} aria-label="Card colour" onChange={(ev) => void editCut.endCard(docStore, v, { bg: ev.target.value.toUpperCase() })} />
          <span className="pt-mono rm-faint">{e.bg}</span>
        </label>
        <Seconds label="Length" value={e.durS} min={0.5} max={10} onSet={(x) => void editCut.endCard(docStore, v, { durS: x })} />
        <p className="rm-note">The logo comes from the Brand board when it has one. The studio's own card follows yours.</p>
        <button type="button" className="btn ghost rm-wide" onClick={() => { void editCut.removeEndCard(docStore, v); onPick(null) }}>Remove the end card</button>
      </div>
    )
  }
  return <Empty data={data} cut={cut} t={t} />
}

function Empty({ data, cut, t }: { data: RoomData; cut: Cut; t: number }) {
  const { doc: docStore } = useServices()
  return (
    <div className="rm-tab">
      <div className="rm-tabhead"><span className="rm-kicker pt-mono">The cut</span><b>{cut.v1.length} {cut.v1.length === 1 ? 'clip' : 'clips'} · {cut.text.length} text</b></div>
      <p className="rm-note">Pick a clip, a text or the end card to change it. The playhead is at {tc(t)}.</p>
      {!cut.endCard && cut.v1.length > 0 && <button type="button" className="btn rm-wide" onClick={() => void editCut.endCard(docStore, data.videoId, {})}>Add an end card</button>}
      <dl className="rm-keys">
        <dt><kbd>Space</kbd></dt><dd>Play or pause</dd>
        <dt><kbd>J</kbd> <kbd>K</kbd> <kbd>L</kbd></dt><dd>Back a second, stop, play</dd>
        <dt><kbd>I</kbd> <kbd>O</kbd></dt><dd>Mark a stretch to change</dd>
        <dt><kbd>S</kbd></dt><dd>Split at the playhead</dd>
        <dt><kbd>T</kbd></dt><dd>Add text</dd>
        <dt><kbd>Delete</kbd></dt><dd>Remove and close the gap (Shift leaves it)</dd>
        <dt><kbd>Ctrl</kbd> <kbd>Z</kbd></dt><dd>Undo</dd>
      </dl>
      <p className="rm-faint">Editing never spends anything.</p>
    </div>
  )
}

function TextWords({ words, onSet }: { words: string; onSet: (w: string) => void }) {
  const [v, setV] = useState(words)
  return (
    <label className="rm-fieldlabel">Words
      <textarea className="rm-textarea" rows={2} maxLength={300} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => { if (v.trim() && v !== words) onSet(v.trim()) }} />
    </label>
  )
}

function CardField({ label, value, max, onSet }: { label: string; value: string; max: number; onSet: (v: string) => void }) {
  const [v, setV] = useState(value)
  const [was, setWas] = useState(value)
  if (was !== value) {
    setWas(value)
    setV(value)
  }
  return (
    <label className="rm-fieldlabel">{label}
      <input className="rm-input" maxLength={max} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => { if (v !== value) onSet(v.trim()) }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
    </label>
  )
}

function SwapTake({ others, onPick }: { others: Gen[]; onPick: (g: Gen) => void }) {
  const [open, setOpen] = useState(false)
  if (!others.length) return <button type="button" className="btn" disabled title="This box has no other take yet">Swap take</button>
  return (
    <span className="rm-swap">
      <button type="button" className="btn" aria-expanded={open} onClick={() => setOpen(!open)}>Swap take</button>
      {open && (
        <span className="rm-swaplist" role="menu">
          {others.map((g) => <button key={g.id} type="button" role="menuitem" className="rm-swapitem" onClick={() => { setOpen(false); onPick(g) }}><b>v{g.version}</b> <span className="rm-clamp1">{g.label}</span></button>)}
        </span>
      )}
    </span>
  )
}
