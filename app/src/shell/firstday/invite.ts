// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What the invite asks the server, apart from the sheet that draws it (features/first-day.clan).

export interface InviteDoc { path: string; title: string; job: string; client: string }

export interface InviteApi {
  invite(id: string, body: { first?: { path: string }; mail?: boolean }): Promise<{ person: string; link: string; mailed: boolean; note?: string }>
}

/** Ask for the link: the first thing, and whether to mail it (to the address the People store holds, never one typed here). The server's own words when it refuses, or when it did not mail. */
export async function makeInvite(api: InviteApi, id: string, form: { first: string; mail: boolean }): Promise<{ ok: true; link: string; mailed: boolean; note: string | null } | { ok: false; error: string }> {
  const body: { first?: { path: string }; mail?: boolean } = {}
  if (form.first) body.first = { path: form.first }
  if (form.mail) body.mail = true
  try {
    const r = await api.invite(id, body)
    return { ok: true, link: r.link, mailed: r.mailed, note: r.note ?? null }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
