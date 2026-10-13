// Undo and Redo in the top bar, and Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z (or Ctrl+Y), for
// anything a person did to the document, any time (doc/undo.ts). The shortcuts
// leave typing alone, and the canvas, whose Excalidraw keeps its own undo.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useDoc, useServices, useUi } from '../app/context'
import { redo, stepWords, undo, undoLabels } from '../doc/undo'
import { keepsItsOwnUndo } from './undoKeys'

export function UndoButtons() {
  const { doc } = useServices()
  // Read again on every document or UI change: a write or an undo moves the steps.
  useDoc()
  useUi()
  const { undo: last, redo: next } = undoLabels(doc)
  const [note, setNote] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const run = useCallback(async (way: 'undo' | 'redo') => {
    const r = await (way === 'undo' ? undo(doc) : redo(doc))
    if (!r) return
    if (timer.current) clearTimeout(timer.current)
    // A step someone changed since is skipped with the spec's notice (LocalUndo).
    if (!r.done) {
      if (!r.notice) return
      setNote(r.notice)
    } else setNote(`${way === 'undo' ? 'Undid' : 'Redid'}${r.label ? `: ${stepWords(r.label)}` : ''}${r.notice ? ` · ${r.notice}` : ''}`)
    timer.current = setTimeout(() => setNote(null), 4000)
  }, [doc])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || keepsItsOwnUndo(e.target)) return
      const k = e.key.toLowerCase()
      if (k === 'z' || k === 'y') {
        e.preventDefault()
        void run(k === 'y' || e.shiftKey ? 'redo' : 'undo')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [run])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  return (
    <span className="undobtns" role="group" aria-label="Undo and redo">
      <button className="btn sm icon" disabled={!last} onClick={() => void run('undo')}
        aria-label={last ? `Undo: ${stepWords(last)}` : 'Nothing to undo'} title={last ? `Undo: ${stepWords(last)} (Ctrl+Z)` : 'Nothing to undo'}>↶</button>
      <button className="btn sm icon" disabled={!next} onClick={() => void run('redo')}
        aria-label={next ? `Redo: ${stepWords(next)}` : 'Nothing to redo'} title={next ? `Redo: ${stepWords(next)} (Shift+Ctrl+Z)` : 'Nothing to redo'}>↷</button>
      {note && <span className="undonote" role="status">{note}</span>}
    </span>
  )
}
