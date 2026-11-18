// The Start card on an empty canvas (features/production-new-ui.clan; mock production-new-ui-v2 "canvas-empty").
// No New film screen: a blank project opens on the canvas with this one card on it. Start from a brief
// (link a Brief Maker brief, spin a film off one, or no brief), the film in a line or a pasted script, its
// length and shape, then "Write the script" lays the Script and Storyboard out (stages/startFilm.ts) and
// the Script agent drafts from the words. Add pictures opens Assets; drawing or dropping anything on the
// canvas takes the card away (stages/startCard.ts showStartCard).

import { useEffect, useRef, useState } from 'react'
import { useConfig, useServices } from '../app/context'
import type { Ratio } from '../contracts/types'
import { cardOf, type NodeEnv } from '../canvas/nodes/nodes'
import { briefOfElement } from '../brief/canvas'
import { scriptFromBrief, scriptFromLine } from '../jobs/prompt'
import { briefChoices, offersStartFromBrief } from '../brief/start'
import { osBriefSource, type BriefSource, type OsBriefItem } from '../brief/os'
import { useProjectName } from '../ui/useDownload'
import { Float } from '../ui/Float'
import { START_LENGTHS, START_SHAPES, startFilm } from './startFilm'
import './filmStart.css'

const OS = osBriefSource()
/** Dev only: a stand-in for Napkin's briefs (window.__briefSource), for the paired screenshots on a local stack. */
const devSource = (): BriefSource | null => (import.meta.env.DEV ? (globalThis as unknown as { __briefSource?: BriefSource }).__briefSource ?? null : null)
type Mode = 'link' | 'spinoff' | 'none'
const message = (e: unknown) => (e instanceof Error ? e.message : 'That did not work. Try again.')

