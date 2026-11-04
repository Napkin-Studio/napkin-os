// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Reading the landing's data through the host, and nothing else. No component
// and no template fetches: this takes a `Host` (or a fake in a test) and returns
// plain data. The shell's hook (useLanding) is a thin loop over these.

import type { ClientMaterial, ClientRecord, Host, LibraryItem, Person } from '../../host'

/** The part of `Host` the landing uses. */
export type LandingHost = Pick<Host, 'listLibrary' | 'whoAmI' | 'listApps'> & { clients: Pick<Host['clients'], 'list' | 'create'> }

export interface LandingData {
  clients: ClientRecord[]
  items: LibraryItem[]
  unassigned: number
  person: Person | null
  /** App ids installed here: which tools are live. */
  apps: string[]
}

/**
 * One read of everything the landing draws. Rejects if the host cannot answer
 * the library, or the app list on the first read (`lastApps` unset): a failure
 * must not read as "no tool is installed". Later reads keep `lastApps` instead.
 */
export async function loadLanding(h: LandingHost, lastApps?: string[]): Promise<LandingData> {
  const [clients, listing, person, apps] = await Promise.all([
    h.clients.list(false),
    h.listLibrary(),
    h.whoAmI().catch(() => null),
    h.listApps().then(
      list => list.map(a => a.app_id),
      e => { if (lastApps) return lastApps; throw e },
    ),
  ])
  return {
    clients,
    items: listing.items,
    unassigned: listing.clients_unassigned,
    person,
    apps,
  }
}

/** Open a client. Resolves with null on success, or the host's own words when it was refused. */
export async function addClient(h: LandingHost, name: string, material?: ClientMaterial): Promise<string | null> {
  try {
    await h.clients.create(name, material)
    return null
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return msg || 'The client could not be added.'
  }
}
