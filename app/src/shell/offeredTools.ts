// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The tools a person's role is offered (the server's list, features/align-landing-look.clan), held for the places that
// list tools but are not under the desk: Continue in. The desk, the dial and the client's page take the same list as a
// prop. Null offers every tool, as for a person with no role.

let offered: ReadonlySet<string> | null = null
const subs = new Set<() => void>()

export function setOfferedTools(tools: readonly string[] | null): void {
  offered = tools ? new Set(tools) : null
  subs.forEach(f => f())
}

export const offeredTools = (): ReadonlySet<string> | null => offered
export function subscribeOffered(f: () => void): () => void {
  subs.add(f)
  return () => { subs.delete(f) }
}
