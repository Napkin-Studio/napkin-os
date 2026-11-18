// The Film editor as two rooms over one Bin (features/make-and-edit.clan; boards Make room, Edit room and
// Change a take). Make is the shoot: boxes of shots, takes, Compare and Change. Edit is the cutting room: a
// timeline of V1, Text and the end card, a preview from the same compiled plan as the render, and Render ad.
// Make never moves the edit; Edit never spends. Behind flags.makeAndEdit (stages/Video.tsx is the editor
// when it is off).
//
// One top bar for both rooms: Back to the canvas, the film's name, Make | Edit, the Jobs pill, Open Sound and
// the room's main action. Esc closes a drawer first, then acts as Back. 1 and 2 switch rooms, and the
// selection carries across: a clip picked in Edit opens its box in Make.

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useConfig, useDoc, useJobsTick, useRoute, useRouter, useServices, useUi } from '../app/context'
import { projectRoute, routeRoom, type RoomRoute } from '../app/route'
import { isActive } from '../jobs/runner'
import { takeShotOut } from '../jobs/runView'
import { undo } from '../doc/undo'
import { purposeOf } from '../model/purpose'
import { whoIsWorking } from '../ui/agents/cast'
import { jobsList, mainVideo, openVideo, shotNumber, shotsOf, storyboardOfVideo } from '../model/selectors'
import { nodeTitle } from '../ui/chrome/panels'
import { useProjectName } from '../ui/useDownload'
import { Float } from '../ui/Float'
import { SoundView } from '../stages/SoundView'
import { Bin } from './Bin'
import { ChangeDrawer, type ChangeOpen } from './ChangeDrawer'
import { EditRoom, RenderAd } from './EditRoom'
import { MakeRoom } from './MakeRoom'
import { RoomBooth, RoomWaits } from './RoomBooth'
import { EditorBar } from '../ui/chrome/TopBars'
import { filmMeta, jobWord, roomBoxes, roomGens, type Box, type Gen } from './model'
import type { Picked } from './Timeline'
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
  /** The film's length now: its shots' lengths, the end card included. */
  lengthS?: number
  boxes: Box[]
  gens: Gen[]
}

