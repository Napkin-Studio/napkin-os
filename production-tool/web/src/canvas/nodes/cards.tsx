// The node cards (features/canvas-nodes.clan; ui-behaviour 3.3): Script, Storyboard
// and Video, as feat/production-ui drew them in its static boards overlay
// (canvas/chrome/BoardsLayer.tsx), moved here so the own engine's node slots and
// that overlay render the same cards. Same markup and classes (bl-*); the chrome's
// node icon, title rule, loader and agent figures come from CardChromeContext
// (cardChrome.ts), which the chrome provides (this file imports no chrome), with
// plain defaults.

import { useContext, useState, type CSSProperties, type ReactNode } from 'react'
import { useDoc, useJobsTick, useServices, useUi } from '../../app/context'
import { discardDraft, keep as keepDraft } from '../../script/skye'
import { draftLines } from '../../script/skyeBooth'
import { cameraLabel } from '../../jobs/frameEdit'
import { askOf } from '../../jobs/runner'
import { isRunning, jobAt } from '../../jobs/select'
import { beatsOf, currentFrame, currentRender, currentTake, mainScript, mainStoryboard, mainVideo, scenesOf, shotsOf, staleList, storyboardOfScript, storyboardOfVideo } from '../../model/selectors'
import type { ProductionDocument, Shot, Suggestion } from '../../contracts/types'
import { InputsStrip } from '../../stages/InputsStrip'
import { isEmptyNode } from './nodes'
import { waitsOnScriptAsk } from '../../jobs/scriptVideo'
import { CardChromeContext, type Agent, type CardKind } from './cardChrome'
import { useBlobUrl } from '../../ui/hooks'
import { useProjectName } from '../../ui/useDownload'
import { shotsWords } from '../../jobs/runs'
import { plannedLine, stripOf } from './strip'

/** @names in blue (mock Main). */
const withRefs = (t: string): ReactNode[] => t.split(/(@[a-z][a-z0-9_]*)/g).map((p, i) => (p.startsWith('@') ? <span key={i} className="pt-mention">{p}</span> : p))
const cap = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1)
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s)

/** A node card as the mock draws it (production-new-ui-v2 .node): a head of icon, what it is, "· its name" in small
 *  caps and its facts on the right; the body; its inputs as chips at the foot. No Open in the head on our own
 *  engine: a click selects it, and the selection bar's Open (or a double-click) opens it. The Excalidraw
 *  fallback's overlay keeps Open (`openButton`), since its cards cannot be selected. */
export function Card({ icon, kind, name, meta, extra, inputs, tag, onOpen, openButton = false, children, style, className = '' }: {
  icon: CardKind; kind: string; name?: string; meta?: ReactNode; extra?: ReactNode; inputs?: ReactNode
  /** An agent's question waits on this node: the amber tag on its edge ("Needs your call"; mock "ask"). */
  tag?: string
  onOpen: () => void; openButton?: boolean; children: ReactNode; style?: CSSProperties; className?: string
}) {
  const chrome = useContext(CardChromeContext)
  return (
    <article className={`bl-card ${tag ? 'needs' : ''} ${className}`} style={style}>
      {tag && <span className="paper-tag" role="status">{tag}</span>}
      <div className="bl-cardhead">
        {chrome.icon(icon)}
        <b title={name ? `${kind} · ${name}` : kind}>{kind}</b>
        {name && <span className="bl-kind">· {name}</span>}
        {extra}
        <span className="pt-grow" />
        {meta && <span className="bl-r">{meta}</span>}
        {openButton && <button type="button" className="btn sm" onClick={onOpen}>Open</button>}
      </div>
      <div className="bl-nb">{children}</div>
      {inputs && <div className="bl-ins">{inputs}</div>}
    </article>
  )
}

/** Who is at work on a node: their figure working and one signed line (ui-behaviour 3.3 Running, 6.5). */
/** The new UI keeps the agents in one place (the bar's job chip): the node only fills in place, with this
 *  one plain line saying what is happening to it (and who, by role). `agent` stays for the role's words. */
export function AtWork({ line, warm = false }: { line: string; warm?: boolean; agent: Agent }) {
  return (
    <div className={`bl-atwork ${warm ? 'warm' : ''}`} role="status">
      <span>{line}</span>
    </div>
  )
}

/** Is a job of this op running on this node (the document's jobs[id].node)? */
const runningOn = (doc: ProductionDocument, op: string, kind: string, id: string | undefined) =>
  !!id && Object.values(doc.jobs ?? {}).some((j) => j.op === op && j.node?.kind === kind && j.node.id === id && isRunning(doc, j.id))

