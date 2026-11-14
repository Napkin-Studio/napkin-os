// The Video editor as two rooms over one Bin (features/make-and-edit.clan; boards Make room, Edit room and
// Change a take). Make is the shoot: boxes of shots, takes, Compare and Change. Edit is the cutting room: a
// timeline of V1, Text and the end card, a preview from the same compiled plan as the render, and Render ad.
// Make never moves the edit; Edit never spends. Behind flags.makeAndEdit (stages/Video.tsx is the editor
// when it is off).
//
// One top bar for both rooms: Back to the canvas, the film's name, Make | Edit, the Jobs pill, Open Sound and
// the room's main action. Esc closes a drawer first, then acts as Back. 1 and 2 switch rooms, and the
// selection carries across: a clip picked in Edit opens its box in Make.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useConfig, useDoc, useJobsTick, useServices, useUi } from '../app/context'
import { isMoving } from '../jobs/select'
import { mainVideo, openVideo, shotsOf, storyboardOfVideo } from '../model/selectors'
import { nodeTitle } from '../ui/chrome/panels'
import { useProjectName } from '../ui/useDownload'
import { Float } from '../ui/Float'
import { SoundView } from '../stages/SoundView'
import { Bin } from './Bin'
import { ChangeDrawer, type ChangeOpen } from './ChangeDrawer'
import { EditRoom, RenderAd } from './EditRoom'
import { MakeRoom } from './MakeRoom'
import { boxName, genTitle, roomBoxes, roomGens, type Box, type Gen } from './model'
import './rooms.css'

export type RoomName = 'make' | 'edit'

/** What is picked, carried across the rooms. */
export interface Selection {
  shotId?: string
  boxKey?: string
  genId?: string
  clipId?: string
}

/** Everything both rooms read, worked out once per render. */
export interface RoomData {
  videoId: string
  title: string
  ratio: string
  targetS: number
  boxes: Box[]
  gens: Gen[]
}

export function Rooms() {
  const { ui: uiStore } = useServices()
  const doc = useDoc()
  const ui = useUi()
  const { config, controls } = useConfig()
  useJobsTick()
  const projectName = useProjectName()
  const video = openVideo(doc, ui.openNode)
  const sb = storyboardOfVideo(doc, video?.id)
  const isMain = !video || video.id === mainVideo(doc)?.id
  const shots = sb ? shotsOf(doc, sb.id) : []
  const videoId = video?.id
  const boxes = roomBoxes(doc, ui, videoId, config)
  const gens = roomGens(doc, ui, videoId, boxes)
  const data: RoomData | null = video ? {
    videoId: video.id,
    // The film's name: the video's own, else the storyboard's that renders it, else the project's.
    title: video.title && video.title !== 'Video' ? video.title : isMain && sb && !sb.implicit && sb.title !== 'Storyboard' ? sb.title : nodeTitle(video.title, 'Video', projectName),
    ratio: sb?.ratio ?? video.ratio ?? '16:9',
    targetS: sb?.target_s ?? video.target_s ?? 15,
    boxes, gens,
  } : null

  const [room, setRoom] = useState<RoomName>('make')
  const [sel, setSel] = useState<Selection>(() => ({ shotId: shots[0]?.id, boxKey: boxes[0]?.key }))
  const [change, setChange] = useState<ChangeOpen | null>(null)
  const [sound, setSound] = useState(false)
  const back = useCallback(() => uiStore.update((u) => { u.stage = 'character' }, 'stage'), [uiStore])
  // A drawer or sheet registers here, so Esc closes it before it means Back.
  const closers = useRef<(() => void)[]>([])
  const register = useCallback((close: () => void) => {
    closers.current.push(close)
    return () => { closers.current = closers.current.filter((c) => c !== close) }
  }, [])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const typing = (e.target as Element | null)?.closest?.('input, textarea, select, [contenteditable="true"]')
      if (e.key === 'Escape') {
        const top = closers.current.at(-1)
        if (top) { e.preventDefault(); top(); return }
        if (change) { e.preventDefault(); setChange(null); return }
        if (sound) { e.preventDefault(); setSound(false); return }
        if (typing) { (typing as HTMLElement).blur(); return }
        e.preventDefault()
        back()
        return
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '1') setRoom('make')
      if (e.key === '2') setRoom('edit')
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [change, sound, back])

  if (!controls.video) return <div className="panel"><div className="empty-state"><b>Video is off right now.</b></div></div>
  if (!data) return <div className="panel"><div className="empty-state"><b>No video here yet.</b></div></div>

  const openChange = (c: ChangeOpen) => {
    setChange(c)
    setSel((s) => ({ ...s, genId: c.parentId, ...(c.shotId ? { shotId: c.shotId } : {}) }))
  }
  return (
    <div className="editor rooms" data-room={room}>
      <RoomsBar data={data} room={room} onRoom={setRoom} onBack={back} sound={sound} onSound={() => setSound(!sound)}
        primary={room === 'make'
          ? <button type="button" className="btn primary rm-primary" onClick={() => setRoom('edit')}>Go to Edit</button>
          : <RenderAd data={data} />} />
      {sound ? (
        <div className="rm-sound">
          <div className="rm-soundhead"><button type="button" className="btn" onClick={() => setSound(false)}>‹ Back to the picture</button></div>
          <SoundView shots={shots} />
        </div>
      ) : (
        <div className="rm-body" data-room={room}>
          <Bin data={data} sel={sel} room={room} onPick={(g) => setSel((s) => ({ ...s, genId: g.id, boxKey: g.boxKey, shotId: g.shotIds.includes(s.shotId ?? '') ? s.shotId : g.shotIds[0] }))} />
          {room === 'make'
            ? <MakeRoom data={data} shots={shots} sel={sel} onSel={setSel} change={change} onChange={openChange} onCloseChange={() => setChange(null)} onRoom={setRoom} register={register} />
            : <EditRoom data={data} sel={sel} onSel={setSel} onChange={openChange} onSound={() => setSound(true)} register={register} />}
        </div>
      )}
      {room === 'edit' && change && !sound && (
        <div className="rm-drawerwrap" role="presentation" onPointerDown={(e) => { if (e.target === e.currentTarget) setChange(null) }}>
          <ChangeDrawer data={data} open={change} onClose={() => setChange(null)} variant="drawer"
            onMade={() => setChange(null)} onApart={(shotId) => { setChange(null); setSel((s) => ({ ...s, shotId })); setRoom('make') }} />
        </div>
      )}
    </div>
  )
}

