// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Fetching a file the server makes on demand (an export), so the shell knows
// whether it came. A plain link click hands a failed render to the browser's
// downloads list and tells the shell nothing: it said "Exported" while the
// PDF never arrived (features/pdf-export.clan).

/**
 * Fetch `url` and give back its bytes, or throw with the server's own reason
 * (`{error}` in a JSON reply) when it answers anything but 2xx.
 */
export async function fetchFile(url: string, fetchImpl: typeof fetch = fetch): Promise<Blob> {
  const r = await fetchImpl(url, { credentials: 'same-origin' })
  if (!r.ok) {
    const why = await r.json().then((b: { error?: unknown }) => b?.error).catch(() => null)
    throw new Error(typeof why === 'string' && why ? why : `The server answered ${r.status}.`)
  }
  return r.blob()
}
