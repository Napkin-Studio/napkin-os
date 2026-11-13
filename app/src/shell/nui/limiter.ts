// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

/** How many documents the desk reads at once. Each read opens and checks a whole document on the server,
 *  and ten at once held a document being opened behind them for 3 s on UAT (2026-11-12). */
export const READING = 2

/** Runs tasks with at most `n` in flight, in the order given. */
export function limiter(n: number) {
  let active = 0
  const waiting: (() => void)[] = []
  const next = () => {
    if (active >= n || !waiting.length) return
    active++
    waiting.shift()!()
  }
  return <T,>(task: () => Promise<T>): Promise<T> => new Promise<T>((resolve, reject) => {
    waiting.push(() => { task().then(resolve, reject).finally(() => { active--; next() }) })
    next()
  })
}
