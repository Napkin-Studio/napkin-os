// The Make room (board Make room): ask for footage. The player, the Boxes strip (one box is one generation; a
// line inside a box is a cut), each box's takes stack (newest first, each with its change label), Compare,
// and the Direct panel's Shot, Box and Change tabs. Make sends one generation: the new take lands on its
// box's stack and in the Bin, never over an old one, and the Edit room's cut is not touched. Changing a shot
// changes the next take only: the takes there are never marked out of date.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useConfig, useDoc, useServices, useUi } from '../app/context'
import { choiceToSend, modelChoicesFor } from '../capabilities'
import { CAMERA_ANGLES, CAMERA_MOVEMENTS, type Camera, type CameraMovement, type ModelChoice, type Shot } from '../contracts/types'
import { updateDoc } from '../doc/store'
import { lastWorkedModel } from '../jobs/follow'
import { selectedFrame } from '../jobs/frames'
import { makeClip, videoQuality } from '../jobs/clips'
import { makeRuns, modelEntry } from '../jobs/runs'
import { joinSelection, separateSelection, videoJoin } from '../jobs/runView'
import { isRunning, jobAt } from '../jobs/select'
import { shotNumber } from '../model/selectors'
import { Float, MenuItem } from '../ui/Float'
import { useSending } from '../ui/hooks'
import { ChangeDrawer, type ChangeOpen } from './ChangeDrawer'
import { cameraWord } from './delta'
import { boxName, genTitle, shotTitle, type Box, type Gen } from './model'
import { Compare, TakePlayer } from './Players'
import { Poster } from './Poster'
import type { RoomData, Selection } from './Rooms'
import { appendTake } from './editOps'

type Tab = 'shot' | 'box' | 'change'
const SIZES = ['close', 'medium', 'wide'] as const
const ANGLES = CAMERA_ANGLES.filter((a) => a === 'eye_level' || a === 'high_angle' || a === 'low_angle')
const MOVES: CameraMovement[] = CAMERA_MOVEMENTS.filter((m) => m !== 'crane_down')
const SPEEDS = [{ id: 'slow', label: 'Slow' }, { id: 'normal', label: 'Normal' }, { id: 'fast', label: 'Fast' }] as const


