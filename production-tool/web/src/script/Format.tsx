// The Format menu (features/script-freeform.clan; mock state 'format'): the element bar, moved into the
// Script editor's top bar beside the view switch, so a new page is just a page. Nothing has to be picked to
// write; screenplay layout is there for people who want it.
//
//   Format as screenplay  Skye lays the words out as a screenplay (her 'instruct' write; nothing changes
//                         until it is kept)
//   This line             Plain text, Scene heading, Action, Character, Dialogue, Parenthetical, Transition
//   Shot, Moment          a shot break; a moment in the caret's shot (⌥M)
//   Tab                   still cycles the elements as you write (extensions.ts TAB_NEXT)
//
// Plain text and Action are the same stored block (one text model): a line reads as plain text in a scene
// with no heading and no screenplay elements, and as Action in a screenplay scene.

import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { Float } from '../ui/Float'
import { AgentAvatar } from '../ui/agents/AgentFigure'
import type { ModelStore } from '../model/store'
import { caretKey, type CaretChain } from './caret'
import type { ComposedScript } from './compose'
import { addBeat, addScene, headingToLine, insertShot, splitScene } from './edits'
import { useEditorTick } from './hooks'
import { nextMomentTime, UNPLANNED_MOMENT } from './moments'

/** The place the menu works on: the last fragment or heading the caret was in. */
export type FormatFocus = { key: string; editor: Editor | null } | null

export const FORMAT_SKYE = 'Format as screenplay'
export const FORMAT_SKYE_WHY = 'Skye lays your words out as a screenplay in the Booth. Nothing changes until you keep it.'
export const FORMAT_TAB = 'cycles the elements as you write a screenplay.'

/** What Skye is told for Format as screenplay: the words stay, the layout changes. */
export const FORMAT_INSTRUCTION = 'Lay these words out as a screenplay: a scene heading line (INT. or EXT. PLACE - TIME) where a scene starts, action lines, CHARACTER cues, parentheticals and dialogue, and transitions. Keep every word and the order; add nothing new and cut nothing.'

type Line = 'plain' | 'scene' | 'action' | 'character' | 'dialogue' | 'parenthetical' | 'transition'

export interface FormatProps {
  focus: FormatFocus
  composed: ComposedScript
  store: ModelStore
  chain: CaretChain
  onError: (m: string | null) => void
  say: (m: string) => void
  /** Format as screenplay, by Skye; absent or off when she cannot write here. */
  onSkye?: () => void
  skyeOff?: boolean
  /** The menu opened or closed (the page marks the line it works on). */
  onOpenChange?: (open: boolean) => void
}

export function FormatButton(p: FormatProps) {
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpenState] = useState(false)
  const { onOpenChange, focus } = p
  const setOpen = (o: boolean) => {
    setOpenState(o)
    onOpenChange?.(o)
  }
  const close = () => setOpen(false)
  // While the menu is open, the line it works on is marked on the page (mock state 'format').
  useEffect(() => {
    const ed = focus?.editor
    if (!open || !ed || ed.isDestroyed) return
    const { $from } = ed.state.selection
    // A bar beside it on the sheet, outside the editor's own DOM (which the editor keeps to itself).
    const el = ed.view.nodeDOM($from.before(1))
    const sheet = el instanceof HTMLElement ? el.closest('.sp-rows') : null
    if (!(el instanceof HTMLElement) || !(sheet instanceof HTMLElement)) return
    const a = el.getBoundingClientRect()
    const s = sheet.getBoundingClientRect()
    const bar = document.createElement('span')
    bar.className = 'fmt-cur'
    bar.setAttribute('aria-hidden', 'true')
    Object.assign(bar.style, { top: `${a.top - s.top + sheet.scrollTop + 3}px`, height: `${Math.max(8, a.height - 6)}px`, left: `${a.left - s.left - 14}px` })
    sheet.appendChild(bar)
    return () => bar.remove()
  }, [open, focus])
  return (
    <>
      <button ref={ref} type="button" className="btn se-fmt" aria-haspopup="menu" aria-expanded={open} data-tip="Format: screenplay elements, or Skye lays it out"
        onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(!open)}>
        Format
        <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" /></svg>
      </button>
      <Float anchor={ref} open={open} onClose={close} label="Format" className="pt-menu se-fmtmenu">
        <FormatItems {...p} close={close} />
      </Float>
    </>
  )
}

