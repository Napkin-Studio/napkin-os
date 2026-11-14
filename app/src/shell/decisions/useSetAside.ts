// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The items a person has set aside on a document (decisions/needs.ts splitAside), theirs alone and kept by the server
// (decisions/asideStore.ts). A set-aside item that blocks the lock still blocks it.

import { useCallback } from 'react'
import { asideKeys, toggleAside, useAsideVersion } from './asideStore'

export interface SetAside {
  keys: ReadonlySet<string>
  /** Set it aside, or bring it back. */
  toggle: (key: string) => void
}

export function useSetAside(docPath: string): SetAside {
  useAsideVersion()
  const toggle = useCallback((key: string) => toggleAside(docPath, key), [docPath])
  return { keys: asideKeys(docPath), toggle }
}