export function MakeRoom({ data, shots, sel, onSel, change, onChange, onCloseChange, onRoom, register }: {
  data: RoomData
  shots: Shot[]
  sel: Selection
  onSel: (s: Selection) => void
  change: ChangeOpen | null
  onChange: (c: ChangeOpen) => void
  onCloseChange: () => void
  onRoom: (r: 'make' | 'edit') => void
  register: (close: () => void) => () => void
}) {
  const { doc: docStore, ui: uiStore, runner, relay } = useServices()
  const doc = useDoc()
  const ui = useUi()
  const { config } = useConfig()
  const deps = { relay, doc: docStore, ui: uiStore, runner }
  const [tab, setTab] = useState<Tab>(change ? 'change' : 'shot')
  // A change opened from elsewhere (a take's menu, the Bin) shows the Change tab.
  const [seen, setSeen] = useState(change)
  if (seen !== change) {
    setSeen(change)
    if (change) setTab('change')
  }
  const box = data.boxes.find((b) => b.key === sel.boxKey) ?? data.boxes.find((b) => b.shotIds.includes(sel.shotId ?? '')) ?? data.boxes[0]
  const shot = (sel.shotId && box?.shotIds.includes(sel.shotId) ? doc.shots[sel.shotId] : undefined) ?? (box ? doc.shots[box.shotIds[0]] : undefined)
  const shown = data.gens.find((g) => g.id === sel.genId && g.state === 'ready') ?? data.gens.find((g) => g.boxKey === box?.key && g.state === 'ready')
  const shownBox = shown ? data.boxes.find((b) => b.key === shown.boxKey) : undefined
  const [ticked, setTicked] = useState<string[]>([])
  const [comparing, setComparing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [making, send] = useSending()
  const [models, setModels] = useState<Record<string, ModelChoice>>({})
  useEffect(() => (comparing ? register(() => setComparing(false)) : undefined), [comparing, register])

  const pickShot = (b: Box, id: string) => { onSel({ ...sel, boxKey: b.key, shotId: id }); setTab('shot') }
  const pickBox = (b: Box) => { onSel({ ...sel, boxKey: b.key, shotId: b.shotIds.includes(sel.shotId ?? '') ? sel.shotId : b.shotIds[0] }); setTab('box') }
  const pickTake = (g: Gen) => onSel({ ...sel, genId: g.id, boxKey: g.boxKey })
  const tick = (id: string) => setTicked((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t.slice(-1), id]))
  const busy = (id: string) => isRunning(doc, jobAt(doc, ui, (c) => (c.for === 'clip' && c.shotId === id) || (c.for === 'run' && !!doc.videos[c.videoId]?.runs?.[c.runId]?.shot_ids.includes(id))))

  /** Make on a box: one generation of its shots. It lands as a new take; the cut is not touched. */
  const make = (b: Box) => send(async () => {
    setError(null)
    try {
      const choice = models[b.key] ?? choiceToSend('clip', config, lastWorkedModel(doc, 'clip', config))
      if (videoJoin(doc, data.videoId, config) === 'film') {
        const failed = await makeRuns(deps, { videoId: data.videoId, shotIds: [b.shotIds[0]], config, again: true, busy, ...(choice ? { modelChoice: choice } : {}), quality: videoQuality(doc, data.videoId) })
        if (failed.length) setError(failed.join(' '))
      } else {
        await makeClip(deps, b.shotIds[0], { videoId: data.videoId, ...(choice ? { modelChoice: choice } : {}) })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  })

  const compareGens = ticked.map((id) => data.gens.find((g) => g.id === id)).filter((g): g is Gen => !!g && g.state === 'ready')
  const beats = shown && shown.segments.length > 1 ? shown.segments.slice(1).map((s) => ({ atS: s.inS, label: `Shot ${shotNumber(doc, s.shotId)}` })) : undefined

  return (
    <div className="rm-make">
      <section className="rm-centre" aria-label="Takes and boxes">
        {comparing && compareGens.length === 2 ? (
          <Compare a={{ sha: compareGens[1].asset, label: `${genTitle(compareGens[1], data.boxes)} · ${compareGens[1].label}` }}
            b={{ sha: compareGens[0].asset, label: `${genTitle(compareGens[0], data.boxes)} · ${compareGens[0].label}` }}
            onClose={() => setComparing(false)} />
        ) : (
          <TakePlayer key={shown?.id ?? 'none'} sha={shown?.asset} label={shown ? `${shownBox ? boxName(shownBox) : 'Take'} · v${shown.version}` : ''} beats={beats}
            className="rm-mainplayer">
            <button type="button" className="btn" disabled={compareGens.length !== 2} onClick={() => setComparing(true)}
              title={compareGens.length === 2 ? 'Play the two ticked takes side by side' : 'Tick two takes under a box to compare them'}>
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="1.5" y="3" width="5" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" /><rect x="7.5" y="3" width="5" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>
              Compare
            </button>
          </TakePlayer>
        )}
        {error && <div role="alert" className="rm-error">{error}</div>}
        <div className="rm-boxeshead">
          <b>Boxes</b>
          <span className="rm-faint">A box is one video made at once. A line inside a box is a cut. Tick two takes to compare.</span>
        </div>
        <div className="rm-boxes" role="list" aria-label="Boxes">
          {data.boxes.map((b) => b.endCard ? (
            <EndCardTile key={b.key} b={b} shot={doc.shots[b.shotIds[0]]} onEdit={() => onRoom('edit')} />
          ) : (
            <BoxCard key={b.key} b={b} data={data} sel={sel} selected={b.key === box?.key} making={making || b.shotIds.some(busy)}
              onShot={(id) => pickShot(b, id)} onBox={() => pickBox(b)} onMake={() => void make(b)}
              takes={data.gens.filter((g) => g.boxKey === b.key)} ticked={ticked} onTick={tick} onTake={pickTake}
              onChange={(g) => onChange({ parentId: g.id, ...(sel.shotId && g.shotIds.includes(sel.shotId) ? { shotId: sel.shotId } : {}) })}
              onAddToEdit={(g) => void appendTake(docStore, doc, data, g)} />
          ))}
        </div>
      </section>
      <aside className="rm-direct" aria-label="Direct">
        <div className="rm-tabs" role="tablist" aria-label="Direct">
          {(['shot', 'box', 'change'] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'shot' ? 'Shot' : t === 'box' ? 'Box' : 'Change'}</button>
          ))}
        </div>
        <div className="rm-directbody">
          {tab === 'shot' && shot && box && <ShotTab key={shot.id} shot={shot} n={shotNumber(doc, shot.id)} box={box} data={data} onBox={() => setTab('box')} />}
          {tab === 'box' && box && <BoxTab key={box.key} box={box} data={data} shots={shots} model={models[box.key]} onModel={(m) => setModels({ ...models, [box.key]: m })} onMake={() => void make(box)} making={making} />}
          {tab === 'change' && (() => {
            const parent = change ? data.gens.find((g) => g.id === change.parentId) : (shown && shown.boxKey === box?.key ? shown : data.gens.find((g) => g.boxKey === box?.key && g.state === 'ready'))
            if (!parent) return <p className="rm-note rm-pad">Make a take of this box first. Then change one thing and make it again.</p>
            const open: ChangeOpen = change ?? { parentId: parent.id, ...(shot && parent.shotIds.includes(shot.id) ? { shotId: shot.id } : {}) }
            return <ChangeDrawer key={`${open.parentId}:${open.shotId ?? ''}`} data={data} open={open} variant="tab" onClose={() => { onCloseChange(); setTab('shot') }}
              onMade={(g) => { onCloseChange(); if (g) { onSel({ ...sel, genId: g }); } }} onApart={(shotId) => { onCloseChange(); onSel({ ...sel, shotId }); setTab('box') }} />
          })()}
        </div>
      </aside>
    </div>
  )
}

