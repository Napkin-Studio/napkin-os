// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Whether this person's first-day pointers are still to show: the server's mark, per person, read once and ended once
// (`GET` and `POST /me/first-day`). Nothing is kept in the browser.

import { useCallback, useEffect, useState } from 'react'
import { firstDayShow, markFirstDay } from '../../host/http'

export function useFirstDay(enabled: boolean): { show: boolean; end: () => void } {
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (!enabled) return
    let live = true
    void firstDayShow().then(v => { if (live) setShow(v) })
    return () => { live = false }
  }, [enabled])
  const end = useCallback(() => { setShow(false); void markFirstDay({ seen: true }) }, [])
  return { show, end }
}
