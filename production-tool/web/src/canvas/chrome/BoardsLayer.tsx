// The boards on the canvas (mock Main; ui-behaviour 3.2, 3.3): each board a frame with its title, the
// picture boards wrapping their pictures, and the Script, Storyboard and Video boards holding their node
// cards, with the drives and renders links between them. Drawn over the canvas from the document and
// the scene's boxes (boards.ts boardFrames), positioned by the view, nothing written to the scene.
// Only on Excalidraw: on our own engine the boards are real frames (canvas/boards) and the nodes real
// elements (canvas/nodes). The cards are the shared ones (canvas/nodes/cards.tsx), so both engines draw
// the same card; the stage provides the chrome they borrow (cardChrome.ts).

import type { CSSProperties } from 'react'
import { useJobsTick } from '../../app/context'
import { NodeCard } from '../nodes/cards'
import type { BoardFrame } from './boards'
import type { Pt } from '../core/canvasAdapter'

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
          <NodeCard kind={f.holds} onOpen={() => onOpen(f.holds as 'script' | 'storyboard' | 'video')} />
        </div>
      ))}
    </div>
  )
}
