// Saving one piece of media from a control (features/media-download.clan): the state its label
// shows, and the open project's name the file is named by.

import { useCallback, useEffect, useState } from 'react'
import { useDoc, useServices, useShell } from '../app/context'
import { downloadItem } from '../media/download'
import type { MediaItem } from '../media/names'

/** The open project's name, as typed (Home's list). */
export function useProjectName(): string | undefined {
  const { project } = useServices()
  return useShell().index.get(project.id)?.name
}

export type DownloadState = 'idle' | 'busy' | 'missing'

/** Save items one by one; `missing` for a few seconds when one of them is nowhere. Resolves true when all were saved. */
export function useDownload(): [DownloadState, (items: MediaItem[]) => Promise<boolean>] {
  const doc = useDoc()
  const [state, setState] = useState<DownloadState>('idle')
  useEffect(() => {
    if (state !== 'missing') return
    const t = setTimeout(() => setState('idle'), 4000)
    return () => clearTimeout(t)
  }, [state])
  const run = useCallback(async (items: MediaItem[]) => {
    setState('busy')
    let missing = false
    for (const item of items) if (!(await downloadItem(doc, item))) missing = true
    setState(missing ? 'missing' : 'idle')
    return !missing
  }, [doc])
  return [state, run]
}

export function downloadLabel(state: DownloadState, idle = 'Download'): string {
  return state === 'busy' ? 'Saving…' : state === 'missing' ? 'Not in this browser' : idle
}
