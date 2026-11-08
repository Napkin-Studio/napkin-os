// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The needs a person has set aside on a document (decisions/needs.ts
// splitAside): theirs alone, kept in this browser per document, so it survives
// a reload but never reaches anyone else or the document. Nothing here writes
// a decision: a set-aside need still blocks the lock.

import { useCallback, useState } from 'react'

const KEY = 'napkin.setAside:'

function read(docPath: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(KEY + docPath)
    const list = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string') : [])
  } catch {
    return new Set()
  }
}

function write(docPath: string, keys: Set<string>) {
  try {
    if (keys.size) window.localStorage.setItem(KEY + docPath, JSON.stringify([...keys]))
    else window.localStorage.removeItem(KEY + docPath)
  } catch { /* storage blocked: it holds for this visit only */ }
}

export interface SetAside {
  keys: ReadonlySet<string>
  /** Set it aside, or bring it back. */
  toggle: (key: string) => void
}

export function useSetAside(docPath: string): SetAside {
  const [got, setGot] = useState<{ docPath: string; keys: Set<string> }>(() => ({ docPath, keys: read(docPath) }))
  // Another document: its own list, read once when it opens.
  const mine = got.docPath === docPath ? got : { docPath, keys: read(docPath) }
  if (mine !== got) setGot(mine)
  const toggle = useCallback((key: string) => {
    setGot(g => {
      const keys = new Set(g.docPath === docPath ? g.keys : read(docPath))
      if (keys.has(key)) keys.delete(key)
      else keys.add(key)
      write(docPath, keys)
      return { docPath, keys }
    })
  }, [docPath])
  return { keys: mine.keys, toggle }
}
