// Save: send the project to the server now (the relay keeps it: S3 on AWS,
// .local-data/clan locally), on top of the save every 5 minutes and on a lock.
// Opening a saved project from the server comes with the server work later.
// Ctrl/Cmd+S does the same.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useServices } from '../app/context'

type State = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; at: Date } | { kind: 'failed'; why: string }

const time = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export function SaveButton() {
  const { clan, relay } = useServices()
  const [state, setState] = useState<State>({ kind: 'idle' })
  const busy = useRef(false)

  const save = useCallback(async () => {
    if (!clan || busy.current) return
    busy.current = true
    setState({ kind: 'saving' })
    try {
      await clan.flush() // what was just changed goes too
      await clan.clan.mirrorNow('manual')
      setState({ kind: 'saved', at: new Date() })
    } catch (e) {
      setState({ kind: 'failed', why: e instanceof Error ? e.message : 'the server did not answer' })
    } finally {
      busy.current = false
    }
  }, [clan])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault() // never the browser's "save page"
        void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save])

  // Saving online needs the relay and the .clan store (not the in-browser mock, not the plain-data fallback).
  if (!clan || relay.kind !== 'http') return null
  const label = state.kind === 'saving' ? 'Saving…' : state.kind === 'saved' ? `Saved · ${time(state.at)}` : state.kind === 'failed' ? 'Not saved · retry' : 'Save'
  const title = state.kind === 'failed' ? `Not saved: ${state.why}. Your work is still in this browser; try again.`
    : 'Save your project to the server now (Ctrl+S). It also saves every 5 minutes.'
  return (
    <button className={`btn sm ${state.kind === 'failed' ? 'danger' : ''}`} disabled={state.kind === 'saving'} title={title} onClick={() => void save()}>
      {label}
    </button>
  )
}