export function Rooms() {
  const { ui: uiStore, doc: docStore } = useServices()
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
    title: video.title && video.title !== 'Video' && video.title !== 'Film' ? video.title : isMain && sb && !sb.implicit && sb.title !== 'Storyboard' ? sb.title : nodeTitle(video.title, 'Film', projectName),
    ratio: sb?.ratio ?? video.ratio ?? '16:9',
    targetS: sb?.target_s ?? video.target_s ?? 15,
    lengthS: shots.reduce((a, s) => a + (s.duration_s ?? 0), 0),
    boxes, gens,
  } : null

  // The room is the route's (/p/:id/video/make, /edit, /sound): reload, Back and Share return to it. It is
  // written in place as the person switches. Outside a video route (tests) it is kept here.
  const router = useRouter()
  const route = useRoute()
  const routed = route.kind === 'project' && route.stage === 'video' ? route : null
  const [kept, setKept] = useState<RoomRoute>('make')
  const now: RoomRoute = routed ? routeRoom(routed) : kept
  // Sound opens over the picture room the person was in; Back to the picture returns there.
  const [picture, setPicture] = useState<RoomName>(now === 'sound' ? 'make' : now)
  const goRoom = useCallback((r: RoomRoute) => {
    if (r !== 'sound') setPicture(r)
    if (routed) router.replace(projectRoute(routed.projectId, 'video', r))
    else setKept(r)
  }, [routed, router])
  const room: RoomName = now === 'sound' ? picture : now
  const sound = now === 'sound'
  const setRoom = useCallback((r: RoomName) => goRoom(r), [goRoom])
  const setSound = useCallback((on: boolean) => goRoom(on ? 'sound' : picture), [goRoom, picture])
  // Nothing selected at first: no Booth until a box, shot, take or clip is picked (the Booth rule).
  const [sel, setSel] = useState<Selection>({})
  const [slot, setSlot] = useState<HTMLDivElement | null>(null)
  // The Edit room's controls live in the band (mock edit): Preview | Rendered after the film's length, the
  // timeline's tools on the right. Its Inspector is the Booth, only while a clip, a text or the card is picked.
  const [viewSlot, setViewSlot] = useState<HTMLSpanElement | null>(null)
  const [toolSlot, setToolSlot] = useState<HTMLSpanElement | null>(null)
  const [picked, setPicked] = useState<Picked>(null)
  const [change, setChange] = useState<ChangeOpen | null>(null)
  const [ready, setReady] = useState<{ clipId: string; takeId: string; n: number } | null>(null)
  // The last join or cut made in the strip: Fin says so in the Booth, with Undo (features/join-or-cut-shots.clan).
  const [done, setDone] = useState<{ id: number; text: string } | null>(null)
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
  }, [change, sound, back, setRoom, setSound])

  if (!controls.video) return <div className="panel"><div className="empty-state"><b>Film is off right now.</b></div></div>
  if (!data) return (
    <div className="panel"><div className="empty-state">
      <b>No film here yet.</b>
      <p>Select a storyboard or script on the canvas and choose Make film.</p>
      <button type="button" className="btn" onClick={back}>‹ Back to the canvas</button>
    </div></div>
  )

  const openChange = (c: ChangeOpen) => {
    setChange(c)
    setSel((s) => ({ ...s, genId: c.parentId, ...(c.shotId ? { shotId: c.shotId } : {}) }))
  }
  return (
    <div className="editor rooms" data-room={room}>
      {/* The shell bar and the band (mock production-new-ui-v2 make, edit): Make | Edit, the film's length, what
          is being made, Open Sound, undo; Go to Edit or Render ad in the bar. */}
      <EditorBar back="Canvas" onBack={back} icon="video" title="Film" undo
        view={{ label: 'Room', value: room, options: [{ id: 'make', label: 'Make' }, { id: 'edit', label: 'Edit' }], onPick: (v) => setRoom(v as RoomName) }}
        afterView={<><span className="rm-meta pt-mono" title="The film's length now, and the length it is aiming for">{filmMeta(data.ratio, data.lengthS, data.targetS)}</span>
          {room === 'edit' && !sound && <span ref={setViewSlot} className="rm-bandview" />}</>}
        right={<>
          {room === 'edit' && !sound ? <span ref={setToolSlot} className="rm-bandtools" /> : <JobsPill data={data} />}
          <button type="button" className={`sp-btn rm-sound-btn ${sound ? 'on' : ''}`} aria-pressed={sound} onClick={() => setSound(!sound)} title="Open Sound" aria-label="Open Sound">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6v4h3l4 3V3L5 6H2z M11.5 5.5a3.5 3.5 0 0 1 0 5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
            <span className="rm-soundword">Open Sound</span>
          </button>
        </>}
        primary={room === 'make'
          ? <button type="button" className="btn primary rm-primary" onClick={() => setRoom('edit')}>Go to Edit</button>
          : <RenderAd data={data} />} />
      {sound ? (
        <div className="rm-sound">
          <div className="rm-soundhead"><button type="button" className="btn" onClick={() => setSound(false)}>‹ Back to the picture</button></div>
          <SoundView shots={shots} />
        </div>
      ) : (
        <div className="booth-row">
          <div className="rm-main">
          <RoomWaits room={room} data={data} sel={sel} change={room === 'make' ? change : null} onChange={openChange}
            done={room === 'make' ? done : null} onUndo={() => { setDone(null); void undo(docStore) }}
            onApart={(shotId) => void takeShotOut(docStore, data.videoId, shotId).then(() => { setChange(null); setSel({ shotId }) })}
            onReady={(clipId, takeId) => setReady((r) => ({ clipId, takeId, n: (r?.n ?? 0) + 1 }))} />
          <div className="rm-body" data-room={room}>
            <Bin data={data} sel={sel} room={room} onPick={(g) => setSel((s) => ({ ...s, genId: g.id, boxKey: g.boxKey, shotId: g.shotIds.includes(s.shotId ?? '') ? s.shotId : g.shotIds[0] }))} />
            {room === 'make'
              ? <MakeRoom data={data} shots={shots} sel={sel} onSel={setSel} change={change} onChange={openChange} onCloseChange={() => setChange(null)} onRoom={setRoom} register={register}
                  onDone={(text) => setDone((d) => ({ id: (d?.id ?? 0) + 1, text }))} slot={slot} />
              : <EditRoom data={data} sel={sel} onSel={setSel} onChange={openChange} onSound={() => setSound(true)} register={register} ready={ready}
                  picked={picked} onPicked={setPicked} booth={change ? null : slot} viewSlot={viewSlot} toolSlot={toolSlot} />}
          </div>
          </div>
          {/* The Booth on a selection only (the Booth rule): the Make room's Box | Shot | Change panel goes in it. */}
          <RoomBooth room={room} data={data} sel={sel} change={change} onChange={openChange} slot={setSlot} picked={picked}
            onClose={() => { setSel({}); setChange(null); setPicked(null) }}
            onApart={(shotId) => void takeShotOut(docStore, data.videoId, shotId).then(() => { setChange(null); setSel({ shotId }) })}
            onReady={(clipId, takeId) => setReady((r) => ({ clipId, takeId, n: (r?.n ?? 0) + 1 }))} />
        </div>
      )}
      {/* A change asked from a clip (Change this…, Change the feel…, Change this part…) is the Booth's, in place of the clip's panel. */}
      {room === 'edit' && change && !sound && slot && createPortal(
        <ChangeDrawer data={data} open={change} onClose={() => setChange(null)} variant="tab"
          onMade={() => setChange(null)} onApart={(shotId) => { setChange(null); void takeShotOut(docStore, video!.id, shotId).then(() => { setSel({ shotId }); setRoom('make') }) }} />, slot)}
    </div>
  )
}