/** The menu's rows (exported for tests). */
export function FormatItems({ focus, composed, store, chain, onError, say, onSkye, skyeOff, close }: FormatProps & { close: () => void }) {
  useEditorTick(focus?.editor ?? null)
  const editor = focus?.editor && !focus.editor.isDestroyed ? focus.editor : null
  const [kind, id] = (focus?.key ?? ':').split(':')
  const block = editor?.state.selection.$from.parent.type.name
  const blockIndex = editor ? editor.state.selection.$from.index(0) : 0
  const line = editor?.state.selection.$from.parent.textContent.trim() ?? ''
  // A scene's own words read as free text while it has no heading and nothing but plain lines.
  const free = kind === 'scene' && !store.get().scenes[id]?.heading.trim() && (() => {
    let all = true
    editor?.state.doc.forEach((b) => { if (b.type.name !== 'action') all = false })
    return all
  })()
  const now: Line | undefined = kind === 'heading' ? 'scene'
    : kind === 'scene' ? (block === 'action' ? (free ? 'plain' : 'action') : (block as Line | undefined))
      : kind === 'shot' ? 'action' : kind === 'beat' ? 'dialogue' : undefined
  const run = (fn: () => Promise<unknown>) => {
    close()
    onError(null)
    Promise.resolve().then(fn).catch((e) => onError(e instanceof Error ? e.message : 'That did not work.'))
  }
  const sceneOf = () => (kind === 'scene' || kind === 'heading' ? id : kind === 'shot' ? store.get().shots[id]?.scene_id : undefined)
  const setNode = (t: string) => {
    close()
    editor?.chain().focus().setNode(t).run()
  }
  const lineAct: Record<Line, (() => void) | null> = {
    plain: kind === 'scene' ? () => setNode('action') : kind === 'heading' ? () => run(() => headingToLine(store, id).then(() => chain.focus(caretKey('scene', id), 'start'))) : null,
    action: kind === 'scene' ? () => setNode('action') : kind === 'heading' ? () => run(() => headingToLine(store, id).then(() => chain.focus(caretKey('scene', id), 'start')))
      : kind === 'shot' ? () => { close(); editor?.commands.focus() } : null,
    // The line becomes a scene's heading (an empty line has nothing to head a scene with: type it first).
    scene: kind === 'heading' || (kind === 'scene' && !line) ? null : kind === 'scene' && editor
      ? () => run(() => splitScene(store, id, blockIndex, line.toUpperCase()).then((sid) => chain.focus(caretKey('scene', sid), 'start')))
      : () => run(() => addScene(store, composed.script.id, sceneOf()).then((sid) => chain.focus(caretKey('heading', sid), 'end'))),
    character: kind === 'scene' ? () => setNode('character') : kind === 'shot' ? () => run(() => addBeat(store, id, 'line', { at_s: 0 }).then((b) => chain.focus(caretKey('beat', b), 'start'))) : null,
    dialogue: kind === 'scene' ? () => setNode('dialogue') : kind === 'shot' ? () => run(() => addBeat(store, id, 'line', { at_s: 0 }).then((b) => chain.focus(caretKey('beat', b), 'start'))) : null,
    parenthetical: kind === 'scene' ? () => setNode('parenthetical') : null,
    transition: kind === 'scene' ? () => setNode('transition') : null,
  }
  const shot = () => {
    const sb = composed.storyboard
    if (!sb) return run(() => Promise.reject(new Error('Plan shots first: a shot break goes on this script\'s storyboard.')))
    if (kind === 'scene') run(() => insertShot(store, { sceneId: id, blockIndex, storyboardId: sb.id }).then((sid) => chain.focus(caretKey('shot', sid), 'end')))
    else if (kind === 'shot') run(() => insertShot(store, { afterShotId: id }).then((sid) => chain.focus(caretKey('shot', sid), 'start')))
    else {
      const last = composed.shots.filter((s) => s.kind !== 'end_card').at(-1)
      if (last) run(() => insertShot(store, { afterShotId: last.id }).then((sid) => chain.focus(caretKey('shot', sid), 'start')))
      else run(() => Promise.reject(new Error('Plan shots first: a shot break goes on this script\'s storyboard.')))
    }
  }
  const moment = () => {
    const shotId = kind === 'shot' ? id : kind === 'beat' ? store.get().beats[id]?.shot_id : undefined
    if (!shotId) {
      close()
      return say(UNPLANNED_MOMENT)
    }
    run(() => addBeat(store, shotId, 'moment', { at_s: nextMomentTime(store.get(), shotId) }).then((b) => chain.focus(caretKey('beat', b), 'start')))
  }
  const row = (t: Line, label: string) => (
    <button key={t} type="button" role="menuitemradio" aria-checked={now === t} className={`fmi se-fmtline ${now === t ? 'on' : ''}`}
      disabled={!lineAct[t]} onClick={() => lineAct[t]?.()}>
      <span className="fmi-ico" aria-hidden="true">{now === t ? '✓' : ''}</span>
      <span className="fmi-text">{label}</span>
    </button>
  )
  return (
    <>
      <button type="button" role="menuitem" className="fmi se-fmtskye" disabled={!onSkye || skyeOff} onClick={() => { close(); onSkye?.() }}>
        <AgentAvatar agent="skye" size={22} decorative />
        <span className="fmi-text"><b>{FORMAT_SKYE}</b><small>{FORMAT_SKYE_WHY}</small></span>
      </button>
      <div className="pt-menusep" />
      <div className="se-fmthead">This line</div>
      {row('plain', 'Plain text')}
      {row('scene', 'Scene heading')}
      {row('action', 'Action')}
      {row('character', 'Character')}
      {row('dialogue', 'Dialogue')}
      {row('parenthetical', 'Parenthetical')}
      {row('transition', 'Transition')}
      <div className="pt-menusep" />
      <button type="button" role="menuitem" className="fmi" onClick={shot}><span className="fmi-ico" aria-hidden="true" /><span className="fmi-text">Shot</span><span className="fmi-hint">a shot break</span></button>
      <button type="button" role="menuitem" className="fmi" onClick={moment}><span className="fmi-ico" aria-hidden="true" /><span className="fmi-text">Moment</span><span className="fmi-hint">⌥M</span></button>
      <div className="pt-menusep" />
      <div className="se-fmtfoot"><kbd>Tab</kbd> {FORMAT_TAB}</div>
    </>
  )
}
