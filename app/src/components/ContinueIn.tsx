// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { useCallback, useEffect, useState } from 'react'

import { host } from '../host'
import type { SpinoffTarget, UpstreamView } from '../host'
import { linksRead, madeFromOf, type LinksRead } from './barMenus'

/**
 * A count that goes up when the page comes back into view or the window is
 * focused: links and what a document was made from change in other documents
 * (another tab, another person), so they are read again then.
 */
export function useWakeTick(): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const wake = () => { if (!document.hidden) setTick(t => t + 1) }
    window.addEventListener('focus', wake)
    document.addEventListener('visibilitychange', wake)
    return () => {
      window.removeEventListener('focus', wake)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [])
  return tick
}

/**
 * "Continue in…": the apps that have declared they will take the open document
 * as a spin-off source, carrying its data and its decisions across. The bar
 * lists them in its More menu.
 *
 * Targets depend on the document's app, so they are held against the path they
 * were asked for: a different document shows none until its own answer comes.
 * An empty list is a normal state (nothing downstream is installed), not a
 * failure worth a disabled item in the chrome.
 */
export function useSpinoffTargets(docPath: string): SpinoffTarget[] {
  const [got, setGot] = useState<{ docPath: string; targets: SpinoffTarget[] } | null>(null)

  useEffect(() => {
    let live = true
    host.spinoffTargets()
      .then(targets => { if (live) setGot({ docPath, targets }) })
      // A host that cannot answer simply offers nothing; this is chrome, not
      // the document, and must never take the app down with it.
      .catch(() => { if (live) setGot({ docPath, targets: [] }) })
    return () => { live = false }
  }, [docPath])

  return got?.docPath === docPath ? got.targets : []
}

/**
 * What the open document was made from (`GET /upstream`), and the way to take
 * its newer version (`POST /upstream/update`, Contract 4 §5.5 as reversed for
 * spin-offs on 2026-11-09). `onTaken` runs after the update is written, so the
 * app's fields and the decisions read it again.
 */
export function useMadeFrom(docPath: string, onTaken: () => void, onError: (message: string) => void, stamp = '') {
  const [got, setGot] = useState<{ docPath: string; view: UpstreamView | null; tick: number } | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let live = true
    host.upstream()
      .then(view => { if (live) setGot({ docPath, view, tick }) })
      // The desktop has no /upstream yet, and a host that cannot answer
      // offers nothing: chrome, never the document.
      .catch(() => { if (live) setGot({ docPath, view: null, tick }) })
    return () => { live = false }
    // `stamp` changes when another document changed (the library's versions):
    // the source may have a newer version to offer.
  }, [docPath, tick, stamp])

  const madeFrom = got?.docPath === docPath ? madeFromOf(got.view) : null
  const update = useCallback(() => {
    host.updateFromUpstream()
      .then(() => { setTick(t => t + 1); onTaken() })
      .catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)))
  }, [onTaken, onError])

  return { madeFrom, update, upstream: got?.docPath === docPath ? got.view : null }
}

/**
 * Links (os-layer §5.7): the documents the open one could link
 * (`GET /attach-targets`), what is linked and related now (`GET /related`),
 * and linking, updating and unlinking. `onChanged` runs after each write, so
 * the app's fields and the decisions read it again; `onError` gets the host's
 * own words for a refusal (a locked document says why).
 */
export function useLinks(docPath: string, onChanged: () => void, onError: (message: string) => void, stamp = '') {
  const [got, setGot] = useState<LinksRead | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let live = true
    // Chrome, never the document: a host that cannot answer offers nothing new.
    Promise.all([
      host.attachTargets().catch(() => null),
      host.related().catch(() => null),
    ]).then(([targets, related]) => { if (live) setGot(prev => linksRead(prev, docPath, targets, related)) })
    return () => { live = false }
    // `stamp`: a linked document changed, was unlinked or renamed elsewhere.
    // `tick`: a link was written here, or Continue in ▾ is opening (`refresh`).
  }, [docPath, tick, stamp])

  const run = useCallback((write: () => Promise<unknown>, then?: (reply: unknown) => void) => {
    write()
      .then(reply => { setTick(t => t + 1); onChanged(); then?.(reply) })
      .catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)))
  }, [onChanged, onError])

  const mine = got?.docPath === docPath ? got : null
  return {
    targets: mine?.targets ?? [],
    related: mine?.related ?? null,
    /** Read them again: Continue in ▾ calls it as it opens. */
    refresh: () => setTick(t => t + 1),
    link: (id: string, then?: () => void) => run(() => host.attach(id), then),
    update: (id: string) => run(() => host.updateLinked(id)),
    unlink: (id: string) => run(() => host.detach(id)),
  }
}
