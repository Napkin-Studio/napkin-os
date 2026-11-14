// A generating node's inputs strip (ui-behaviour 3.16, 3.3): "Inputs", then one chip per link into the
// node ("Script · First Light", "Locations · 2", "@maya_front", "golden hour · lighting"), then
// "+ Link input". Read from scopeOf (model/scope.ts) over the document as the canvas has it alive
// (model/live.ts), so it shows what the editors and the send tray show, and changes as soon as a link
// is made or taken away. The node cards on both engines render it (canvas/nodes/cards.tsx), and the
// editors' scope line (ScopeLine below).
//
// - A chip's click fits the canvas to that input (in an editor, it goes back to the canvas first).
// - A chip's × (on hover or focus) unlinks it, one undo step; when shots use it, it asks first.
// - "+ Link input" opens a picker of boards, groups and references, with search; picking one links it
//   by the rules of 3.4 (canvas/nodes/nodes.ts linkInput), one undo step.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useDoc, useServices } from '../app/context'
import { canvasActions } from '../canvas/chrome/actions'
import { linkInput, unlinkInput } from '../canvas/nodes/nodes'
import { shotNumber } from '../model/selectors'
import { inputChips, scopeOf, scopeRefs, type ScopeItem } from '../model/scope'
import { useBlobUrl } from '../ui/hooks'
import { linkChoices, nodeEnd, searchChoices, unlinkQuestion, type LinkChoice } from './inputsEdit'
import './inputs.css'

/** At most this many chips; the rest are counted ("+2"). */
const SHOWN = 4

/** Where a chip's click goes: fit the canvas to it (an editor first goes back to the canvas). */
export type ShowInput = (item: ScopeItem) => void

const fitOnCanvas: ShowInput = (item) => { canvasActions.fitTo({ kind: item.kind, id: item.id }) }

const stop = (e: { stopPropagation(): void }) => e.stopPropagation()

export function InputsStrip({ nodeId, onShow = fitOnCanvas }: { nodeId: string | undefined; onShow?: ShowInput }) {
  const doc = useDoc()
  const { doc: store } = useServices()
  const [asking, setAsking] = useState<{ item: ScopeItem; question: string; at: DOMRect } | null>(null)
  const [picking, setPicking] = useState<DOMRect | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  if (!nodeId || !nodeEnd(doc, nodeId)) return null
  const items = scopeOf(doc, nodeId)
  const chips = inputChips(items)
  const more = chips.length - SHOWN
  const unlink = (item: ScopeItem) => {
    if (!item.linkId) return
    setAsking(null)
    void unlinkInput(store, item.linkId).catch((e) => setSaid(e instanceof Error ? e.message : 'That link was not taken away.'))
  }
  const ask = (item: ScopeItem, at: DOMRect) => {
    const question = unlinkQuestion(doc, items, item)
    if (question) setAsking({ item, question, at })
    else unlink(item)
  }
  return (
    <div className="in-strip" aria-label={`Inputs: ${chips.map((c) => c.label).join(', ') || 'none'}`} onPointerDown={stop} onDoubleClick={stop}>
      <span className="in-label">Inputs</span>
      {chips.slice(0, SHOWN).map((c) => <InputChip key={`${c.kind}:${c.id}`} item={c} onShow={onShow} onUnlink={ask} />)}
      {more > 0 && <span className="in-chip in-more" title={chips.slice(SHOWN).map((c) => c.label).join(', ')}>+{more}</span>}
      <button type="button" className="in-add" aria-haspopup="dialog" aria-expanded={!!picking}
        onClick={(e) => { setSaid(null); setPicking(picking ? null : e.currentTarget.getBoundingClientRect()) }}>+ Link input</button>
      {said && <span className="in-said" role="alert">{said}</span>}
      {asking && (
        <Pop at={asking.at} onClose={() => setAsking(null)} label="Unlink">
          <p className="in-q">{asking.question}</p>
          <div className="in-qbtns">
            <button type="button" className="btn sm" onClick={() => setAsking(null)}>Cancel</button>
            <button type="button" className="btn sm danger" autoFocus onClick={() => unlink(asking.item)}>Unlink</button>
          </div>
        </Pop>
      )}
      {picking && (
        <Pop at={picking} onClose={() => setPicking(null)} label="Link input">
          <LinkPicker nodeId={nodeId} onDone={(text) => { setPicking(null); if (text) setSaid(text) }} />
        </Pop>
      )}
    </div>
  )
}

function InputChip({ item, onShow, onUnlink }: { item: ScopeItem; onShow: ShowInput; onUnlink: (item: ScopeItem, at: DOMRect) => void }) {
  const url = useBlobUrl(item.asset)
  const name = item.label
  return (
    <span className={`in-chip kind-${item.kind}`}>
      <button type="button" className="in-show" title={item.words ?? (item.drawn ? `${name} · drawn · show on the canvas` : `${name} · show on the canvas`)} onClick={() => onShow(item)}>
        {url && <img src={url} alt="" />}
        <span className={item.kind === 'ref' ? 'in-ref' : undefined}>{name}</span>
      </button>
      {item.linkId && (
        <button type="button" className="in-x" aria-label={`Unlink ${name}`} title={`Unlink ${name}`}
          onClick={(e) => onUnlink(item, (e.currentTarget.parentElement ?? e.currentTarget).getBoundingClientRect())}>
          <svg viewBox="0 0 10 10" width="8" height="8" aria-hidden="true"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
      )}
    </span>
  )
}