/** The chrome's prompt start for an empty node, if it lends one; else `fallback`. */
function Start({ kind, id, fallback }: { kind: CardKind; id: string | undefined; fallback: ReactNode }) {
  const chrome = useContext(CardChromeContext)
  const doc = useDoc()
  if (!id || !chrome.PromptStart || !isEmptyNode(doc, kind, id)) return <>{fallback}</>
  return <div className="bl-start">{chrome.PromptStart({ kind, nodeId: id })}</div>
}

/** `id`: the node's document entity; absent, the project's main one (the Excalidraw overlay). */
export function ScriptCard({ id, onOpen, openButton }: { id?: string; onOpen: () => void; openButton?: boolean }) {
  useJobsTick()
  const chrome = useContext(CardChromeContext)
  const doc = useDoc()
  const ui = useUi()
  const script = id ? doc.scripts[id] : mainScript(doc)
  const project = useProjectName()
  const sb = storyboardOfScript(doc, script?.id)
  const shots = sb ? shotsOf(doc, sb.id) : []
  const scenes = scenesOf(doc, script?.id)
  const main = mainScript(doc)?.id
  const writeJob = jobAt(doc, ui, (c) => c.for === 'write' && (c.scriptId ?? main) === script?.id)
  // A draft waiting on the person's answer is not being written (owner 2026-10-15): its question shows instead.
  const asking = writeJob && doc.jobs[writeJob]?.state === 'needs_input' ? askOf(doc, writeJob) : undefined
  const waiting = !!writeJob && doc.jobs[writeJob]?.state === 'needs_input'
  const writing = isRunning(doc, writeJob) && !waiting
  const sound = (s: Shot) => beatsOf(doc, s.id).filter((b) => b.kind !== 'moment' && b.kind !== 'camera')
    .map((b) => (b.kind === 'line' || b.kind === 'vo' ? `${b.kind === 'vo' ? 'VO: ' : b.speaker ? `${cap(b.speaker.toLowerCase())}: ` : ''}"${b.text ?? ''}"` : b.text ?? '')).filter(Boolean).join(' ')
  const words = scenes.map((s) => s.text ?? '').join(' ').trim()
  // The Script agent's draft fills in place on the node (owner 2026-11-18; mock canvas-filling): Keep or Discard here.
  const sceneIds = new Set(scenes.map((s) => s.id))
  const draft = Object.values(doc.suggestions ?? {}).find((s) => s.state === 'open' && s.mode === 'draft' && s.target.kind === 'scene' && sceneIds.has(s.target.id))
  return (
    <Card icon="script" kind="Script" name={chrome.title(script?.title, 'Script', project)} meta={`${Math.round(script?.target_s ?? 15)} s`} onOpen={onOpen} openButton={openButton}
      className={writing ? 'writing' : ''} tag={waiting ? 'Needs your call' : undefined} inputs={<InputsStrip nodeId={script?.id} />} style={{ height: 380 }}>
      {draft ? <DraftOnNode sug={draft} /> : shots.length ? (
        <div className="bl-av">
          <span className="bl-avhead">Video</span><span className="bl-avhead">Audio</span>
          {shots.slice(0, 3).map((s) => (
            <span key={s.id} style={{ display: 'contents' }}>
              <span className="bl-avcell">{withRefs(short(s.action ?? '', 90))}</span>
              <span className="bl-avcell muted">{short(sound(s), 70)}</span>
            </span>
          ))}
        </div>
      ) : (
        <Start kind="script" id={script?.id} fallback={
          <p className={`bl-excerpt ${words ? '' : 'faint'}`}>{words ? withRefs(short(words, 260)) : 'No script yet · write it, or paste one in.'}</p>
        } />
      )}
      <span className="bl-meta">{scenes.length} {scenes.length === 1 ? 'scene' : 'scenes'} · {shots.length} {shots.length === 1 ? 'shot' : 'shots'}</span>
      <span className="pt-grow" />
      {writing && <AtWork agent="skye" line="The Script agent is writing a draft" />}
      {waiting && <AtWork agent="skye" warm line={`Waiting for you: ${asking?.question.text ?? 'The Script agent has a question about a draft'}`} />}
    </Card>
  )
}

