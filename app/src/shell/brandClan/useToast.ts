// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// A toast that shows for a few seconds.

import { useCallback, useEffect, useRef, useState } from 'react'

export interface ToastLine { title: string; body?: string; error?: boolean }

/** `say` replaces whatever is showing. */
export function useToast(ms = 6000): { toast: ToastLine | null; say: (t: ToastLine) => void } {
  const [toast, setToast] = useState<ToastLine | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const say = useCallback((t: ToastLine) => {
    setToast(t)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), ms)
  }, [ms])
  useEffect(() => () => clearTimeout(timer.current), [])
  return { toast, say }
}

