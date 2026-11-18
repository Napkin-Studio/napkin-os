// The Campaign board's header words (QA 2026-11-17: "1 formats"; a failed size counted as "making").

import type { Size } from '../contracts/types'

export interface BoardCounts { ready: number; look: number; making: number; failed: number; notMade: number }

/** Each size once: a size whose job failed is failed, whatever its stored status still says. */
export function boardCounts(sizes: readonly Size[], failed: (s: Size) => boolean): BoardCounts {
  const c: BoardCounts = { ready: 0, look: 0, making: 0, failed: 0, notMade: 0 }
  for (const s of sizes) {
    if (failed(s)) c.failed++
    else if (s.status === 'ready') c.ready++
    else if (s.status === 'look') c.look++
    else if (s.status === 'making') c.making++
    else if (!s.status) c.notMade++
  }
  return c
}

const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`

/** "11 formats · 9 ready · 1 needs a look · 1 failed". */
export function countLine(total: number, c: BoardCounts): string {
  return [n(total, 'format'), `${c.ready} ready`, c.look ? `${c.look} ${c.look === 1 ? 'needs' : 'need'} a look` : '',
    c.making ? `${c.making} making` : '', c.failed ? `${c.failed} failed` : '', c.notMade ? `${c.notMade} not made yet` : '']
    .filter(Boolean).join(' · ')
}

/** The Make all sizes sheet's foot (QA 2026-11-17: "11 of 17 can be made now" after unticking 6 that could). */
export function sheetLine(on: number, unticked: number, unavailable: number, paid: number): string {
  return [`${n(on, 'size')} to make`, unticked ? `${unticked} left out` : '', unavailable ? `${unavailable} cannot be made now` : '',
    paid ? `${paid} on a model (cost in Decisions)` : ''].filter(Boolean).join(' · ')
}
