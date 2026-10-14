// The boards on the canvas (mock Main; ui-behaviour 3.2, 3.3): each board a frame with its title, the
// picture boards wrapping their pictures, and the Script, Storyboard and Video boards holding their node
// cards, with the drives and renders links between them. Drawn over the canvas from the document and
// the scene's boxes (boards.ts boardFrames), positioned by the view: engine-neutral, nothing written to
// the scene. art-boards and canvas-nodes will make these real frames and nodes.

import type { CSSProperties, ReactNode } from 'react'
import { useDoc, useJobsTick, useUi } from '../../app/context'
import type { Shot } from '../../contracts/types'
import { cameraLabel } from '../../jobs/frameEdit'
import { isRunning, jobAt } from '../../jobs/select'
import { beatsOf, currentFrame, currentRender, currentTake, mainScript, mainStoryboard, scenesOf, shotsOf, staleList } from '../../model/selectors'
import { AgentFigure } from '../../ui/agents/AgentFigure'
import { NodeIcon } from '../../ui/chrome/Bar'
import { nodeTitle } from '../../ui/chrome/panels'
import { useProjectName } from '../../ui/useDownload'
import { useBlobUrl } from '../../ui/hooks'
import { NapkinLoader } from '../../ui/loader/NapkinLoader'
import type { BoardFrame } from './boards'
import type { Pt } from '../core/canvasAdapter'

/** @names in blue (mock Main). */
const withRefs = (t: string): ReactNode[] => t.split(/(@[a-z][a-z0-9_]*)/g).map((p, i) => (p.startsWith('@') ? <span key={i} className="pt-mention">{p}</span> : p))
const cap = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1)
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s)

export function BoardsLayer({ part, frames, toView, zoom, current, onOpen }: {
  /** 'frames' draws the boards behind the canvas (pictures sit on them); 'cards' the node cards over it. */
  part: 'frames' | 'cards'
  frames: BoardFrame[]
  toView: (p: Pt) => Pt
  zoom: number
  current: string | null
  onOpen: (editor: 'script' | 'storyboard' | 'video') => void
}) {
  useJobsTick()
  const at = (f: BoardFrame): CSSProperties => {
    const p = toView({ x: f.rect.x, y: f.rect.y })
    return { left: p.x, top: p.y, width: f.rect.w, height: f.rect.h, transform: `scale(${zoom})` }
  }
  const byId = new Map(frames.map((f) => [f.id, f]))
  const script = byId.get('script')
  const story = byId.get('storyboard')
  const video = byId.get('video')
  const link = (from: Pt, to: Pt, label?: string) => {
    const a = toView(from)
    const b = toView(to)
    return { a, b, label }
  }
  const links = [
    script && story ? link({ x: script.rect.x + script.rect.w / 2, y: script.rect.y + script.rect.h }, { x: script.rect.x + script.rect.w / 2, y: story.rect.y }, 'drives') : null,
    story && video ? link({ x: story.rect.x + story.rect.w, y: story.rect.y + story.rect.h / 2 }, { x: video.rect.x, y: video.rect.y + video.rect.h / 2 }) : null,
  ].filter((l): l is NonNullable<typeof l> => !!l)
  return (
    <div className={`boards-layer ${part}`}>
      {part === 'frames' && <svg className="bl-links" aria-hidden="true">
        {links.map((l, i) => {
          const down = Math.abs(l.b.x - l.a.x) < 1
          const head = down ? `M ${l.b.x - 6} ${l.b.y - 8} L ${l.b.x} ${l.b.y} L ${l.b.x + 6} ${l.b.y - 8}` : `M ${l.b.x - 8} ${l.b.y - 6} L ${l.b.x} ${l.b.y} L ${l.b.x - 8} ${l.b.y + 6}`
          return <g key={i}><path d={`M ${l.a.x} ${l.a.y} L ${l.b.x} ${l.b.y}`} /><path d={head} /></g>
        })}
      </svg>}
      {part === 'frames' && links.filter((l) => l.label).map((l, i) => (
        <span key={i} className="bl-linklabel" style={{ left: l.a.x + 10, top: (l.a.y + l.b.y) / 2 - 10 }}>{l.label}</span>
      ))}
      {frames.map((f) => part === 'frames' ? (
        <section key={f.id} className={`bl-board ${current === f.id ? 'current' : ''}`} style={at(f)} aria-label={`${f.title} board`}>
          <span className="bl-title">{f.title}</span>
        </section>
      ) : f.holds !== 'pictures' && (
        <div key={f.id} className="bl-cardbox" style={at(f)}>
          {f.holds === 'script' && <ScriptCard onOpen={() => onOpen('script')} />}
          {f.holds === 'storyboard' && <StoryboardCard onOpen={() => onOpen('storyboard')} />}
          {f.holds === 'video' && <VideoCard onOpen={() => onOpen('video')} />}
        </div>
      ))}
    </div>
  )
}

function Card({ icon, title, meta, extra, onOpen, children, style }: { icon: 'script' | 'storyboard' | 'video'; title: string; meta?: ReactNode; extra?: ReactNode; onOpen: () => void; children: ReactNode; style?: CSSProperties }) {
  return (
    <article className="bl-card" style={style}>
      <div className="bl-cardhead">
        <NodeIcon kind={icon} />
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
function AtWork({ line, warm = false, agent }: { line: string; warm?: boolean; agent: 'dex' | 'skye' | 'wren' | 'edie' }) {
  return (
    <div className={`bl-atwork ${warm ? 'warm' : ''}`} role="status">
      <AgentFigure agent={agent} state="working" size={24} decorative />
      <NapkinLoader work={agent === 'dex' || agent === 'skye' ? 'plan' : agent === 'edie' ? 'produce' : 'create'} size={16} />
      <span>{line}</span>
    </div>
  )
}

function ScriptCard({ onOpen }: { onOpen: () => void }) {
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
    <Card icon="script" title={`Script · ${nodeTitle(script?.title, 'Script', project)}`} meta={<span className="pt-mono">{Math.round(script?.target_s ?? 15)} s</span>} onOpen={onOpen} style={{ height: 380 }}>
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

function StoryboardCard({ onOpen }: { onOpen: () => void }) {
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
    <Card icon="storyboard" title={`Storyboard · ${nodeTitle(sb?.title, 'Storyboard', project)}`}
      meta={<span className="pt-mono">{sb?.ratio ?? '16:9'} · {shots.length} shots · {Math.round(total)} s</span>}
      extra={behind ? <span className="pt-pill warn">{behind} behind the script</span> : undefined} onOpen={onOpen} style={{ height: 194 }}>
      {shots.length ? (
        <div className="bl-strip">
          {shots.slice(0, 6).map((s, i) => <FrameTile key={s.id} shot={s} n={i + 1} drawing={i === drawingIdx} />)}
        </div>
      ) : <p className="bl-excerpt faint">No shots yet · write the script, then plan shots.</p>}
      {planning ? <AtWork agent="dex" line="Dex is planning the shots from the script" />
        : shots.length ? (
          <div className="bl-line"><AgentFigure agent="dex" size={24} decorative /><span>Dex planned {shots.length} shots from the script{drawingIdx >= 0 ? ` · frame ${drawingIdx + 1} is being drawn` : ''}</span></div>
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

function VideoCard({ onOpen }: { onOpen: () => void }) {
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
    <Card icon="video" title={`Video · ${nodeTitle(mainStoryboard(doc)?.title, 'Storyboard', project)}`} onOpen={onOpen} style={{ height: 194 }}>
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
