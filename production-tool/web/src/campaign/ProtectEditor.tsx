// "What must stay in every size": the picture with its boxes, and the list of them. Draw a box by dragging
// (or tap for one round the point); click a box to select it, drag it to move, drag a handle to resize;
// name it and set what it is in the list; Delete removes it. Used by Make all sizes and by the Campaign
// board's "What must stay" (changing it after the sizes are made).

import { useRef, useState } from 'react'
import type { ProtectBox } from '../contracts/types'
import { useBlobUrl } from '../ui/hooks'
import {
  dragBox, hitBox, HANDLES, isTap, labelOf, MAX_BOXES, moveBox, resizeBox, ROLE_WORD, tapBox, type Handle, type Role,
} from './protectBoxes'
import './campaign.css'

type Drag =
  | { kind: 'draw'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'move'; i: number; sx: number; sy: number; orig: ProtectBox }
  | { kind: 'resize'; i: number; handle: Handle; sx: number; sy: number; orig: ProtectBox }

export function ProtectEditor({ master, boxes, setBoxes }: {
  master: { asset?: string; w: number; h: number }
  boxes: ProtectBox[]
  setBoxes(b: ProtectBox[]): void
}) {
  const url = useBlobUrl(master.asset)
  const wrap = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [sel, setSel] = useState<number | null>(null)
  // What a new box is: the first is the subject, the next the product, then whatever else.
  const [role, setRole] = useState<Role>(boxes.some((b) => b.role === 'subject') ? 'product' : 'subject')
  const scale = Math.min(560 / master.w, 340 / master.h)
  const W = Math.round(master.w * scale)
  const H = Math.round(master.h * scale)
  const pic = { w: master.w, h: master.h }
  const full = boxes.length >= MAX_BOXES

  // A selection that points past the end (a box was removed) is no selection.
  const live = sel !== null && sel < boxes.length ? sel : null

  const at = (e: { clientX: number; clientY: number }) => {
    const r = wrap.current!.getBoundingClientRect()
    return { x: Math.min(Math.max(e.clientX - r.left, 0), W) / scale, y: Math.min(Math.max(e.clientY - r.top, 0), H) / scale }
  }
  const replace = (i: number, b: ProtectBox) => setBoxes(boxes.map((x, j) => (j === i ? b : x)))
  const remove = (i: number) => { setBoxes(boxes.filter((_, j) => j !== i)); setSel(null) }
  const add = (b: ProtectBox) => {
    if (full) return
    setBoxes([...boxes, b])
    setSel(boxes.length)
    if (b.role === 'subject') setRole('product')
  }

  const down = (e: React.PointerEvent) => {
    wrap.current?.focus()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const p = at(e)
    const i = hitBox(boxes, p.x, p.y)
    if (i >= 0) {
      setSel(i)
      setDrag({ kind: 'move', i, sx: p.x, sy: p.y, orig: boxes[i] })
    } else {
      setSel(null)
      setDrag({ kind: 'draw', x0: p.x, y0: p.y, x1: p.x, y1: p.y })
    }
  }
  const handleDown = (e: React.PointerEvent, i: number, handle: Handle) => {
    e.stopPropagation()
    wrap.current?.focus()
    wrap.current?.setPointerCapture?.(e.pointerId)
    const p = at(e)
    setSel(i)
    setDrag({ kind: 'resize', i, handle, sx: p.x, sy: p.y, orig: boxes[i] })
  }
  const moveTo = (e: React.PointerEvent) => {
    if (!drag) return
    const p = at(e)
    if (drag.kind === 'draw') setDrag({ ...drag, x1: p.x, y1: p.y })
    else if (drag.kind === 'move') replace(drag.i, moveBox(drag.orig, p.x - drag.sx, p.y - drag.sy, pic))
    else replace(drag.i, resizeBox(drag.orig, drag.handle, p.x - drag.sx, p.y - drag.sy, pic))
  }
  const up = () => {
    const d = drag
    setDrag(null)
    if (d?.kind !== 'draw') return
    if (isTap(pic, d.x0, d.y0, d.x1, d.y1, scale)) add(tapBox(pic, d.x0, d.y0, role))
    else add(dragBox(pic, d.x0, d.y0, d.x1, d.y1, role))
  }
  const key = (e: React.KeyboardEvent) => {
    if (live === null) return
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(live); return }
    if (e.key === 'Escape') { setSel(null); return }
    const step = Math.round(Math.min(pic.w, pic.h) * (e.shiftKey ? 0.05 : 0.01))
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
    if (!d) return
    e.preventDefault()
    replace(live, moveBox(boxes[live], d[0], d[1], pic))
  }

  const draft = drag?.kind === 'draw' ? drag : null
  return (
    <>
      <div className="cf-roles" role="radiogroup" aria-label="New boxes are">
        <span className="faint cf-rolelead">New box is</span>
        {(['subject', 'product', 'other'] as const).map((r) => (
          <button key={r} type="button" role="radio" aria-checked={role === r} className={`cf-chip ${role === r ? 'on' : ''}`} onClick={() => setRole(r)}>
            {ROLE_WORD[r]}
          </button>
        ))}
      </div>
      <div ref={wrap} className="cf-protect" style={{ width: W, height: H }} data-testid="protect-picture" tabIndex={0}
        aria-label="The picture: drag to mark what must stay, click a box to select it"
        onPointerDown={down} onPointerMove={moveTo} onPointerUp={up} onPointerCancel={() => setDrag(null)} onKeyDown={key}>
        {url && <img src={url} alt="" draggable={false} style={{ width: W, height: H }} />}
        {boxes.map((b, i) => (
          <span key={i} className={`cf-pbox ${b.role} ${live === i ? 'sel' : ''}`} data-testid="protect-box"
            style={{ left: b.x * scale, top: b.y * scale, width: b.w * scale, height: b.h * scale }}>
            <span className="cf-ptag">{labelOf(b)}</span>
            {live === i && HANDLES.map((h) => (
              <i key={h} className={`cf-handle ${h}`} data-handle={h} onPointerDown={(e) => handleDown(e, i, h)} />
            ))}
          </span>
        ))}
        {draft && (
          <span className={`cf-pbox ${role} draft`} style={{
            left: Math.min(draft.x0, draft.x1) * scale, top: Math.min(draft.y0, draft.y1) * scale,
            width: Math.abs(draft.x1 - draft.x0) * scale, height: Math.abs(draft.y1 - draft.y0) * scale,
          }} />
        )}
      </div>
      {full && <div className="faint cf-note">That is {MAX_BOXES} boxes, the most. Remove one to add another.</div>}
      <ul className="cf-plist" aria-label="Marked">
        {boxes.length === 0 && <li className="faint">Nothing marked yet. Drag over the subject or the product, or tap them.</li>}
        {boxes.map((b, i) => (
          <li key={i} className={`cf-prow ${live === i ? 'sel' : ''}`} onPointerDown={() => setSel(i)}>
            <span className={`cf-pdot ${b.role}`} aria-hidden />
            <input className="cf-plabel" aria-label={`Name of box ${i + 1}`} value={b.label ?? ''} maxLength={40} placeholder={labelOf({ ...b, label: '' })}
              onFocus={() => setSel(i)} onChange={(e) => replace(i, { ...b, label: e.target.value || undefined })} />
            <select className="cf-prole" aria-label={`What box ${i + 1} is`} value={b.role} onChange={(e) => replace(i, { ...b, role: e.target.value as Role })}>
              {(['subject', 'product', 'other'] as const).map((r) => <option key={r} value={r}>{ROLE_WORD[r]}</option>)}
            </select>
            <button type="button" className="btn xs ghost" aria-label={`Remove box ${i + 1}`} onClick={() => remove(i)}>Remove</button>
          </li>
        ))}
      </ul>
    </>
  )
}