function BoxCard({ b, data, selected, sel, making, takes, ticked, onShot, onBox, onMake, onTick, onTake, onChange, onAddToEdit }: {
  b: Box; data: RoomData; selected: boolean; sel: Selection; making: boolean; takes: Gen[]; ticked: string[]
  onShot: (id: string) => void; onBox: () => void; onMake: () => void; onTick: (id: string) => void; onTake: (g: Gen) => void
  onChange: (g: Gen) => void; onAddToEdit: (g: Gen) => void
}) {
  const doc = useDoc()
  const [all, setAll] = useState(false)
  const shown = all ? takes : takes.slice(0, 3)
  const title = `${boxName(b)} · ${b.together ? 'Made together' : 'One shot'} · ${Math.round(b.lengthS * 10) / 10} s`
  const differs = useMemo(() => nextDiffers(doc, b, takes), [doc, b, takes])
  const has = takes.some((g) => g.state === 'ready')
  return (
    <section className={`rm-box ${selected ? 'sel' : ''}`} role="listitem" aria-label={title}>
      <header className="rm-boxtop">
        <button type="button" className="rm-boxtitle rm-clamp2" title={`${title}. Open the Box tab`} onClick={onBox}>{title}</button>
        <button type="button" className="btn primary rm-make-btn" disabled={making} onClick={onMake}
          title={differs ? `The next take differs: ${differs}` : has ? 'Make another take of this box' : 'Make this box'}>
          {making ? 'Making…' : differs || has ? 'Make new take' : 'Make'}
        </button>
      </header>
      {differs && <div className="rm-differs rm-clamp2" title={`Next take differs: ${differs}`}>Next take differs: {differs}</div>}
      <div className="rm-shots">
        {b.shotIds.map((id, i) => {
          const s = doc.shots[id]
          const n = shotNumber(doc, id)
          return (
            <div key={id} className="rm-shotwrap">
              {i > 0 && <span className="rm-cutline" title="A cut" aria-label="A cut"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><circle cx="3" cy="3" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.1" /><circle cx="3" cy="9" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.1" /><path d="M4.5 4 11 9.5M4.5 8 11 2.5" stroke="currentColor" strokeWidth="1.1" /></svg></span>}
              <button type="button" className={`rm-shotcard ${sel.shotId === id ? 'sel' : ''}`} onClick={() => onShot(id)} aria-pressed={sel.shotId === id}>
                <Poster sha={selectedFrame(doc, id)?.asset} words={shotTitle(s, n)} className="rm-shotthumb" />
                <span className="rm-shotname rm-clamp2" title={`Shot ${n} · ${shotTitle(s, n)}`}><b>{n}</b> {shotTitle(s, n)}</span>
                <span className="rm-camchip rm-clamp1" title={`Camera: ${cameraWord('size', s?.camera.size)} · ${cameraWord('movement', s?.camera.movement)}`}>{cameraWord('size', s?.camera.size)} · {cameraWord('movement', s?.camera.movement)}</span>
              </button>
            </div>
          )
        })}
      </div>
      <div className="rm-stack" aria-label={`Takes of ${boxName(b)}`}>
        {!takes.length && <p className="rm-note">No takes yet.</p>}
        {shown.map((g) => <TakeRow key={g.id} g={g} data={data} picked={sel.genId === g.id} ticked={ticked.includes(g.id)} onTick={() => onTick(g.id)} onPlay={() => onTake(g)}
          onChange={() => onChange(g)} onAddToEdit={() => onAddToEdit(g)} />)}
        {takes.length > 3 && <button type="button" className="btn ghost rm-wide" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${takes.length} takes`}</button>}
      </div>
    </section>
  )
}

function TakeRow({ g, data, picked, ticked, onTick, onPlay, onChange, onAddToEdit }: {
  g: Gen; data: RoomData; picked: boolean; ticked: boolean; onTick: () => void; onPlay: () => void; onChange: () => void; onAddToEdit: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<false | 'menu' | 'lineage'>(false)
  const close = useCallback(() => setMenu(false), [])
  const ready = g.state === 'ready'
  const parent = g.parentId ? data.gens.find((x) => x.id === g.parentId) : undefined
  const kids = data.gens.filter((x) => x.parentId === g.id)
  return (
    <div ref={ref} className={`rm-take ${picked ? 'sel' : ''} ${g.state}`} onContextMenu={(e) => { e.preventDefault(); if (ready) setMenu('menu') }}>
      <label className="rm-tick" title={ready ? 'Tick two to compare' : undefined}>
        <input type="checkbox" checked={ticked} disabled={!ready} onChange={onTick} aria-label={`Tick v${g.version} to compare`} />
      </label>
      <button type="button" className="rm-takebtn" onClick={onPlay} disabled={!ready} title={`v${g.version} · ${g.label}`}>
        <Poster sha={g.asset} atS={g.segments[0]?.inS ?? 0} words={g.state === 'making' ? '' : 'v' + g.version} className="rm-takethumb" />
        {g.state === 'making' && <span className="rm-spin" aria-hidden="true" />}
        <span className="rm-takelabel rm-clamp2"><b>v{g.version}</b> · {g.state === 'making' ? 'Making' : g.label}</span>
      </button>
      <button type="button" className="rm-iconbtn ghost" aria-label={`More for v${g.version}`} aria-haspopup="menu" disabled={!ready} onClick={() => setMenu(menu ? false : 'menu')}>⋯</button>
      <Float anchor={ref} open={!!menu} onClose={close} align="end" role={menu === 'lineage' ? 'dialog' : 'menu'} label={`v${g.version}`} className="rm-lineage">
        {menu === 'lineage' ? (
          <div className="rm-lineagebody">
            <div className="rm-floathead">Lineage</div>
            {parent && <><div className="rm-linrow"><span className="pt-mono">v{parent.version}</span><span className="rm-clamp1" title={parent.label}>{parent.label}</span></div><div className="rm-linarrow" aria-hidden="true">↓</div></>}
            <div className="rm-linrow cur"><span className="pt-mono">v{g.version}</span><span className="rm-clamp1" title={g.label}>{g.label}</span></div>
            {kids.map((c) => <div key={c.id}><div className="rm-linarrow" aria-hidden="true">↓</div><div className="rm-linrow"><span className="pt-mono">v{c.version}</span><span className="rm-clamp1" title={c.label}>{c.label}</span></div></div>)}
            <button type="button" className="btn rm-wide" onClick={close}>Close</button>
          </div>
        ) : (
          <>
            <MenuItem icon="✎" onSelect={() => { close(); onChange() }}>New take with a change…</MenuItem>
            <MenuItem icon="＋" onSelect={() => { close(); onAddToEdit() }}>Add to edit</MenuItem>
            <MenuItem icon="⟲" onSelect={() => setMenu('lineage')}>Show lineage</MenuItem>
          </>
        )}
      </Float>
    </div>
  )
}

function EndCardTile({ b, shot, onEdit }: { b: Box; shot?: Shot; onEdit: () => void }) {
  return (
    <section className="rm-box endcard" role="listitem" aria-label="End card">
      <header className="rm-boxtop"><span className="rm-boxtitle rm-clamp2">End card · {Math.round(b.lengthS * 10) / 10} s</span></header>
      <div className="rm-cardtile" aria-hidden="true"><span className="rm-clamp2">{shot?.action?.trim() || 'Card'}</span></div>
      <p className="rm-note">Not made by a model. Its words, logo and colour are set in the Edit room.</p>
      <button type="button" className="btn rm-wide" onClick={onEdit}>Edit in the Edit room</button>
    </section>
  )
}

/** What the next take of a box differs in from its newest take: "shot 3 camera Handheld". */
function nextDiffers(d: ReturnType<typeof useDoc>, b: Box, takes: Gen[]): string | undefined {
  const top = takes.find((g) => g.state === 'ready')
  const sent = top ? d.generations?.[top.id]?.inputs?.camera : undefined
  if (!sent) return undefined
  for (const id of b.shotIds) {
    const now = d.shots[id]?.camera
    const was = sent[id]
    if (!now || !was) continue
    if ((now.movement ?? 'static') !== (was.movement ?? 'static')) return `shot ${shotNumber(d, id)} camera ${cameraWord('movement', now.movement)}`
    if (now.size !== was.size) return `shot ${shotNumber(d, id)} ${cameraWord('size', now.size).toLowerCase()}`
  }
  return undefined
}

/** The Shot tab: the shot's camera, its start and end frames, its cast and look, its length. Changes apply
 *  to the next take only. */
function ShotTab({ shot, n, box, data, onBox }: { shot: Shot; n: number; box: Box; data: RoomData; onBox: () => void }) {
  const { doc: docStore } = useServices()
  const doc = useDoc()
  const { config } = useConfig()
  const set = (patch: Partial<Camera>, why: string) => void updateDoc(docStore, (d) => {
    const s = d.shots[shot.id]
    if (s) s.camera = { ...s.camera, ...patch }
  }, why)
  const setLength = (v: number) => void updateDoc(docStore, (d) => {
    const s = d.shots[shot.id]
    if (s) s.duration_s = Math.max(0.5, Math.min(15, Math.round(v * 10) / 10))
  }, `shot ${n} length`)
  const frame = selectedFrame(doc, shot.id)
  const i = box.shotIds.indexOf(shot.id)
  const nextFrame = i >= 0 && i < box.shotIds.length - 1 ? selectedFrame(doc, box.shotIds[i + 1]) : undefined
  const model = modelEntry(...(lastModel(doc, config)))
  const refsMax = model?.refsMax ?? 4
  const refs = (shot.refs ?? []).map((id) => doc.refs[id]).filter(Boolean)
  const differs = nextDiffers(doc, box, data.gens.filter((g) => g.boxKey === box.key))
  return (
    <div className="rm-tab">
      <div className="rm-tabhead">
        <span className="rm-kicker pt-mono">Shot {n} · {boxName(box)}</span>
        <b className="rm-clamp2" title={shotTitle(shot, n)}>{shotTitle(shot, n)}</b>
      </div>
      {differs && <div className="rm-banner info" role="status">Next take differs: {differs}. The takes you have stay as they are.</div>}
      <fieldset className="rm-field">
        <legend className="rm-label">Camera</legend>
        <div className="rm-row"><span className="rm-rowname">Size</span>
          <div className="rm-chiprow" role="radiogroup" aria-label="Size">
            {SIZES.map((s) => <button key={s} type="button" role="radio" aria-checked={shot.camera.size === s} className={`rm-chip ${shot.camera.size === s ? 'on' : ''}`} onClick={() => set({ size: s }, `shot ${n} size`)}>{cameraWord('size', s)}</button>)}
          </div>
        </div>
        <div className="rm-row"><span className="rm-rowname">Angle</span>
          <div className="rm-chiprow" role="radiogroup" aria-label="Angle">
            {ANGLES.map((a) => <button key={a} type="button" role="radio" aria-checked={(shot.camera.angle ?? 'eye_level') === a} className={`rm-chip ${(shot.camera.angle ?? 'eye_level') === a ? 'on' : ''}`} onClick={() => set({ angle: a }, `shot ${n} angle`)}>{cameraWord('angle', a)}</button>)}
          </div>
        </div>
        <div className="rm-rowname">Movement</div>
        <div className="rm-movegrid" role="radiogroup" aria-label="Movement">
          {MOVES.map((m) => <button key={m} type="button" role="radio" aria-checked={(shot.camera.movement ?? 'static') === m} className={`rm-chip ${(shot.camera.movement ?? 'static') === m ? 'on' : ''}`} onClick={() => set({ movement: m }, `shot ${n} camera movement`)}>{cameraWord('movement', m)}</button>)}
        </div>
        <div className="rm-row"><span className="rm-rowname">Speed</span>
          <div className="rm-chiprow" role="radiogroup" aria-label="Camera speed">
            {SPEEDS.map((s) => <button key={s.id} type="button" role="radio" aria-checked={(shot.camera.movement_speed ?? 'normal') === s.id} className={`rm-chip ${(shot.camera.movement_speed ?? 'normal') === s.id ? 'on' : ''}`} onClick={() => set({ movement_speed: s.id }, `shot ${n} camera speed`)}>{s.label}</button>)}
          </div>
        </div>
      </fieldset>
      <fieldset className="rm-field">
        <legend className="rm-label">Start and end frame</legend>
        <div className="rm-wells">
          <div className="rm-well"><span className="rm-rowname">Starts on</span><Poster sha={frame?.asset} words="No frame yet" /></div>
          <div className={`rm-well ${box.together ? 'off' : ''}`}><span className="rm-rowname">Ends on</span>
            {box.together ? <div className="rm-poster empty"><span className="rm-clamp2">Not when shots are made together</span></div> : <Poster sha={nextFrame?.asset} words="Nothing set" />}
          </div>
        </div>
        {box.together && <p className="rm-note">This model can't end on a set frame when shots are made together.</p>}
        {box.together && <button type="button" className="btn link rm-linkrow" onClick={onBox}>Box settings</button>}
      </fieldset>
      <fieldset className="rm-field">
        <legend className="rm-label">Cast and look</legend>
        <div className="rm-chiprow wrap">
          {refs.map((r) => <span key={r.id} className="rm-chip static" title={`@${r.key}_${r.variant}`}>@{r.key}</span>)}
          {!refs.length && <span className="rm-faint">No one named in this shot.</span>}
        </div>
        <p className="rm-note">Name people and things with @ in the shot's words. Up to {refsMax} for this model.</p>
      </fieldset>
      <fieldset className="rm-field">
        <legend className="rm-label">Length</legend>
        <div className="rm-row">
          <button type="button" className="rm-iconbtn" aria-label="Shorter" onClick={() => setLength(shot.duration_s - 0.5)}>−</button>
          <span className="pt-mono rm-len">{shot.duration_s.toFixed(1)} s</span>
          <button type="button" className="rm-iconbtn" aria-label="Longer" onClick={() => setLength(shot.duration_s + 0.5)}>+</button>
        </div>
      </fieldset>
      <p className="rm-note">Changes here make the next take. The takes you have stay as they are.</p>
    </div>
  )
}

function lastModel(doc: ReturnType<typeof useDoc>, config: ReturnType<typeof useConfig>['config']): [Parameters<typeof modelEntry>[0], string] {
  const m = lastWorkedModel(doc, 'clip', config) ?? modelChoicesFor('clip', config)[0]
  return [(m?.provider ?? 'mock') as Parameters<typeof modelEntry>[0], m?.model ?? '']
}

/** The Box tab: made together or apart, the model (only those that can make it, the others greyed with why),
 *  and the limits. */
function BoxTab({ box, data, shots, model, onModel, onMake, making }: {
  box: Box; data: RoomData; shots: Shot[]; model?: ModelChoice; onModel: (m: ModelChoice) => void; onMake: () => void; making: boolean
}) {
  const { doc: docStore } = useServices()
  const doc = useDoc()
  const { config } = useConfig()
  const options = modelChoicesFor('clip', config)
  const current = model ?? lastWorkedModel(doc, 'clip', config) ?? options[0]
  const i = shots.findIndex((s) => s.id === box.shotIds[0])
  const next = shots[i + box.shotIds.length]
  const take = (m: ModelChoice) => modelEntry(m.provider as Parameters<typeof modelEntry>[0], m.model)?.video.take
  const why = (m: ModelChoice) => (box.together && !take(m)?.ok ? "Can't make several shots as one video" : undefined)
  const t = current ? take(current) : undefined
  return (
    <div className="rm-tab">
      <div className="rm-tabhead">
        <span className="rm-kicker pt-mono">{boxName(box)}</span>
        <b className="rm-clamp2">{box.together ? `Made together · ${box.shotIds.length} shots · ${Math.round(box.lengthS * 10) / 10} s` : `One shot · ${Math.round(box.lengthS * 10) / 10} s`}</b>
      </div>
      <fieldset className="rm-field">
        <legend className="rm-label">How it is made</legend>
        <div className="rm-seg" role="radiogroup" aria-label="How it is made">
          <button type="button" role="radio" aria-checked={box.together} className={box.together ? 'on' : ''} disabled={box.together || !next || next.kind === 'end_card'}
            onClick={() => void joinSelection(docStore, data.videoId, [...box.shotIds, next!.id])}
            title={box.together ? undefined : next && next.kind !== 'end_card' ? `Make it one video with shot ${i + box.shotIds.length + 1}` : 'There is no shot after it to join'}>Made together</button>
          <button type="button" role="radio" aria-checked={!box.together} className={!box.together ? 'on' : ''} disabled={!box.together}
            onClick={() => void separateSelection(docStore, data.videoId, box.shotIds)}>Made apart</button>
        </div>
        <p className="rm-note">{box.together ? 'One video, cut where the lines are. A change to one shot remakes the box.' : 'This shot is made on its own.'}</p>
      </fieldset>
      <fieldset className="rm-field">
        <legend className="rm-label">Model</legend>
        <div className="rm-models" role="radiogroup" aria-label="Model">
          {options.map((o) => {
            const no = why(o)
            const on = current?.provider === o.provider && current.model === o.model
            return (
              <button key={`${o.provider}:${o.model}`} type="button" role="radio" aria-checked={on} disabled={!!no} className={`rm-modelrow ${on ? 'on' : ''}`} onClick={() => onModel({ provider: o.provider, model: o.model })}>
                <span className="rm-clamp1" title={o.label}>{o.label}</span>
                {no && <span className="rm-faint rm-clamp2">{no}</span>}
              </button>
            )
          })}
        </div>
        {box.together && t?.ok && <p className="rm-note">Up to {t.maxShots ?? 6} shots or {t.maxS ?? 15} s together.</p>}
      </fieldset>
      <button type="button" className="btn primary rm-wide" disabled={making} onClick={onMake}>{making ? 'Making…' : data.gens.some((g) => g.boxKey === box.key) ? 'Make new take' : 'Make'}</button>
      <p className="rm-note">A new take lands on this box's stack and in the Bin. Your cut stays as it is.</p>
    </div>
  )
}
