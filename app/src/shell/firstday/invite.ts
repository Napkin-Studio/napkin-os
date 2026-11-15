// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What the invite asks the server, apart from the sheet that draws it (features/first-day.clan).

export interface InviteDoc { path: string; title: string; job: string; client: string }

export interface InviteApi {
  invite(id: string, body: { first?: { path: string }; email?: string }): Promise<{ person: string; link: string; mailed: boolean }>
}

/** Ask for the link: the first thing and the address only; the server's own words when it refuses. */
export async function makeInvite(api: InviteApi, id: string, form: { first: string; email: string }): Promise<{ ok: true; link: string; mailed: boolean } | { ok: false; error: string }> {
  const body: { first?: { path: string }; email?: string } = {}
  if (form.first) body.first = { path: form.first }
  if (form.email.trim()) body.email = form.email.trim()
  try {
    const r = await api.invite(id, body)
    return { ok: true, link: r.link, mailed: r.mailed }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
