import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDoc, useServices } from './app/context'
import { dismissed, noticeWords, unlinkedFor, workingFrom } from './model/unlinked'
import { linkInput } from './canvas/nodes/nodes'
import type { LinkEndpoint } from './contracts/types'
import { noticePlace } from './linkNoticePlace'

// A named picture or the Brief that is not linked into the scope of an action's node gets a short, non-blocking
// notice by that action (owner 2026-11-23). Nothing is linked unless the person says Link it (refs and the Brief reach
// a job only when linked). "Run without it" hides the notice for this node until the page is reloaded.

export function LinkNotice({ kind, id, style }: { kind: 'script' | 'storyboard' | 'video'; id: string; style?: React.CSSProperties }) {
  const doc = useDoc()
  const { doc: store } = useServices()
  const [, tick] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const mark = useRef<HTMLSpanElement>(null)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  const miss = unlinkedFor(doc, id)
  const names = [...miss.refs.map((r) => `@${r.key}`), ...(miss.brief ? ['The Brief'] : [])]
  const key = `${id}|${names.join(',')}`
  const busy = workingFrom(doc, id)
  // On the canvas it hangs from the selection bar: beside it, lined up with its left edge. On a page it hangs under the action's button.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- measured after every render; it sets state only when the place moved
  useLayoutEffect(() => {
    if (!names.length || dismissed.has(key) || busy) return
    if (!style) {
      const r = mark.current?.closest('.ln-anchor')?.getBoundingClientRect()
      if (r && (!at || at.left !== Math.round(r.right - 296) || at.top !== Math.round(r.bottom + 10))) setAt({ left: Math.round(r.right - 296), top: Math.round(r.bottom + 10) })
      return
    }
    if (!ref.current) return
    const bar = document.querySelector('.selbar')?.getBoundingClientRect()
    const host = ref.current.offsetParent?.getBoundingClientRect()
    if (!bar || !host) return
    const nodeTop = typeof style.top === 'number' ? style.top - 10 + host.top : bar.bottom
    const { left, top } = noticePlace(bar, host, nodeTop, { width: ref.current.offsetWidth, height: ref.current.offsetHeight })
    if (!at || at.left !== left || at.top !== top) setAt({ left, top })
  })
  if (!names.length || dismissed.has(key) || busy) return null
  const link = async () => {
    const to: LinkEndpoint = { kind, id }
    for (const r of miss.refs) await linkInput(store, store.get(), { kind: 'ref', id: r.id }, to)
    if (miss.brief) await linkInput(store, store.get(), { kind: 'brief', id: miss.brief.id }, to)
  }
  const body = (
    <div ref={ref} className="linknote" style={style ? { ...style, ...(at ?? {}), visibility: at ? 'visible' : 'hidden' } : { position: 'fixed', zIndex: 60, ...(at ?? {}), visibility: at ? 'visible' : 'hidden' }} role="status" onPointerDown={(e) => e.stopPropagation()}>
      <div className="linknote-text">{noticeWords(kind, names)}</div>
      <div className="linknote-row">
        <button type="button" className="btn xs ghost" onClick={() => { dismissed.add(key); tick((n) => n + 1) }}>Run without it</button>
        <button type="button" className="btn xs primary" onClick={() => void link()}>Link it</button>
      </div>
    </div>
  )
  if (style) return body
  return (
    <>
      <span ref={mark} />
      {createPortal(body, document.body)}
    </>
  )
}
