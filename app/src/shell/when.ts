// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Time in words, shared by the Launcher and the landing.

/** The greeting, by the local time of day. */
export function greeting(now = new Date()): string {
  const h = now.getHours()
  return h < 12 ? 'Good morning.' : h < 18 ? 'Good afternoon.' : 'Good evening.'
}

/** When a document was last worked on, as a person would say it. */
export function lastTouched(iso: string, now = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((day(now) - day(d)) / 86_400_000)
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  if (days <= 0) return `Today, ${time}`
  if (days === 1) return `Yesterday, ${time}`
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' })
  return d.toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  })
}