export function StartCard({ env, onPictures, src = devSource() ?? OS }: {
  /** Our own engine's canvas and store; null on the Excalidraw fallback (it cannot lay nodes out). */
  env: NodeEnv | null
  /** Add pictures: the Assets library. */
  onPictures: () => void
  src?: BriefSource
}) {
  const services = useServices()
  const { config } = useConfig()
  const name = useProjectName()
  const [offers, setOffers] = useState(false)
  const [briefs, setBriefs] = useState<{ items: OsBriefItem[]; empty?: string } | null>(null)
  const [mode, setMode] = useState<Mode>('link')
  const [picked, setPicked] = useState<OsBriefItem | null>(null)
  const [picking, setPicking] = useState(false)
  const [line, setLine] = useState('')
  const [seconds, setSeconds] = useState<number>(10)
  const [other, setOther] = useState(false)
  const [ratio, setRatio] = useState<Ratio>('16:9')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pasting, setPasting] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  const change = useRef<HTMLButtonElement>(null)

  // "Start from a brief" only where the flag is on and this page can read Napkin's briefs (brief/start.ts).
  useEffect(() => {
    let live = true
    void offersStartFromBrief(config.flags, src).then(async (yes) => {
      if (!live || !yes) return
      setOffers(true)
      const got = await briefChoices(src)
      if (!live) return
      setBriefs(got)
      setPicked(got.items[0] ?? null)
      if (!got.items.length) setMode('none')
    })
    return () => { live = false }
  }, [config.flags, src])

  const withBrief = offers && mode !== 'none' && !!picked
  const write = async () => {
    setBusy(true)
    setError(null)
    try {
      const out = await startFilm(env, src, { seconds, ratio, ...(withBrief ? { brief: { documentId: picked!.documentId, how: mode as 'link' | 'spinoff' } } : {}) })
      const words = line.trim()
      // The draft fills in place on the Script node (owner 2026-11-18): Keep or Discard there; the Script editor
      // opens only when the person opens it.
      if (words && services.clan) await scriptFromLine(services, services.clan, out.scriptId, words)
      // A brief and no line: the Script agent drafts from the brief (mock canvas-filling, flow 10).
      else if (out.briefId && services.clan) await scriptFromBrief(services, services.clan, out.scriptId, picked?.title ?? '')
      // The film laid out in view, nothing selected: the person watches the nodes fill (mock canvas-filling).
      if (env) {
        const ids = new Set([out.scriptId, out.storyboardId, out.briefId].filter(Boolean))
        const els = env.canvas.elements().filter((e) => !e.isDeleted && ids.has(cardOf(e)?.id ?? briefOfElement(e) ?? ''))
        env.canvas.select([])
        if (els.length) env.canvas.fit(els, { zoomFactor: 0.8, animate: false })
      }
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  const guard = { onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation(), onPointerDown: (e: React.PointerEvent) => e.stopPropagation() }
  return (
    <div className="startcard-wrap">
      <section className="startcard" role="region" aria-label="Start" {...guard}>
        <div className="lbl sc-eyebrow">Start {name ?? 'the film'}</div>
        <h2>What should this film be?</h2>
        {offers && (
          <>
            <div className="lbl">Start from a brief</div>
            <div className="seg-row sm" role="radiogroup" aria-label="Start from a brief">
              {([['link', 'Link a Brief Maker brief'], ['spinoff', 'Spin off from a brief'], ['none', 'No brief']] as const).map(([m, t]) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} aria-pressed={mode === m}
                  disabled={m !== 'none' && !briefs?.items.length} onClick={() => setMode(m)}>{t}</button>
              ))}
            </div>
            {mode === 'none' || !picked
              ? <p className="hint">{briefs?.empty ?? 'No Brief node; you can link one later from Assets › From Napkin.'}</p>
              : (
                <div className="src-card">
                  <span className="tab">BRIEF</span>
                  <span className="t"><b>{picked.title}</b><small>Brief Maker · {mode === 'spinoff' ? 'a new film spun off from it, linked back' : 'linked, frozen as it is now'}</small></span>
                  <button ref={change} type="button" className="sp-btn" aria-haspopup="menu" aria-expanded={picking} onClick={() => setPicking(!picking)}>Change…</button>
                  <Float anchor={change} open={picking} onClose={() => setPicking(false)} align="end" label="Pick a brief" className="pt-menu sc-briefs">
                    {(briefs?.items ?? []).map((b) => (
                      <button key={b.documentId} type="button" role="menuitem" className="pt-menurow" aria-current={b.documentId === picked.documentId || undefined}
                        onClick={() => { setPicked(b); setPicking(false) }}>{b.title}{b.client && <span className="hint">{b.client.name}</span>}</button>
                    ))}
                  </Float>
                </div>
              )}
          </>
        )}
        <textarea ref={box} className="prompt-ta" aria-label="The film in a line, or a script" value={line} onChange={(e) => setLine(e.target.value)}
          placeholder={pasting ? 'Paste the script, or drop a Fountain file’s text: it stays as written.' : 'The film in a line or two: who, where, what happens. Type @ to use a character or a place.'} />
        <div className="opt-row"><span className="lbl">Length</span>
          <div className="pill-set" role="radiogroup" aria-label="Length">
            {START_LENGTHS.map((s) => <button key={s} type="button" role="radio" aria-checked={!other && seconds === s} aria-pressed={!other && seconds === s} onClick={() => { setOther(false); setSeconds(s) }}>{s} s</button>)}
            {other
              ? <label className="sc-other"><input type="number" min={1} max={600} value={seconds} aria-label="Length in seconds" onChange={(e) => setSeconds(Math.max(1, Math.min(600, Math.round(Number(e.target.value) || 1))))} /> s</label>
              : <button type="button" onClick={() => setOther(true)}>Other…</button>}
          </div>
        </div>
        <div className="opt-row"><span className="lbl">Shape</span>
          <div className="pill-set" role="radiogroup" aria-label="Shape">
            {START_SHAPES.map((r) => <button key={r} type="button" role="radio" aria-checked={ratio === r} aria-pressed={ratio === r} onClick={() => setRatio(r)}>{r}</button>)}
          </div>
        </div>
        <div className="prompt-foot">
          <button type="button" className="sp-btn" onClick={onPictures}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M21 16l-5-5-8 8" /></svg>
            Add pictures</button>
          <button type="button" className={`sp-btn ${pasting ? 'on' : ''}`} aria-pressed={pasting} onClick={() => { setPasting(true); box.current?.focus() }}>Paste a script</button>
          <span className="pt-grow" />
          <button type="button" className="btn-rect primary" disabled={busy || !env} title={env ? undefined : 'Open this project on the new canvas to lay a film out'} onClick={() => void write()}>
            {busy ? 'Starting…' : 'Write the script'}</button>
        </div>
        {error && <p className="sc-error" role="alert">{error}</p>}
        <p className="hint">{withBrief ? 'The brief comes from Brief Maker and stays read-only here. ' : ''}Or draw, drop pictures and add nodes yourself; this card goes when you do.</p>
      </section>
    </div>
  )
}
