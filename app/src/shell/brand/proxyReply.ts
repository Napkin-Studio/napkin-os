// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The host's `/api-proxy` reply, `{ok, data}` around the middleware's own envelope, read the way an app's page reads it (Brief Maker's mwBody).

import { BrandError } from './brandFlow'

export interface Envelope { job?: { id?: string; state?: string; error?: { type?: string; message?: string } | null }; result?: Record<string, unknown>; error?: { type?: string; message?: string } }

/** The proxy's reply, `{ok, data}` around the middleware's own: the envelope, or a BrandError with the service's type and words. */
export function unwrap(status: number, body: unknown): Envelope {
  const b = body as { ok?: unknown; data?: unknown; error?: unknown; status?: unknown } | null
  const data = (b && typeof b === 'object' && 'ok' in b && 'data' in b ? b.data : b) as Envelope | null
  const failed = (b && b.ok === false) || status >= 400
  const err = data?.error ?? (typeof b?.error === 'object' ? (b?.error as Envelope['error']) : null)
  if (failed || err) {
    const type = err?.type ?? 'unreachable'
    const msg = err?.message ?? (typeof b?.error === 'string' ? b.error : '') ?? ''
    throw new BrandError(type, String(msg), typeof b?.status === 'number' ? b.status : status)
  }
  return data ?? {}
}

