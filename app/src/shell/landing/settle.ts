// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Jobs that end after their page closed (features/new-ui-shell). A page polls
// its own middleware jobs and the host applies each change it brings back; once
// the person leaves the document nobody polls, and the answer never lands. The
// library listing names each document's unsettled jobs (`LibraryItem.jobs`),
// and on every read the landing's watcher polls them through the host
// (`Host.settleJob`, the page's own `job_status` path). The host applies a
// change once: a second poll, the page's or this one, is `already applied`.

import type { Host, LibraryItem } from '../../host'

export type SettleHost = Pick<Host, 'settleJob'>

/** A job's poll failed this many times in a row: leave it alone until a reload. */
export const GIVE_UP_AFTER = 3

/**
 * A watcher's memory: what is being polled now, and how often each job's poll
 * failed. `settle(items)` polls every unsettled job not already in flight, and
 * resolves when all have answered. Without `settleJob` on the host it does nothing.
 */
export function makeSettler(host: SettleHost) {
  const inFlight = new Set<string>()
  const failed = new Map<string, number>()
  const settle = async (items: LibraryItem[]): Promise<void> => {
    const poll = host.settleJob
    if (!poll) return
    const todo: Promise<void>[] = []
    for (const item of items) {
      for (const job of item.jobs ?? []) {
        const key = `${item.path}\u0000${job}`
        if (inFlight.has(key) || (failed.get(key) ?? 0) >= GIVE_UP_AFTER) continue
        inFlight.add(key)
        todo.push(
          poll.call(host, item.path, job).then(
            () => { failed.delete(key) },
            () => { failed.set(key, (failed.get(key) ?? 0) + 1) },
          ).finally(() => { inFlight.delete(key) }),
        )
      }
    }
    await Promise.all(todo)
  }
  return { settle, inFlight, failed }
}
