// Undo and Redo for anything a person did to the document, any time (doc/undo.ts): the bordered
// pair in an editor's bar and the canvas's zoom pill, and Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z (or Ctrl+Y),
// registered once by UndoKeys. The shortcuts leave typing alone, and the canvas, whose Excalidraw
// keeps its own undo.

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { useDoc, useServices, useUi } from '../app/context'
import { redo, stepWords, undo, undoLabels } from '../doc/undo'
import { keepsItsOwnUndo } from './undoKeys'

// The last undo note, shared by every pair on screen (the pill and an editor's bar say the same).
let note: string | null = null
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | null = null
function say(n: string | null) {
  note = n
  for (const l of listeners) l()
  if (timer) clearTimeout(timer)
  if (n) timer = setTimeout(() => say(null), 4000)
}
const subscribe = (l: () => void) => { listeners.add(l); return () => void listeners.delete(l) }

function useRun() {
  const { doc } = useServices()
  return useCallback(async (way: 'undo' | 'redo') => {
    const r = await (way === 'undo' ? undo(doc) : redo(doc))
    if (!r) return
    // A step someone changed since is skipped with the spec's notice (LocalUndo).
    if (!r.done) {
      if (r.notice) say(r.notice)
    } else say(`${way === 'undo' ? 'Undid' : 'Redid'}${r.label ? `: ${stepWords(r.label)}` : ''}${r.notice ? ` · ${r.notice}` : ''}`)
  }, [doc])
}

/** The keyboard: mounted once, by App. */
export function UndoKeys() {
  const run = useRun()
  const ref = useRef(run)
  useEffect(() => { ref.current = run }, [run])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || keepsItsOwnUndo(e.target)) return
      const k = e.key.toLowerCase()
      if (k === 'z' || k === 'y') {
        e.preventDefault()
        void ref.current(k === 'y' || e.shiftKey ? 'redo' : 'undo')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return null
}

/** The pair of buttons; `bare` sits inside another pill (the canvas's zoom pill). */
export function UndoButtons({ bare = false }: { bare?: boolean }) {
  const { doc } = useServices()
  // Read again on every document or UI change: a write or an undo moves the steps.
  useDoc()
  useUi()
  const { undo: last, redo: next } = undoLabels(doc)
  const run = useRun()
  const said = useSyncExternalStore(subscribe, () => note)
  const buttons = (
    <>
      <button type="button" disabled={!last} onClick={() => void run('undo')}
        aria-label={last ? `Undo: ${stepWords(last)}` : 'Nothing to undo'} title={last ? `Undo: ${stepWords(last)} (Ctrl+Z)` : 'Nothing to undo'}>↶</button>
      <button type="button" disabled={!next} onClick={() => void run('redo')}
        aria-label={next ? `Redo: ${stepWords(next)}` : 'Nothing to redo'} title={next ? `Redo: ${stepWords(next)} (Shift+Ctrl+Z)` : 'Nothing to redo'}>↷</button>
      {said && <span className="undonote" role="status">{said}</span>}
    </>
  )
  if (bare) return buttons
  return <span className="pt-pair undobtns" role="group" aria-label="Undo and redo">{buttons}</span>
}