/** The takes being made, in plain states. No prices: credits are only in History. */
function JobsPill({ data }: { data: RoomData }) {
  void data
  const doc = useDoc()
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  // Everything being made — frames AND clips — read from the document's active jobs, the same source the
  // crew status line reads, so the pill and that line always agree. The old pill counted only clip takes
  // in state 'making', so a queued clip (or a frame job, which the frame-first flow now makes) showed as
  // "Nothing is being made" while a clip was in fact starting (owner 2026-11-04).
  const active = jobsList(doc).filter((j) => isActive(j.state))
  const n = active.length
  const lineOf = (j: (typeof active)[number]) => {
    const shotId = j.node.kind === 'shot' ? j.node.id : undefined
    return whoIsWorking(j, j.state, purposeOf(j) ?? undefined, shotId ? shotNumber(doc, shotId) || undefined : undefined).line
  }
  const word = jobWord
  return (
    <>
      <button ref={ref} type="button" className={`sp-btn rm-jobs ${n ? 'busy' : ''}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}
        title={n ? `${n} being made` : 'Nothing is being made'}>
        <span className="rm-jobdot" aria-hidden="true" />
        {n ? `${n} making` : 'Nothing making'}
      </button>
      <Float anchor={ref} open={open} onClose={close} role="dialog" label="Being made" align="end" className="rm-jobsfloat">
        <div className="rm-floathead">Being made</div>
        {active.map((j) => (
          <div key={j.id} className="rm-jobrow">
            <span className="rm-clamp1" title={lineOf(j)}>{lineOf(j)}</span>
            <span className="rm-pill">{word(j.state)}</span>
          </div>
        ))}
        {!n && <p className="rm-note">Nothing is being made.</p>}
        <p className="rm-note">Sending, Making, Checking, then Ready. Finished takes land in the Bin.</p>
      </Float>
    </>
  )
}
