// Make all sizes from a Film node (features/campaign-formats.clan, phases 5 and 6; owner 2026-10-16: "video
// versions from video nodes"): the film's options (lengths × shapes), Dex's plan shown before anything
// renders (each length's beats, kept or dropped with his reason, editable; each shape's shots, cropped or
// made again), then the tray (what Edie and Wren will make: every version, and every shot × method ×
// model that spends, with no prices), then Send: the versions land on the Campaign board's Film lane.

import { useMemo, useState } from 'react'
import type { Id, ModelChoice, PersonRef, SizeBeat } from '../contracts/types'
import { useConfig, useDoc } from '../app/context'
import { modelChoicesFor } from '../capabilities'
import { AgentFigure } from '../ui/agents/AgentFigure'
import { sayer } from '../ui/agents/cast'
import { pickWords } from './sizeWords'
import { FILM_LENGTHS, cutsBlocked, startLengths, FILM_SHAPES, REMAKE_MODELS, beatsFor, briefShapes, filmSeconds, fitWindows, lastLineOf, masterShots, sameShape, versionsWord } from './film'
import { endLineOf, sizesBrief } from '../brief/model'
import { makeFilmSizes, planFilm, type FilmPlan, type FilmRow, type ShotMethod } from './filmJobs'
import type { CampaignDeps } from './make'
import { setsOf, type MasterInfo } from './master'
import { readCut } from '../rooms/timeline'
import { cutLength } from '../rooms/cut'
import './campaign.css'

type Step = 'options' | 'planning' | 'plan' | 'tray'

