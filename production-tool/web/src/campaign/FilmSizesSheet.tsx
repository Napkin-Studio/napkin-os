// Make all sizes from a Video node (features/campaign-formats.clan, phases 5 and 6; owner 2026-10-16: "video
// versions from video nodes"): the film's options (lengths × shapes), Dex's plan shown before anything
// renders (each length's beats, kept or dropped with his reason, editable; each shape's shots, cropped or
// made again), then the tray (what Edie and Wren will make: every version, and every shot × method ×
// model that spends, with no prices), then Send: the versions land on the Campaign board's Film lane.

import { useMemo, useState } from 'react'
import type { CutdownPlan, Id, ModelChoice, PersonRef, SizeBeat } from '../contracts/types'
import { useConfig, useDoc } from '../app/context'
import { modelChoicesFor } from '../capabilities'
import { AgentFigure } from '../ui/agents/AgentFigure'
import { sayer } from '../ui/agents/cast'
import { CARD_S, DEFAULT_FILM_LENGTHS, FILM_LENGTHS, FILM_SHAPES, REMAKE_MODELS, beatsFor, fitWindows, masterShots, sameShape } from './film'
import { makeFilmSizes, planFilm, type FilmRow, type ShotMethod } from './filmJobs'
import type { CampaignDeps } from './make'
import { setsOf, type MasterInfo } from './master'
import './campaign.css'

type Step = 'options' | 'planning' | 'plan' | 'tray'

