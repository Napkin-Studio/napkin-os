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
// The document open in the shell is left to its own page: it polls its jobs
// and reloads what they wrote, and a watcher racing it would leave the page's
// poll with `already applied` and nothing to redraw from.

import type { Host, LibraryItem } from '../../host'

export type SettleHost = Pick<Host, 'settleJob'>

/** A job's poll failed this many times in a row: leave it alone until a reload. */
export const GIVE_UP_AFTER = 3

/** A job polled for longer than this is polled at `SLOW_POLL_MS`, not on every read. */
export const SLOW_AFTER_MS = 60_000
/** How often a slow job is polled: one polled for over a minute, or waiting on a person. */
export const SLOW_POLL_MS = 30_000

/** The job's last answer said it waits on a person (`job_status` → `data.job.state`). */
const waitsOnAPerson = (reply: unknown): boolean =>
  (reply as { data?: { job?: { state?: unknown } } } | null)?.data?.job?.state === 'needs_input'

/**
 * A watcher's memory: what is being polled now, how often each job's poll
 * failed, and when each job is next due. `settle(items)` polls every unsettled
 * job that is due and not already in flight, and resolves when all have
 * answered. A job is due on every read (about 5 s) for its first minute; after
 * that, or once its answer says it waits on a person (`needs_input`), every
 * `SLOW_POLL_MS`. `open` is the document open in the shell, whose jobs its page
 * polls; they are skipped. Without `settleJob` on the host it does nothing.
 * `now` is the clock (tests pass their own).
 */
export function makeSettler(host: SettleHost, now: () => number = Date.now) {
  const inFlight = new Set<string>()
  const failed = new Map<string, number>()
  const firstPolled = new Map<string, number>()
  const nextAt = new Map<string, number>()
  const settle = async (items: LibraryItem[], open?: string | null): Promise<void> => {
    const poll = host.settleJob
    if (!poll) return
    const todo: Promise<void>[] = []
    for (const item of items) {
      if (open && item.path === open) continue
      for (const job of item.jobs ?? []) {
        const key = `${item.path}\u0000${job}`
        if (inFlight.has(key) || (failed.get(key) ?? 0) >= GIVE_UP_AFTER) continue
        const t = now()
        if (t < (nextAt.get(key) ?? 0)) continue
        if (!firstPolled.has(key)) firstPolled.set(key, t)
        inFlight.add(key)
        todo.push(
          poll.call(host, item.path, job).then(
            reply => {
              failed.delete(key)
              const slow = waitsOnAPerson(reply) || t - (firstPolled.get(key) ?? t) > SLOW_AFTER_MS
              if (slow) nextAt.set(key, t + SLOW_POLL_MS)
              else nextAt.delete(key)
            },
            () => { failed.set(key, (failed.get(key) ?? 0) + 1) },
          ).finally(() => { inFlight.delete(key) }),
        )
      }
    }
    await Promise.all(todo)
  }
  return { settle, inFlight, failed, nextAt }
}
