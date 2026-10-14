// The node cards (features/canvas-nodes.clan; ui-behaviour 3.3): Script, Storyboard
// and Video, as feat/production-ui drew them in its static boards overlay
// (canvas/chrome/BoardsLayer.tsx), moved here so the own engine's node slots and
// that overlay render the same cards. Same markup and classes (bl-*); the chrome's
// node icon, title rule, loader and agent figures come from CardChromeContext
// (cardChrome.ts), which the chrome provides (this file imports no chrome), with
// plain defaults.

import { useContext, type CSSProperties, type ReactNode } from 'react'
import { useDoc, useJobsTick, useUi } from '../../app/context'
import type { Shot } from '../../contracts/types'
import { cameraLabel } from '../../jobs/frameEdit'
import { isRunning, jobAt } from '../../jobs/select'
import { beatsOf, currentFrame, currentRender, currentTake, mainScript, mainStoryboard, scenesOf, shotsOf, staleList } from '../../model/selectors'
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

export function ScriptCard({ onOpen }: { onOpen: () => void }) {
  useJobsTick()
  const chrome = useContext(CardChromeContext)
  const doc = useDoc()
  const ui = useUi()
  const script = mainScript(doc)
  const project = useProjectName()
  const shots = shotsOf(doc)
  const scenes = scenesOf(doc)
  const writing = isRunning(doc, jobAt(doc, ui, (c) => c.for === 'write'))
  const sound = (s: Shot) => beatsOf(doc, s.id).filter((b) => b.kind !== 'moment' && b.kind !== 'camera')
    .map((b) => (b.kind === 'line' || b.kind === 'vo' ? `${b.kind === 'vo' ? 'VO: ' : b.speaker ? `${cap(b.speaker.toLowerCase())}: ` : ''}"${b.text ?? ''}"` : b.text ?? '')).filter(Boolean).join(' ')
  const words = scenes.map((s) => s.text ?? '').join(' ').trim()
  return (
    <Card icon="script" title={`Script · ${chrome.title(script?.title, 'Script', project)}`} meta={<span className="pt-mono">{Math.round(script?.target_s ?? 15)} s</span>} onOpen={onOpen} style={{ height: 380 }}>
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
        <p className={`bl-excerpt ${words ? '' : 'faint'}`}>{words ? withRefs(short(words, 260)) : 'No script yet · write it, or paste one in.'}</p>
      )}
      <span className="bl-meta">{scenes.length} {scenes.length === 1 ? 'scene' : 'scenes'} · {shots.length} {shots.length === 1 ? 'shot' : 'shots'}</span>
      <span className="pt-grow" />
      {writing && <AtWork agent="skye" line="Skye is writing a draft" />}
    </Card>
  )
}

export function StoryboardCard({ onOpen }: { onOpen: () => void }) {
  useJobsTick()
  const chrome = useContext(CardChromeContext)
  const doc = useDoc()
  const ui = useUi()
  const sb = mainStoryboard(doc)
  const project = useProjectName()
  const shots = shotsOf(doc)
  const total = shots.reduce((a, s) => a + s.duration_s, 0)
  const behind = staleList(doc).filter((m) => m.target.kind === 'frame' || m.target.kind === 'shot').length
  const planning = isRunning(doc, jobAt(doc, ui, (c) => c.for === 'shot_list'))
  const drawingIdx = shots.findIndex((s) => isRunning(doc, jobAt(doc, ui, (c) => c.for === 'frame' && c.shotId === s.id)))
  return (
    <Card icon="storyboard" title={`Storyboard · ${chrome.title(sb?.title, 'Storyboard', project)}`}
      meta={<span className="pt-mono">{sb?.ratio ?? '16:9'} · {shots.length} shots · {Math.round(total)} s</span>}
      extra={behind ? <span className="pt-pill warn">{behind} behind the script</span> : undefined} onOpen={onOpen} style={{ height: 194 }}>
      {shots.length ? (
        <div className="bl-strip">
          {shots.slice(0, 6).map((s, i) => <FrameTile key={s.id} shot={s} n={i + 1} drawing={i === drawingIdx} />)}
        </div>
      ) : <p className="bl-excerpt faint">No shots yet · write the script, then plan shots.</p>}
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

export function VideoCard({ onOpen }: { onOpen: () => void }) {
  useJobsTick()
  const chrome = useContext(CardChromeContext)
  const doc = useDoc()
  const ui = useUi()
  const project = useProjectName()
  const shots = shotsOf(doc)
  const ready = shots.filter((s) => !!currentTake(doc, s.id)).length
  const render = currentRender(doc)
  const poster = render ? undefined : shots.map((s) => currentFrame(doc, s)?.asset).find(Boolean)
  const url = useBlobUrl(poster)
  const adUrl = useBlobUrl(render?.asset)
  const clipRunning = shots.map((s, i) => ({ i, on: isRunning(doc, jobAt(doc, ui, (c) => c.for === 'clip' && c.shotId === s.id)) })).find((x) => x.on)
  const total = shots.reduce((a, s) => a + s.duration_s, 0)
  return (
    <Card icon="video" title={`Video · ${chrome.title(mainStoryboard(doc)?.title, 'Storyboard', project)}`} onOpen={onOpen} style={{ height: 194 }}>
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
      {clipRunning && <AtWork agent="wren" warm line={`Wren is rendering clip ${clipRunning.i + 1}`} />}
    </Card>
  )
}

/** The card for a node kind. */
export function NodeCard({ kind, onOpen }: { kind: CardKind; onOpen: () => void }) {
  if (kind === 'script') return <ScriptCard onOpen={onOpen} />
  if (kind === 'storyboard') return <StoryboardCard onOpen={onOpen} />
  return <VideoCard onOpen={onOpen} />
}