/** The shared top bar: ‹ Canvas, the film's name, Make | Edit, Jobs, Open Sound, the main action. */
function RoomsBar({ data, room, onRoom, onBack, sound, onSound, primary }: {
  data: RoomData; room: RoomName; onRoom: (r: RoomName) => void; onBack: () => void; sound: boolean; onSound: () => void; primary: React.ReactNode
}) {
  return (
    <header className="rm-bar" data-float-avoid="">
      <div className="rm-barleft">
        <button type="button" className="rm-back" onClick={onBack} aria-label="Back to the canvas" title="Back to the canvas (Esc)">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 L5.5 8 L10 12.5" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>Canvas</span>
        </button>
        <h1 className="rm-title" title={data.title}>{data.title}</h1>
        <span className="rm-meta pt-mono">{data.ratio} · {Math.round(data.targetS)} s</span>
      </div>
      <div className="rm-switch" role="group" aria-label="Room">
        <button type="button" aria-pressed={room === 'make' && !sound} onClick={() => onRoom('make')} title="Make: ask for footage (1)">Make</button>
        <button type="button" aria-pressed={room === 'edit' && !sound} onClick={() => onRoom('edit')} title="Edit: cut what you have (2)">Edit</button>
      </div>
      <div className="rm-barright">
        <JobsPill data={data} />
        <button type="button" className={`btn rm-sound-btn ${sound ? 'on' : ''}`} aria-pressed={sound} onClick={onSound} title="Open Sound">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6v4h3l4 3V3L5 6H2z M11.5 5.5a3.5 3.5 0 0 1 0 5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
          <span className="rm-hide-narrow">Open Sound</span>
        </button>
        {primary}
      </div>
    </header>
  )
}

/** The takes being made, in plain states. No prices: credits are only in History. */
function JobsPill({ data }: { data: RoomData }) {
  const doc = useDoc()
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const making = data.gens.filter((g) => g.state === 'making')
  const n = making.length
  const stateWords = (g: Gen) => {
    const j = g.jobId ? doc.jobs[g.jobId] : undefined
    if (!j) return 'Making'
    if (j.state === 'queued' || j.state === 'submitting') return 'Sending'
    if (j.state === 'fetching' || j.state === 'validating') return 'Checking'
    if (j.state === 'completed') return 'Ready'
    return isMoving(doc, j.id) ? 'Making' : 'Waiting'
  }
  return (
    <>
      <button ref={ref} type="button" className={`rm-jobs ${n ? 'busy' : ''}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}
        title={n ? `${n} being made` : 'Nothing is being made'}>
        <span className="rm-jobdot" aria-hidden="true" />
        {n ? `${n} making` : 'Jobs'}
      </button>
      <Float anchor={ref} open={open} onClose={close} role="dialog" label="Being made" align="end" className="rm-jobsfloat">
        <div className="rm-floathead">Being made</div>
        {making.map((g) => (
          <div key={g.id} className="rm-jobrow">
            <span className="rm-clamp1" title={genTitle(g, data.boxes)}>{boxName(data.boxes.find((b) => b.key === g.boxKey) ?? { n: 0, endCard: false })} · v{g.version}</span>
            <span className="rm-pill">{stateWords(g)}</span>
          </div>
        ))}
        {!n && <p className="rm-note">Nothing is being made.</p>}
        <p className="rm-note">Sending, Making, Checking, then Ready. Finished takes land in the Bin.</p>
      </Float>
    </>
  )
}
