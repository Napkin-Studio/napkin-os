// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What a person has set aside, per document (decisions/needs.ts splitAside): theirs alone and kept by the server
// (`POST` and `DELETE /needs/{key}/aside?path=`), so it survives a reload and reaches every browser they use. Where the
// server has no one to keep it for (an anonymous visit, the desktop) the mark is kept in this browser as it always was.
// Nothing here writes a decision: a set-aside item that blocks the lock still blocks it.

import { useSyncExternalStore } from 'react'
import { bringNeedBack, jobNeeds, setNeedAside } from '../../host/http'

const LOCAL = 'napkin.setAside:'

function readLocal(path: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(LOCAL + path)
    const list = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string') : [])
  } catch { return new Set() }
}

function writeLocal(path: string, keys: Set<string>) {
  try {
    if (keys.size) window.localStorage.setItem(LOCAL + path, JSON.stringify([...keys]))
    else window.localStorage.removeItem(LOCAL + path)
  } catch { /* storage blocked: it holds for this visit only */ }
}

let server: Record<string, string[]> = {}
let loaded = false
let version = 0
const listeners = new Set<() => void>()
const cache = new Map<string, { v: number; keys: ReadonlySet<string> }>()

const bump = () => { version++; listeners.forEach(l => l()) }

/** Read the person's marks from the server (once, and again after a change elsewhere). */
export async function refreshAside(): Promise<void> {
  try {
    const a = await jobNeeds()
    server = a.aside ?? {}
    loaded = true
    bump()
  } catch { /* no server answer: the browser's own marks stand */ }
}

/** The keys set aside on `path`: the server's and this browser's. */
export function asideKeys(path: string): ReadonlySet<string> {
  const hit = cache.get(path)
  if (hit && hit.v === version) return hit.keys
  const keys = new Set([...(server[path] ?? []), ...readLocal(path)])
  cache.set(path, { v: version, keys })
  return keys
}

/** Set aside, or bring back: at once on the screen, then on the server. */
export function toggleAside(path: string, key: string): void {
  const had = asideKeys(path).has(key)
  const next = (list: string[] | undefined) => (had ? (list ?? []).filter(k => k !== key) : [...new Set([...(list ?? []), key])])
  server = { ...server, [path]: next(server[path]) }
  const local = readLocal(path)
  if (had) local.delete(key)
  writeLocal(path, local)
  bump()
  void (had ? bringNeedBack(path, key) : setNeedAside(path, key)).then(ok => {
    if (!ok && !had) { const l = readLocal(path); l.add(key); writeLocal(path, l); bump() }
  })
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  if (!loaded) void refreshAside()
  return () => { listeners.delete(l) }
}

/** Re-render when any mark changes; the version says so. */
export function useAsideVersion(): number {
  return useSyncExternalStore(subscribe, () => version)
}

/** The version, for a hook that wants to read again when a mark moves (the desk's rows). */
export const asideVersion = () => version