export function FilmSizesSheet({ master, deps, by, near, onClose, onMade }: {
  master: MasterInfo
  deps: CampaignDeps
  by: PersonRef
  near?: import('../canvas/core/canvasAdapter').CanvasElement
  onClose(): void
  onMade(el: import('../canvas/core/canvasAdapter').CanvasElement): void
}) {
  const doc = useDoc()
  const { config } = useConfig()
  const shots = useMemo(() => masterShots(doc, master.id), [doc, master.id])
  const body = shots.filter((s) => !s.endCard)
  const masterS = Math.round(master.length_s ?? body.reduce((a, s) => a + (s.outS - s.inS), 0) + CARD_S)
  const [lengths, setLengths] = useState<number[]>(DEFAULT_FILM_LENGTHS)
  const [extra, setExtra] = useState('')
  const [shapes, setShapes] = useState<Set<string>>(new Set(['film-16x9', 'film-9x16']))
  const earlier = setsOf(doc, master).find((s) => s.copy)?.copy
  const [line, setLine] = useState(earlier?.line ?? '')
  const [legal, setLegal] = useState(earlier?.legal ?? '')
  const [step, setStep] = useState<Step>('options')
  const [plan, setPlan] = useState<CutdownPlan | null>(null)
  const [beats, setBeats] = useState<Record<number, SizeBeat[]>>({})
  const [methods, setMethods] = useState<Record<string, Record<Id, ShotMethod>>>({})
  const [off, setOff] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const aleph = useMemo(() => modelChoicesFor('cutdown', config)[0], [config])
  const remakes = useMemo(() => {
    const all = modelChoicesFor('clip', config)
    const carry = all.filter((m) => REMAKE_MODELS.includes(m.model))
    return carry.length ? carry : all
  }, [config])
  const [remake, setRemake] = useState<ModelChoice | undefined>(remakes[0] ? { provider: remakes[0].provider, model: remakes[0].model } : undefined)
  const remakeLabel = remakes.find((m) => m.model === remake?.model)?.label ?? remake?.model ?? 'off for your agency'

  const shapeList = FILM_SHAPES.filter((s) => shapes.has(s.id))
  const isMaster = (a: { w: number; h: number }) => sameShape(a, master)
  /** The versions asked for: every length at every shape, but the ad itself (its own length at its shape). */
  const rows: (FilmRow & { key: string; label: string })[] = []
  for (const l of lengths) {
    for (const s of shapeList) {
      if (isMaster(s.aspect) && Math.abs(l - masterS) < 0.5) continue
      const key = `${l}@${s.id}`
      rows.push({ key, lengthS: l, shapeId: s.id, on: !off.has(key), label: `Film ${l} s · ${s.label}` })
    }
  }
  const kept = (l: number) => new Set((beats[l] ?? []).filter((b) => b.keep).map((b) => b.shot_id))
  /** The shots a shape's ticked versions keep, which may need a reframe. */
  const shotsAt = (shapeId: string) => {
    const ids = new Set<Id>()
    for (const r of rows) if (r.on && r.shapeId === shapeId) for (const id of kept(r.lengthS)) ids.add(id)
    return body.filter((s) => ids.has(s.shotId))
  }
  const paid: { shapeId: string; shotId: Id; how: ShotMethod; key: string }[] = []
  for (const s of shapeList) {
    if (isMaster(s.aspect)) continue
    for (const shot of shotsAt(s.id)) {
      const how = methods[s.id]?.[shot.shotId] ?? 'crop'
      if (how !== 'crop') paid.push({ shapeId: s.id, shotId: shot.shotId, how, key: `${s.id}:${shot.shotId}` })
    }
  }

  const startPlan = async () => {
    setError(null)
    if (!rows.length) {
      setError('Pick a length and a shape other than the ad itself.')
      return
    }
    setStep('planning')
    try {
      const p = await planFilm(deps, master, shots, lengths, shapeList.map((s) => s.aspect))
      setPlan(p)
      setBeats(Object.fromEntries(lengths.map((l) => [l, beatsFor(p, l)])))
      const m: Record<string, Record<Id, ShotMethod>> = {}
      for (const s of shapeList) {
        if (isMaster(s.aspect)) continue
        m[s.id] = {}
        for (const c of p.crops) if (c.cuts && sameShape(c.aspect, s.aspect) && aleph) m[s.id][c.shotId] = 'outpaint'
      }
      setMethods(m)
      setStep('plan')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Dex could not plan the cuts. Try again.')
      setStep('options')
    }
  }

  const send = async () => {
    if (!plan) return
    setBusy(true)
    setError(null)
    try {
      const { el } = await makeFilmSizes(deps, { master, shots, plan, beats, rows, methods, ...(remake ? { remake } : {}), copy: { line, legal }, near }, by)
      onMade(el)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const toggleBeat = (l: number, id: Id) => setBeats((b) => ({ ...b, [l]: (b[l] ?? []).map((x) => (x.shot_id === id ? { ...x, keep: !x.keep, by: 'person' as const } : x)) }))
  const setMethod = (shapeId: string, id: Id, how: ShotMethod) => setMethods((m) => ({ ...m, [shapeId]: { ...m[shapeId], [id]: how } }))
  const methodWords = (how: ShotMethod) => (how === 'outpaint' ? `New edges · ${aleph?.label ?? 'Aleph 2'}` : how === 'remake' ? `Remake · ${remakeLabel}` : 'Crop · free')
  const rowWords = (r: FilmRow) => {
    const shape = FILM_SHAPES.find((s) => s.id === r.shapeId)!
    if (isMaster(shape.aspect)) return 'Re-edit · free'
    const ids = kept(r.lengthS)
    const made = paid.filter((p) => p.shapeId === r.shapeId && ids.has(p.shotId))
    const edges = made.filter((p) => p.how === 'outpaint').length
    const remade = made.filter((p) => p.how === 'remake').length
    return ['Reframe · crop', edges ? `${edges} ${edges === 1 ? 'shot' : 'shots'} new edges` : '', remade ? `${remade} remade` : ''].filter(Boolean).join(', ')
  }

  return (
    <div className="cf-scrim" role="presentation" onPointerDown={(e) => { if (e.target === e.currentTarget && step !== 'planning') onClose() }}>
      <section className="cf-sheet pt-panel" role="dialog" aria-modal="true" aria-label="Make all sizes" data-film-sheet>
        <header className="cf-sheethead">
          <b>Make all sizes</b>
          <span className="cf-from">from {master.label} · {masterS} s</span>
          <span className="pt-grow" />
          <button type="button" className="btn sm ghost" onClick={onClose}>Cancel</button>
        </header>

        {step === 'options' && (
          <div className="cf-body">
            <div className="cf-label">Lengths</div>
            <div className="cf-chips" aria-label="Lengths">
              {[...new Set([...FILM_LENGTHS, ...lengths])].filter((s) => s <= Math.max(masterS, 30)).sort((a, b) => b - a).map((s) => (
                <button key={s} type="button" aria-pressed={lengths.includes(s)} className={`cf-chip ${lengths.includes(s) ? 'on' : ''}`}
                  onClick={() => setLengths(lengths.includes(s) ? lengths.filter((x) => x !== s) : [...lengths, s].sort((a, b) => b - a))}>{s} s{s === masterS ? ' (the ad)' : ''}</button>
              ))}
              <input className="cf-len" inputMode="numeric" placeholder="+ length" value={extra} aria-label="Another length in seconds"
                onChange={(e) => setExtra(e.target.value.replace(/\D/g, '').slice(0, 3))}
                onKeyDown={(e) => {
                  const n = Number(extra)
                  if (e.key === 'Enter' && n >= 3 && n <= 600) {
                    setLengths([...new Set([...lengths, n])].sort((a, b) => b - a))
                    setExtra('')
                  }
                }} />
            </div>
            <div className="cf-label">Shapes</div>
            <div className="cf-chips" aria-label="Shapes">
              {FILM_SHAPES.map((s) => (
                <button key={s.id} type="button" aria-pressed={shapes.has(s.id)} className={`cf-chip ${shapes.has(s.id) ? 'on' : ''}`}
                  onClick={() => setShapes((x) => { const n = new Set(x); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n })}>{s.label}{isMaster(s.aspect) ? ' (the ad\'s)' : ''}</button>
              ))}
            </div>
            <div className="cf-label">Words on every version</div>
            <div className="cf-words">
              <input className="cf-input" value={line} maxLength={200} placeholder="The brand line (optional)" aria-label="The brand line" onChange={(e) => setLine(e.target.value)} />
              <input className="cf-input" value={legal} maxLength={600} placeholder="Legal (optional)" aria-label="Legal" onChange={(e) => setLegal(e.target.value)} />
            </div>
            <p className="cf-note">{rows.length} versions from the ad's own {body.length} shots. Dex plans which shots each length keeps and how each shot fits each shape, before anything is made. On 9:16, 4:5 and 1:1 the spoken lines are captioned for sound off; turn them off on any tile.</p>
            {error && <p className="cf-error" role="alert">{error}</p>}
            <footer className="cf-foot"><span className="pt-grow" /><button type="button" className="btn primary" disabled={!rows.length || !body.length} onClick={() => void startPlan()}>Plan the cuts</button></footer>
          </div>
        )}

        {step === 'planning' && (
          <div className="cf-body" role="status" aria-busy="true">
            <div className="cf-trayhead">
              <AgentFigure agent="dex" size={28} state="working" decorative />
              <span><b>{sayer('dex')}</b>: I'm looking at each shot and planning the cuts…</span>
            </div>
          </div>
        )}

        {step === 'plan' && plan && (
          <div className="cf-body" data-film-plan>
            <div className="cf-trayhead">
              <AgentFigure agent="dex" size={24} decorative />
              <span><b>{sayer('dex')}</b>: how I would cut it. Keep or drop any beat; nothing is made yet.</span>
            </div>
            <div className="cf-tray">
              {lengths.filter((l) => rows.some((r) => r.lengthS === l)).map((l) => {
                const { windows, over } = fitWindows(body, kept(l), l)
                const reasons = new Map((plan.lengths.find((x) => Math.abs(x.lengthS - l) < 0.5)?.beats ?? []).map((b) => [b.shotId, b.why]))
                const why = plan.lengths.find((x) => Math.abs(x.lengthS - l) < 0.5)?.why
                return (
                  <div key={l} className="cf-lane" role="group" aria-label={`The ${l} s cut`}>
                    <div className="cf-lanehead">{l} s · keeps {windows.length} of {body.length} shots{over > 0.05 ? ` · over by ${over.toFixed(1)} s: drop a beat` : ''}</div>
                    {why && <p className="cf-note">{why}</p>}
                    {body.map((s) => {
                      const w = windows.find((x) => x.shotId === s.shotId)
                      const on = kept(l).has(s.shotId)
                      return (
                        <label key={s.shotId} className="cf-row" role="listitem" data-beat={s.shotId}>
                          <input type="checkbox" checked={on} aria-label={`Keep shot ${s.number} in the ${l} s cut`} onChange={() => toggleBeat(l, s.shotId)} />
                          <span className="cf-name">Shot {s.number}</span>
                          <span className="cf-size">{w ? `${(w.outS - w.inS).toFixed(1)} s` : '—'}</span>
                          <span className="cf-note" style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.words ?? ''}</span>
                          <span className={`cf-method ${on ? '' : 'waits'}`} title={reasons.get(s.shotId)}>{reasons.get(s.shotId) ?? (on ? 'Kept' : 'Dropped')}</span>
                        </label>
                      )
                    })}
                  </div>
                )
              })}
              {shapeList.filter((s) => !isMaster(s.aspect)).map((s) => (
                <div key={s.id} className="cf-lane" role="group" aria-label={`Each shot at ${s.label}`}>
                  <div className="cf-lanehead">{s.label} · each shot</div>
                  {shotsAt(s.id).map((shot) => {
                    const c = plan.crops.find((x) => x.shotId === shot.shotId && sameShape(x.aspect, s.aspect))
                    const how = methods[s.id]?.[shot.shotId] ?? 'crop'
                    return (
                      <div key={shot.shotId} className="cf-row" role="listitem" data-reframe={`${s.id}:${shot.shotId}`}>
                        <span className="cf-name">Shot {shot.number}</span>
                        <span className="cf-note" style={{ flex: 1 }}>{c?.why ?? ''}</span>
                        <select aria-label={`How shot ${shot.number} is made at ${s.label}`} value={how} onChange={(e) => setMethod(s.id, shot.shotId, e.target.value as ShotMethod)}>
                          <option value="crop">Crop · free</option>
                          <option value="outpaint" disabled={!aleph}>New edges · {aleph?.label ?? 'off for your agency'}</option>
                          <option value="remake" disabled={!remake}>Remake for {s.label} · {remakeLabel}</option>
                        </select>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
            {error && <p className="cf-error" role="alert">{error}</p>}
            <footer className="cf-foot">
              <button type="button" className="btn ghost" onClick={() => setStep('options')}>Back</button>
              <span className="pt-grow" />
              <button type="button" className="btn primary" onClick={() => setStep('tray')}>Next</button>
            </footer>
          </div>
        )}

        {step === 'tray' && plan && (
          <div className="cf-body">
            <div className="cf-trayhead">
              <AgentFigure agent="edie" size={24} decorative />
              <span><b>{sayer('edie')}</b>: what I will make</span>
            </div>
            <div className="cf-tray" role="list" aria-label="What Edie will make">
              <div className="cf-lane" role="group" aria-label="Film and online video">
                <div className="cf-lanehead">Film and online video</div>
                {rows.map((r) => (
                  <label key={r.key} className="cf-row" role="listitem">
                    <input type="checkbox" checked={r.on} onChange={() => setOff((s) => { const n = new Set(s); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n })} />
                    <span className="cf-name">{r.label}</span>
                    <span className="cf-size">{FILM_SHAPES.find((s) => s.id === r.shapeId)!.label}</span>
                    <span className="cf-dots" />
                    <span className="cf-method">{rowWords(r)}</span>
                  </label>
                ))}
              </div>
              {paid.length > 0 && (
                <div className="cf-lane" role="group" aria-label="Shots made again">
                  <div className="cf-lanehead">Shots made again · each its own job</div>
                  {remakes.length > 1 && paid.some((p) => p.how === 'remake') && (
                    <label className="cf-row">
                      <span className="cf-name">Remake on</span>
                      <select aria-label="Remake model" value={remake?.model} onChange={(e) => { const m = remakes.find((x) => x.model === e.target.value); if (m) setRemake({ provider: m.provider, model: m.model }) }}>
                        {remakes.map((m) => <option key={`${m.provider}:${m.model}`} value={m.model}>{m.label}</option>)}
                      </select>
                    </label>
                  )}
                  {paid.map((p) => {
                    const shot = body.find((s) => s.shotId === p.shotId)!
                    const shape = FILM_SHAPES.find((s) => s.id === p.shapeId)!
                    return (
                      <label key={p.key} className="cf-row" role="listitem" data-paid={p.key}>
                        <input type="checkbox" checked aria-label={`${methodWords(p.how)} for shot ${shot.number} at ${shape.label}`} onChange={() => setMethod(p.shapeId, p.shotId, 'crop')} />
                        <span className="cf-name">Shot {shot.number} · {shape.label}</span>
                        <span className="cf-dots" />
                        <span className="cf-method">{methodWords(p.how)}</span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
            {error && <p className="cf-error" role="alert">{error}</p>}
            <footer className="cf-foot">
              <span className="cf-note">{rows.filter((r) => r.on).length} versions, cut from the same takes (free){paid.length ? `; ${paid.length} ${paid.length === 1 ? 'shot' : 'shots'} on a model (cost in History)` : ''}. They land on the Campaign board's Film lane.</span>
              <span className="pt-grow" />
              <button type="button" className="btn ghost" onClick={() => setStep('plan')}>Back</button>
              <button type="button" className="btn primary" disabled={busy || !rows.some((r) => r.on)} onClick={() => void send()}>
                {busy ? 'Starting…' : `Make ${rows.filter((r) => r.on).length} versions`}
              </button>
            </footer>
          </div>
        )}
      </section>
    </div>
  )
}
