// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The brand flow of one open document, as a React hook: it listens for `clan:file-added` from the app's own frame (and only that frame),
// feeds each file to the flow, and gives the entries to draw.

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { ports } from './brandApi'
import { BrandFlow, fileFrom, type Entry, type Store } from './brandFlow'

const session = (): Store | null => { try { return typeof window === 'undefined' ? null : window.sessionStorage } catch { return null } }

/** The app's frame: the one iframe the shell draws for the open document. */
const appFrame = (): Window | null => (document.querySelector('iframe.ch-frame') as HTMLIFrameElement | null)?.contentWindow ?? null

export function useBrandFlow(doc: string, client: { id: string; name: string } | null): { entries: readonly Entry[]; flow: BrandFlow } {
  const clientId = client?.id ?? null, clientName = client?.name ?? ''
  const flow = useMemo(() => new BrandFlow(ports, { doc, client: clientId ? { id: clientId, name: clientName } : null, store: session() }), [doc, clientId, clientName])
  useEffect(() => {
    flow.revive()
    flow.resumeAll()
    const onMessage = (e: MessageEvent) => {
      const f = fileFrom(e.data)
      if (!f || !e.source || e.source !== appFrame()) return
      void flow.fileAdded(f)
    }
    window.addEventListener('message', onMessage)
    return () => { window.removeEventListener('message', onMessage); flow.dispose() }
  }, [flow])
  const entries = useSyncExternalStore(flow.subscribe, flow.snapshot, flow.snapshot)
  return { entries, flow }
}