export function StoryboardCard({ id, onOpen, openButton }: { id?: string; onOpen: () => void; openButton?: boolean }) {
  useJobsTick()
  const chrome = useContext(CardChromeContext)
  const doc = useDoc()
  const ui = useUi()
  const sb = id ? doc.storyboards[id] : mainStoryboard(doc)
  const project = useProjectName()
  const shots = sb ? shotsOf(doc, sb.id) : []
  const mine = new Set(shots.map((s) => s.id))
  const total = shots.reduce((a, s) => a + s.duration_s, 0)
  const behind = staleList(doc).filter((m) => (m.target.kind === 'frame' && mine.has(doc.frames[m.target.id]?.shot_id ?? '')) || (m.target.kind === 'shot' && mine.has(m.target.id))).length
  const planning = runningOn(doc, 'shot_list', 'storyboard', sb?.id)
  const drawingIdx = shots.findIndex((s) => isRunning(doc, jobAt(doc, ui, (c) => c.for === 'frame' && c.shotId === s.id)))
  const strip = stripOf(shots.length)
  // Its own name when it has one ("Cut-down · 9:16"); the main one is "Storyboard · 16:9" (mock).
  const own = sb?.title?.trim() && sb.title.trim() !== 'Storyboard' && !/^untitled/i.test(sb.title.trim()) ? sb.title.trim() : undefined
  return (
    <Card icon="storyboard" kind="Storyboard" name={own ? `${chrome.title(own, 'Storyboard', project)} · ${sb?.ratio ?? '16:9'}` : sb?.ratio ?? '16:9'}
      meta={drawingIdx >= 0 ? `drawing frame ${drawingIdx + 1} of ${shots.length}` : `${shots.length} shots · ${Math.round(total)} s`}
      extra={behind ? <span className="pt-pill warn">{behind} behind the script</span> : undefined} onOpen={onOpen} openButton={openButton}
      className={planning || drawingIdx >= 0 ? 'writing' : ''} inputs={<InputsStrip nodeId={sb?.id} />} style={{ height: 194 }}>
      {shots.length ? (
        <div className="bl-strip">
          {shots.slice(0, strip.shown).map((s, i) => <FrameTile key={s.id} shot={s} n={i + 1} drawing={i === drawingIdx} />)}
          {strip.more > 0 && <figure className="bl-frame bl-more" title={`${strip.more} more shots: open the Storyboard to see them all`}><span className="bl-noframe">+{strip.more}</span><figcaption>more</figcaption></figure>}
        </div>
      ) : <Start kind="storyboard" id={sb?.id} fallback={<p className="bl-excerpt faint">No shots yet · write the script, then plan shots.</p>} />}
      {planning ? <AtWork agent="dex" line="The Director agent is planning the shots from the script" />
        : shots.length ? <span className="bl-meta">{plannedLine(shots)}</span> : null}
    </Card>
  )
}

function FrameTile({ shot, n, drawing }: { shot: Shot; n: number; drawing: boolean }) {
  const doc = useDoc()
  const url = useBlobUrl(currentFrame(doc, shot)?.asset)
  return (
    <figure className="bl-frame">
      {/* A frame being drawn shows the Camera agent at work, never the loader (ui-behaviour 6.5). */}
      {url && !drawing ? <img src={url} alt="" /> : <span className={`bl-noframe ${drawing ? 'run' : ''}`} aria-label={drawing ? 'The Camera agent is drawing this frame' : undefined}>{drawing ? '' : 'No frame yet'}</span>}
      <figcaption>{n} · {drawing ? 'drawing' : cap(cameraLabel('size', shot.camera.size))}</figcaption>
    </figure>
  )
}

