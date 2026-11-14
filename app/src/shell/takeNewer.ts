// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Update, on the alert that says the document moved on while the person typed (a 409): read the newer version, give it to the page
// (the bridge swaps it in and the page redraws, as after an undo), and only then settle the alert. Where the newer version cannot
// be read, nothing is settled: the alert stays, with what to do. What the person typed is held by the queue until then.

export interface NewerDeps {
  read: () => Promise<{ data: Record<string, unknown> }>
  push: (data: Record<string, unknown>) => void
  queue: { forgetChanged: () => void }
}

/** Null when the newer version was taken; else the line to say. */
export async function takeNewerVersion(d: NewerDeps): Promise<string | null> {
  try {
    const now = await d.read()
    d.push(now.data)
  } catch {
    return 'Could not read the newer version. Check your connection and press Update again.'
  }
  d.queue.forgetChanged()
  return null
}
