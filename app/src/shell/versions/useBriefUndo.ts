// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Undo and redo for the open brief (features/brief-versions-undo.clan; v3.1 test 16).
// The shell hears each of the person's saved writes (`clan:write`), reads the edit the host kept
// with its inverse, and keeps it on a stack. Cmd or Ctrl Z, from the page or from inside the brief
// when no text field owns the key, writes the inverse as a new edit by the same person.

import { useCallback, useEffect, useRef, useState } from 'react'
import { host } from '../../host'
import { pushData } from '../appExport'
import { labelOf } from './compare'
import { createUndoStack, keepsItsOwnUndo, undoKeyOf, type UndoStack } from './undoStack'

/** Parts that are not the brief's words (the host's own, the signers, what is held): never undone here. */
const NOT_WORDS = new Set(['projection', 'upstream', 'signers', 'locked_fields'])

const named = (keys: string[]) => keys.map(labelOf).join(', ').toLowerCase()

export interface BriefUndo {
  canUndo: boolean
  canRedo: boolean
  /** One line about the last undo or redo, or why it did nothing. */
  note: string | null
  undo: () => void
  redo: () => void
  /** A write of the person's own landed: take it onto the stack. */
  onSaved: () => void
  /** The key came from inside the brief's frame. */
  onFrameKey: (dir: 'undo' | 'redo') => void
  /** A restore the person made: it can be undone like an edit. */
  remember: (before: Record<string, unknown>, after: Record<string, unknown>, id: string) => void
}

export function useBriefUndo(docPath: string, on: boolean, onChanged: () => void): BriefUndo {
  // Kept with the document it was made for: another brief opens on an empty stack.
  const [held, setHeld] = useState<{ docPath: string; stack: UndoStack; note: string | null }>(() => ({ docPath, stack: createUndoStack(), note: null }))
  if (held.docPath !== docPath) setHeld({ docPath, stack: createUndoStack(), note: null })
  const stack = useRef<UndoStack>(held.stack)
  useEffect(() => { stack.current = held.stack }, [held.stack])
  const [, bump] = useState(0)
  const setNote = useCallback((note: string | null) => setHeld(h => ({ ...h, note })), [])
  const me = useRef<string | null>(null)
  const line = useRef<Promise<void>>(Promise.resolve())
  const busy = useRef(false)

  useEffect(() => {
    if (!on) return
    host.whoAmI().then(p => { me.current = p.id.replace(/^human:/, '') }, () => { me.current = null })
  }, [on])

  const onSaved = useCallback(() => {
    if (!on) return
    line.current = line.current.then(async () => {
      try {
        const last = (await host.getVersions()).draft.last_edit
        if (!last || last.person !== me.current || last.keys.some(k => NOT_WORDS.has(k))) return
        const parts = (await host.getVersion('draft')).parts
        const after: Record<string, unknown> = {}
        for (const k of last.keys) after[k] = parts[k] ?? null
        stack.current.push({ id: last.decision, keys: last.keys, before: last.before, after })
        bump(n => n + 1)
      } catch { /* the stack just does not take this one */ }
    })
  }, [on])

  const run = useCallback(async (dir: 'undo' | 'redo') => {
    if (!on || busy.current) return
    busy.current = true
    try {
      await line.current
      const current = (await host.getVersion('draft')).parts
      const plan = stack.current.plan(dir, current)
      if (plan.kind === 'nothing') { setNote(dir === 'undo' ? 'Nothing to undo.' : 'Nothing to redo.'); return }
      if (plan.kind === 'stale') {
        setNote(`The ${named(plan.keys)} changed after you wrote it, so nothing was ${dir === 'undo' ? 'undone' : 'redone'}.`)
        return
      }
      await host.gatePatch(plan.patch, `${dir} edit of ${named(plan.entry.keys)}`)
      stack.current.done(dir)
      setNote(`${dir === 'undo' ? 'Undid' : 'Redid'} the ${named(plan.entry.keys)}.`)
      host.getCurrent().then(c => pushData(c.data), () => {})
      onChanged()
    } catch (e) {
      setNote(String(e instanceof Error ? e.message : e))
    } finally {
      busy.current = false
      bump(n => n + 1)
    }
  }, [on, onChanged, setNote])

  // Cmd or Ctrl Z on the page, unless a field owns it (its own undo is the browser's).
  useEffect(() => {
    if (!on) return
    const onKey = (e: KeyboardEvent) => {
      const dir = undoKeyOf(e)
      if (!dir || e.defaultPrevented || keepsItsOwnUndo(e.target)) return
      e.preventDefault()
      void run(dir)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [on, run])

  const remember = useCallback((before: Record<string, unknown>, after: Record<string, unknown>, id: string) => {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(k => !NOT_WORDS.has(k))
    const pick = (o: Record<string, unknown>) => Object.fromEntries(keys.map(k => [k, o[k] ?? null]))
    if (keys.length) { stack.current.push({ id, keys, before: pick(before), after: pick(after) }); bump(n => n + 1) }
  }, [])

  return {
    canUndo: held.stack.canUndo(),
    canRedo: held.stack.canRedo(),
    note: held.note,
    undo: () => void run('undo'),
    redo: () => void run('redo'),
    onSaved,
    onFrameKey: dir => void run(dir),
    remember,
  }
}