export function VideoCard({ id, onOpen, openButton }: { id?: string; onOpen: () => void; openButton?: boolean }) {
  useJobsTick()
  const chrome = useContext(CardChromeContext)
  const doc = useDoc()
  const ui = useUi()
  const project = useProjectName()
  const video = id ? doc.videos[id] : mainVideo(doc)
  const sb = storyboardOfVideo(doc, video?.id)
  const shots = sb ? shotsOf(doc, sb.id) : []
  const ready = shots.filter((s) => !!currentTake(doc, s.id, video?.id)).length
  const render = video ? currentRender(doc, video.id) : undefined
  const poster = render ? undefined : shots.map((s) => currentFrame(doc, s)?.asset).find(Boolean)
  const url = useBlobUrl(poster)
  const adUrl = useBlobUrl(render?.asset)
  const clipRunning = shots.map((s, i) => ({ i, on: isRunning(doc, jobAt(doc, ui, (c) => c.for === 'clip' && c.shotId === s.id)) })).find((x) => x.on)
  // One take of several shots (features/connected-video.clan): "shots 2-5".
  const take = Object.values(video?.runs ?? {}).find((r) => r.job_id && isRunning(doc, r.job_id))
  const takeRunning = take ? shotsWords(doc, take.shot_ids) : undefined
  const total = shots.reduce((a, s) => a + s.duration_s, 0)
  // The main video is named after its storyboard (mock Main); another after its own title.
  // A video's own shot list (implicit, made straight from the script) is not a storyboard with a name: it named
  // the card "Video · Video" while Dex planned (live test 2026-11-16).
  const title = sb && !sb.implicit && video?.id === mainVideo(doc)?.id ? chrome.title(sb.title, 'Storyboard', project) : chrome.title(video?.title, 'Film', project)
  // Dex planning this video's shots (straight from the script: on its own shot list, or on the video itself).
  const planning = !shots.length && (runningOn(doc, 'shot_list', 'storyboard', sb?.id) || runningOn(doc, 'shot_list', 'video', video?.id))
  // A video a script drives with no storyboard yet (mock Asks): "from Script · no storyboard".
  const fromScript = !sb && !!video && Object.values(doc.links ?? {}).some((l) => l.role === 'drives' && l.from.kind === 'script' && l.to.kind === 'video' && l.to.id === video.id)
  // Dex's ask on a video with no storyboard (3.17) is read whole: the card grows over what is below it.
  const asking = !planning && !!video && !!chrome.PromptStart && isEmptyNode(doc, 'video', video.id) && (!sb || !!waitsOnScriptAsk(doc, video.id))
  return (
    <Card icon="video" kind="Film" name={title} meta={fromScript ? 'from Script · no storyboard' : total ? `${total.toFixed(1)} s` : undefined} onOpen={onOpen} openButton={openButton}
      className={[asking ? 'asking' : '', planning || takeRunning || clipRunning ? 'writing' : ''].filter(Boolean).join(' ')}
      tag={asking ? 'Needs your call' : undefined} inputs={<InputsStrip nodeId={video?.id} />} style={asking ? { minHeight: 194 } : { height: 194 }}>
      {planning ? <AtWork agent="dex" line="The Director agent is planning the shots from the script" /> : <Start kind="video" id={video?.id} fallback={
        <div className="bl-videorow">
          <span className="bl-poster">
            {adUrl ? <video src={adUrl} muted preload="metadata" /> : url ? <img src={url} alt="" /> : null}
            <span className="bl-len">{`0:${String(Math.round(total)).padStart(2, '0')}`}</span>
          </span>
          <span className="bl-facts">
            <span>Clips {ready} of {shots.length} ready</span>
            <span>{render ? `Last ad render: v${render.version}` : 'No ad yet'}</span>
          </span>
        </div>
      } />}
      {takeRunning ? <AtWork agent="wren" warm line={`The Camera agent is filming ${takeRunning} as one take`} />
        : clipRunning && <AtWork agent="wren" warm line={`The Camera agent is filming clip ${clipRunning.i + 1}`} />}
    </Card>
  )
}

/** The card for a node: `id` is its document entity (absent: the main one of its kind). */
export function NodeCard({ kind, id, onOpen, openButton }: { kind: CardKind; id?: string; onOpen: () => void; openButton?: boolean }) {
  if (kind === 'script') return <ScriptCard id={id} onOpen={onOpen} openButton={openButton} />
  if (kind === 'storyboard') return <StoryboardCard id={id} onOpen={onOpen} openButton={openButton} />
  return <VideoCard id={id} onOpen={onOpen} openButton={openButton} />
}

/** The Script agent's draft on the Script node, filling in place, with Keep and Discard (script/skye.ts keep,
 *  discardDraft): nothing lands on the script until Keep. */
function DraftOnNode({ sug }: { sug: Suggestion }) {
  const doc = useDoc()
  const { clan } = useServices()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lines = draftLines(doc, sug).lines.map((l) => l.text).filter(Boolean)
  const act = (fn: () => Promise<unknown>) => async () => {
    if (!clan) return
    setBusy(true)
    setError(null)
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : 'That did not work.') } finally { setBusy(false) }
  }
  const stop = (e: React.PointerEvent) => e.stopPropagation()
  return (
    <div className="bl-draft" data-suggestion={sug.id}>
      <span className="bl-draft-hd">Script agent · draft</span>
      <p className="bl-excerpt">{withRefs(short(lines.join(' '), 300))}</p>
      <span className="bl-draft-acts">
        <button type="button" className="k" disabled={busy || !clan} onPointerDown={stop} onClick={act(() => keepDraft(clan!, sug.id))}>Keep</button>
        <button type="button" disabled={busy || !clan} onPointerDown={stop} onClick={act(() => discardDraft(clan!, sug.id))}>Discard</button>
      </span>
      {error && <span className="bl-draft-err" role="alert">{error}</span>}
    </div>
  )
}
