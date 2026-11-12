// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Whether the window is a phone's width (the shell's own breakpoint, 720 px): the bar is a field in the OS bar above it
// and one 44 px button, opening a full-width sheet, at or below it.

import { useSyncExternalStore } from 'react'

const QUERY = '(max-width: 720px)'

const subscribe = (cb: () => void) => {
  const m = window.matchMedia(QUERY)
  m.addEventListener('change', cb)
  return () => m.removeEventListener('change', cb)
}

export const usePhone = (): boolean => useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false)