/** Seconds as a person reads them: 12.7, 15. */
const secs = (s: number) => String(Math.round(s * 10) / 10)

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
  // The film's own length: its cut's (clips and its end card) when it has one (UAT 2026-11-21: "Film · 10.5 s" for a
  // 12.5 s cut), else its shots as cut.
  const filmS = useMemo(() => {
    const videoId = master.kind === 'render' ? doc.renders?.[master.id]?.video_id : master.kind === 'video' ? master.id : undefined
    const cut = videoId ? readCut(doc, videoId) : undefined
    return cut?.v1.length ? cutLength(cut) : filmSeconds(shots, master.length_s)
  }, [doc, master, shots])
  const masterS = Math.round(filmS)
  // Only lengths shorter than the film start picked (Playwright live test 2026-11-18: 15 s picked for an 8 s film); a film
  // with none shorter starts on its own length, in the other shapes (A57).
  const [lengths, setLengths] = useState<number[]>(() => startLengths(masterS))
  const [extra, setExtra] = useState('')
  const [shapes, setShapes] = useState<Set<string>>(() => {
    const videoId = master.kind === 'render' ? doc.renders?.[master.id]?.video_id : master.kind === 'video' ? master.id : undefined
    return new Set(briefShapes(videoId ? sizesBrief(doc, videoId)?.spine : undefined))
  })
  const earlier = setsOf(doc, master).find((s) => s.copy)?.copy
  // The line on every version: the end line of the brief that drives the sizes (the newest set's linked brief,
  // else the film's own), else what the last set carried, else the film's last spoken line (re-test N2: the
  // main brief's "Lumo. Calm, on." came back from the last set while the linked brief ends on "Lumo. Dein Licht.").
  const [line, setLine] = useState(() => {
    const videoId = master.kind === 'render' ? doc.renders?.[master.id]?.video_id : master.kind === 'video' ? master.id : undefined
    return (videoId ? endLineOf(sizesBrief(doc, videoId)?.spine) : undefined) ?? earlier?.line ?? lastLineOf(doc, shots) ?? ''
  })
  const [legal, setLegal] = useState(earlier?.legal ?? '')
  const [step, setStep] = useState<Step>('options')
  const [plan, setPlan] = useState<FilmPlan | null>(null)
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
  const blocked = cutsBlocked({ shots: body.length, lengths: lengths.length, shapes: shapeList.length, versions: rows.length })
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
        // Every shot starts on the free crop; a crop that cuts into the shot says so on its row, and paid new edges
        // are the person's pick (UAT 2026-11-21, F16: a 9:16 shot was set to Aleph 2 unasked).
      }
      setMethods(m)
      setStep('plan')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The Director agent could not plan the cuts. Try again.')
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
  const methodWords = (how: ShotMethod) => (how === 'outpaint' ? `New edges · ${aleph?.label ?? 'Aleph 2'}` : how === 'remake' ? `Remake · ${remakeLabel}` : 'Crop')
  const rowWords = (r: FilmRow) => {
    const shape = FILM_SHAPES.find((s) => s.id === r.shapeId)!
    if (isMaster(shape.aspect)) return 'Re-edit'
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
          <span className="cf-from" title={`${secs(filmS)} s of film`}>from {master.label} · {secs(filmS)} s</span>
          <span className="pt-grow" />
          <button type="button" className="btn sm ghost" onClick={onClose}>Cancel</button>
        </header>

        {step === 'options' && (
          <div className="cf-body">
            <div className="cf-label">Lengths</div>
            <div className="cf-chips" aria-label="Lengths">
              {[...new Set([...FILM_LENGTHS, ...lengths])].filter((s) => s <= Math.max(masterS, 30)).sort((a, b) => b - a).map((s) => (
                <button key={s} type="button" aria-pressed={lengths.includes(s)} className={`cf-chip ${lengths.includes(s) ? 'on' : ''}`}
                  disabled={s > masterS && !lengths.includes(s)} title={s > masterS && !lengths.includes(s) ? `Longer than the ad (${masterS} s): a cut keeps fewer shots, never more` : undefined}
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
            <p className="cf-note">{versionsWord(rows.length)} from the ad's own {body.length} {body.length === 1 ? 'shot' : 'shots'}. The Director agent plans which shots each length keeps and how each shot fits each shape, before anything is made. On 9:16, 4:5 and 1:1 the spoken lines are captioned for sound off; turn them off on any tile.</p>
            {error && <p className="cf-error" role="alert">{error}</p>}
            <footer className="cf-foot">{blocked && <span className="cf-note">{blocked}</span>}<span className="pt-grow" /><button type="button" className="btn primary" disabled={!!blocked} title={blocked ?? undefined} onClick={() => void startPlan()}>Plan the cuts</button></footer>
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
              {/* Said plainly when the Director agent did not plan it (UAT round 4, R4-F4, UX 4). */}
              <span><b>{sayer('dex')}</b>: {plan.simple === 'failed' ? "I couldn't plan this one, so here is a simple cut: the opening and the payoff, fitted to each length."
                : plan.simple === 'off' ? 'a simple cut: the opening and the payoff, fitted to each length.' : 'how I would cut it.'} Keep or drop any beat; nothing is made yet.</span>
            </div>
            <div className="cf-tray">
              {lengths.filter((l) => rows.some((r) => r.lengthS === l)).map((l) => {
                const { windows, over } = fitWindows(shots, kept(l), l)
                // The Director agent's reason only beside the pick it was for: a beat the person turned the other way says so
                // (UAT round 4 F35: a reason for keeping a shot stood beside it unticked).
                const said = new Map((plan.lengths.find((x) => Math.abs(x.lengthS - l) < 0.5)?.beats ?? []).map((b) => [b.shotId, b]))
                const reasons = new Map(body.map((s) => {
                  const b = said.get(s.shotId)
                  const on = kept(l).has(s.shotId)
                  return [s.shotId, b && b.keep === on ? pickWords(on, b.why) : on ? 'Kept by you' : 'Dropped by you'] as const
                }))
                const why = plan.lengths.find((x) => Math.abs(x.lengthS - l) < 0.5)?.why
                return (
                  <div key={l} className="cf-lane" role="group" aria-label={`The ${l} s cut`}>
                    <div className="cf-lanehead">{l} s · keeps {windows.length} of {body.length} shots{over > 0.05 ? ` · over by ${over.toFixed(1)} s: drop a beat` : over < -0.05 ? ` · comes out ${(-over).toFixed(1)} s short: keep a beat to fill it` : ''}</div>
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
                        <span className="cf-note" style={{ flex: 1 }}>{c?.why ?? ''}{c?.cuts && how === 'crop' ? `${c?.why ? ' ' : ''}So the whole shot is fitted on a soft fill of itself; New edges makes real edges.` : ''}</span>
                        <select aria-label={`How shot ${shot.number} is made at ${s.label}`} value={how} onChange={(e) => setMethod(s.id, shot.shotId, e.target.value as ShotMethod)}>
                          <option value="crop">Crop</option>
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
            <div className="cf-tray" role="list" aria-label="What the Edit agent will make">
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
              <span className="cf-note">{versionsWord(rows.filter((r) => r.on).length)}, cut from the same takes{paid.length ? `; ${paid.length} ${paid.length === 1 ? 'shot' : 'shots'} on a model` : ''}. They land on the Campaign board's Film lane.</span>
              <span className="pt-grow" />
              <button type="button" className="btn ghost" onClick={() => setStep('plan')}>Back</button>
              <button type="button" className="btn primary" disabled={busy || !rows.some((r) => r.on)} onClick={() => void send()}>
                {busy ? 'Starting…' : `Make ${versionsWord(rows.filter((r) => r.on).length)}`}
              </button>
            </footer>
          </div>
        )}
      </section>
    </div>
  )
}
