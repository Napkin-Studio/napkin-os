// The canvas bar's save status and Ctrl/Cmd+S (features/topbar-declutter.clan): both read and drive
// ui/useSave.ts, as More's "Save now" does. At tight the status is a dot, unless the save failed.

import { useEffect, useRef } from 'react'
import { saveTime, useSave } from './useSave'

export function SaveStatus({ dot = false }: { dot?: boolean }) {
  const { can, state, save } = useSave()
  // Saving online needs the relay and the .clan store (not the in-browser mock, not the plain-data fallback).
  if (!can) return null
  const label = state.kind === 'saving' ? 'Saving…' : state.kind === 'saved' ? `Saved · ${saveTime(state.at)}` : state.kind === 'failed' ? 'Not saved · retry' : 'Save'
  const title = state.kind === 'failed' ? `Not saved: ${state.why}. Your work is still in this browser; try again.`
    : 'Save your project to the server now (Ctrl+S). It also saves every 5 minutes.'
  const small = dot && state.kind !== 'failed'
  return (
    <button type="button" className={`pt-savebtn ${state.kind === 'failed' ? 'failed' : ''} ${small ? 'dot' : ''}`} data-state={state.kind}
      disabled={state.kind === 'saving'} title={title} aria-label={small ? `${label}. ${title}` : undefined} onClick={() => void save()}>
      {small ? <span className="pt-savedot" aria-hidden="true" /> : label}
    </button>
  )
}

/** Ctrl/Cmd+S, registered once (App): never the browser's "save page". */
export function SaveKeys() {
  const { save } = useSave()
  const ref = useRef(save)
  useEffect(() => { ref.current = save }, [save])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void ref.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return null
}