/** "+ Link input"'s picker: boards, groups and references, with search. Picking one links it. */
export function LinkPicker({ nodeId, onDone }: { nodeId: string; onDone: (said?: string) => void }) {
  const doc = useDoc()
  const { doc: store } = useServices()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [why, setWhy] = useState<string | null>(null)
  const all = useMemo(() => linkChoices(doc, nodeId), [doc, nodeId])
  const shown = searchChoices(all, typed)
  const to = nodeEnd(doc, nodeId)
  const pick = async (c: LinkChoice) => {
    if (!to || c.linked || c.reason || busy) return
    setBusy(true)
    try {
      const r = await linkInput(store, doc, c.from, to)
      if (r.ok) onDone()
      else setWhy(r.reason)
    } catch (e) {
      setWhy(e instanceof Error ? e.message : 'That link was not made.')
    } finally {
      setBusy(false)
    }
  }
  const groups: [string, LinkChoice[]][] = [
    ['Boards', shown.filter((c) => c.from.kind === 'board')],
    ['Groups', shown.filter((c) => c.from.kind === 'key' || c.from.kind === 'group')],
    ['References', shown.filter((c) => c.from.kind === 'ref')],
  ]
  return (
    <div className="in-pick">
      <input className="input" type="search" autoFocus placeholder="Search boards, groups, references" aria-label="Search what to link"
        value={typed} onChange={(e) => { setTyped(e.target.value); setWhy(null) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const first = shown.find((c) => !c.linked && !c.reason)
            if (first) void pick(first)
          }
        }} />
      {why && <p className="in-why-not" role="alert">{why}</p>}
      <div className="in-picklist" role="listbox" aria-label="What to link">
        {groups.map(([title, cs]) => cs.length > 0 && (
          <div key={title} role="group" aria-label={title}>
            <div className="in-pickhead">{title}</div>
            {cs.map((c) => <ChoiceRow key={`${c.from.kind}:${c.from.id}`} c={c} onPick={() => void pick(c)} />)}
          </div>
        ))}
        {!shown.length && <p className="in-none">{all.length ? 'Nothing matches.' : 'No boards or named pictures yet.'}</p>}
      </div>
    </div>
  )
}

function ChoiceRow({ c, onPick }: { c: LinkChoice; onPick: () => void }) {
  const url = useBlobUrl(c.asset)
  const off = c.linked || !!c.reason
  return (
    <button type="button" role="option" aria-selected={false} aria-disabled={off} className={`in-choice ${off ? 'off' : ''}`}
      title={c.linked ? 'Already linked' : c.reason} onClick={off ? undefined : onPick}>
      {url ? <img src={url} alt="" /> : <span className="in-noimg" />}
      <span className="in-clabel">{c.label}</span>
      <span className="in-cwhat">{c.linked ? 'linked' : c.what}</span>
    </button>
  )
}

/** A small panel at a point on the page, over everything (a node card clips what is inside it). */
function Pop({ at, onClose, label, children }: { at: DOMRect; onClose: () => void; label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: at.left, top: at.bottom + 6 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const left = Math.max(8, Math.min(at.left, window.innerWidth - w - 8))
    const top = at.bottom + 6 + h > window.innerHeight - 8 ? Math.max(8, at.top - h - 6) : at.bottom + 6
    setPos({ left, top })
  }, [at])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [onClose])
  return createPortal(
    <div ref={ref} className="in-pop" role="dialog" aria-label={label} style={{ left: pos.left, top: pos.top }} onPointerDown={stop} onWheel={stop}>
      {children}
    </div>,
    document.body,
  )
}

/**
 * An editor's scope line (the Storyboard editor's sub bar): the inputs strip, then every reference in
 * scope, its own link's, a linked board's or the script's, with the shots that name it, then names
 * the text uses that are not linked ("not linked") or name nothing ("no ref yet"). A chip's click
 * goes back to the canvas and fits it to that input.
 */
export function ScopeLine({ nodeId, shotNumber: numberOf }: { nodeId: string | undefined; shotNumber?: (shotId: string) => number }) {
  const doc = useDoc()
  const { ui } = useServices()
  if (!nodeId) return null
  const items = scopeOf(doc, nodeId)
  const refs = scopeRefs(items)
  const num = numberOf ?? ((id: string) => shotNumber(doc, id))
  const show: ShowInput = (item) => {
    ui.update((u) => { u.stage = 'character' }, 'stage')
    // The canvas is mounted under the editor: fit once it is shown again.
    setTimeout(() => fitOnCanvas(item), 60)
  }
  return (
    <div className="in-scope" aria-label="What this storyboard uses">
      <InputsStrip nodeId={nodeId} onShow={show} />
      {refs.length > 0 && (
        <div className="in-refs" role="list" aria-label={`References · ${refs.length}`}>
          <span className="in-label">References · {refs.length}</span>
          {refs.map((r) => {
            const nums = r.usedBy.map(num).filter((n) => n > 0)
            const why = r.kind === 'unknown' ? 'no ref yet' : r.via === 'mention' ? 'not linked' : r.via === 'board' ? 'on a linked board' : r.via === 'upstream' ? 'from the script' : r.role
            return (
              <span key={`${r.kind}:${r.id}`} role="listitem" className={`in-chip ${r.kind === 'unknown' ? 'in-unknown' : r.via === 'mention' ? 'in-unlinked' : ''}`} title={`@${r.name} · ${why}${nums.length ? ` · shots ${nums.join(', ')}` : ''}`}>
                <RefThumb sha={r.asset} />
                <span className="in-ref">@{r.name}</span>
                {r.kind === 'unknown' || r.via === 'mention' ? <span className="in-why">{why}</span> : null}
                {nums.length > 0 && <span className="in-shots">{nums.join(' ')}</span>}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

function RefThumb({ sha }: { sha?: string }) {
  const url = useBlobUrl(sha)
  return url ? <img src={url} alt="" /> : null
}
