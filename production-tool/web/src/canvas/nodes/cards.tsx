// The node cards (features/canvas-nodes.clan; ui-behaviour 3.3): Script, Storyboard
// and Video, as feat/production-ui drew them in its static boards overlay
// (canvas/chrome/BoardsLayer.tsx), moved here so the own engine's node slots and
// that overlay render the same cards. Same markup and classes (bl-*); the chrome's
// node icon, title rule, loader and agent figures come from CardChromeContext
// (cardChrome.ts), which the chrome provides (this file imports no chrome), with
// plain defaults.

import { useContext, type CSSProperties, type ReactNode } from 'react'
import { useDoc, useJobsTick, useUi } from '../../app/context'
import { cameraLabel } from '../../jobs/frameEdit'
import { isRunning, jobAt } from '../../jobs/select'
import { beatsOf, currentFrame, currentRender, currentTake, mainScript, mainStoryboard, mainVideo, scenesOf, shotsOf, staleList, storyboardOfScript, storyboardOfVideo } from '../../model/selectors'
import type { ProductionDocument, Shot } from '../../contracts/types'
import { InputsStrip } from '../../stages/InputsStrip'
import { isEmptyNode } from './nodes'
import { CardChromeContext, type Agent, type CardKind } from './cardChrome'
import { useBlobUrl } from '../../ui/hooks'
import { useProjectName } from '../../ui/useDownload'

/** @names in blue (mock Main). */
const withRefs = (t: string): ReactNode[] => t.split(/(@[a-z][a-z0-9_]*)/g).map((p, i) => (p.startsWith('@') ? <span key={i} className="pt-mention">{p}</span> : p))
const cap = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1)
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s)

export function Card({ icon, title, meta, extra, onOpen, children, style }: { icon: CardKind; title: string; meta?: ReactNode; extra?: ReactNode; onOpen: () => void; children: ReactNode; style?: CSSProperties }) {
  const chrome = useContext(CardChromeContext)
  return (
    <article className="bl-card" style={style}>
      <div className="bl-cardhead">
        {chrome.icon(icon)}
        <b>{title}</b>
        {meta}
        <span className="pt-grow" />
        {extra}
        <button type="button" className="btn sm" onClick={onOpen}>Open</button>
      </div>
      {children}
    </article>
  )
}

/** Who is at work on a node, in one signed line with the loader (ui-behaviour 3.3 Running). */
export function AtWork({ line, warm = false, agent }: { line: string; warm?: boolean; agent: Agent }) {
  const chrome = useContext(CardChromeContext)
  return (
    <div className={`bl-atwork ${warm ? 'warm' : ''}`} role="status">
      {chrome.agent(agent, true)}
      {chrome.loader(agent === 'dex' || agent === 'skye' ? 'plan' : agent === 'edie' ? 'produce' : 'create')}
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
export function ScriptCard({ id, onOpen }: { id?: string; onOpen: () => void }) {
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
  const writing = isRunning(doc, jobAt(doc, ui, (c) => c.for === 'write' && (c.scriptId ?? main) === script?.id))
  const sound = (s: Shot) => beatsOf(doc, s.id).filter((b) => b.kind !== 'moment' && b.kind !== 'camera')
    .map((b) => (b.kind === 'line' || b.kind === 'vo' ? `${b.kind === 'vo' ? 'VO: ' : b.speaker ? `${cap(b.speaker.toLowerCase())}: ` : ''}"${b.text ?? ''}"` : b.text ?? '')).filter(Boolean).join(' ')
  const words = scenes.map((s) => s.text ?? '').join(' ').trim()
  return (
    <Card icon="script" title={`Script · ${chrome.title(script?.title, 'Script', project)}`} meta={<span className="pt-mono">{Math.round(script?.target_s ?? 15)} s</span>} onOpen={onOpen} style={{ height: 380 }}>
      <InputsStrip nodeId={script?.id} />
      {shots.length ? (
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
      {writing && <AtWork agent="skye" line="Skye is writing a draft" />}
    </Card>
  )
}

export function StoryboardCard({ id, onOpen }: { id?: string; onOpen: () => void }) {
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
  return (
    <Card icon="storyboard" title={`Storyboard · ${chrome.title(sb?.title, 'Storyboard', project)}`}
      meta={<span className="pt-mono">{sb?.ratio ?? '16:9'} · {shots.length} shots · {Math.round(total)} s</span>}
      extra={behind ? <span className="pt-pill warn">{behind} behind the script</span> : undefined} onOpen={onOpen} style={{ height: 194 }}>
      <InputsStrip nodeId={sb?.id} />
      {shots.length ? (
        <div className="bl-strip">
          {shots.slice(0, 6).map((s, i) => <FrameTile key={s.id} shot={s} n={i + 1} drawing={i === drawingIdx} />)}
        </div>
      ) : <Start kind="storyboard" id={sb?.id} fallback={<p className="bl-excerpt faint">No shots yet · write the script, then plan shots.</p>} />}
      {planning ? <AtWork agent="dex" line="Dex is planning the shots from the script" />
        : shots.length ? (
          <div className="bl-line">{chrome.agent('dex', false)}<span>Dex planned {shots.length} shots from the script{drawingIdx >= 0 ? ` · frame ${drawingIdx + 1} is being drawn` : ''}</span></div>
        ) : null}
    </Card>
  )
}

function FrameTile({ shot, n, drawing }: { shot: Shot; n: number; drawing: boolean }) {
  const doc = useDoc()
  const url = useBlobUrl(currentFrame(doc, shot)?.asset)
  return (
    <figure className="bl-frame">
      {url && !drawing ? <img src={url} alt="" /> : <span className="bl-noframe">{drawing ? 'Wren is drawing' : 'No frame yet'}</span>}
      <figcaption>{n} · {cap(cameraLabel('size', shot.camera.size))}</figcaption>
    </figure>
  )
}

export function VideoCard({ id, onOpen }: { id?: string; onOpen: () => void }) {
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
  const total = shots.reduce((a, s) => a + s.duration_s, 0)
  // The main video is named after its storyboard (mock Main); another after its own title.
  const title = sb && video?.id === mainVideo(doc)?.id ? chrome.title(sb.title, 'Storyboard', project) : chrome.title(video?.title, 'Video', project)
  return (
    <Card icon="video" title={`Video · ${title}`} onOpen={onOpen} style={{ height: 194 }}>
      <InputsStrip nodeId={video?.id} />
      <Start kind="video" id={video?.id} fallback={
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
      } />
      {clipRunning && <AtWork agent="wren" warm line={`Wren is rendering clip ${clipRunning.i + 1}`} />}
    </Card>
  )
}

/** The card for a node: `id` is its document entity (absent: the main one of its kind). */
export function NodeCard({ kind, id, onOpen }: { kind: CardKind; id?: string; onOpen: () => void }) {
  if (kind === 'script') return <ScriptCard id={id} onOpen={onOpen} />
  if (kind === 'storyboard') return <StoryboardCard id={id} onOpen={onOpen} />
  return <VideoCard id={id} onOpen={onOpen} />
}
