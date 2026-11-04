// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Reading the landing's data through the host, and nothing else. No component
// and no template fetches: this takes a `Host` (or a fake in a test) and returns
// plain data. The shell's hook (useLanding) is a thin loop over these.

import type { Adopted, ClientMaterial, ClientRecord, Host, LegacyName, LibraryItem, Person } from '../../host'

/** The part of `Host` the landing uses. */
export type LandingHost = Pick<Host, 'listLibrary' | 'whoAmI' | 'listApps'> & { clients: Pick<Host['clients'], 'list' | 'create'> }

/** What the clients page needs to look after the registry: rename, archive, restore, adopt. */
export type ManageHost = { clients: Pick<Host['clients'], 'list' | 'update' | 'archive' | 'restore' | 'adopt' | 'legacy'> }

export interface LandingData {
  clients: ClientRecord[]
  items: LibraryItem[]
  unassigned: number
  person: Person | null
  /** App ids installed here: which tools are live. */
  apps: string[]
  /** Set when the host could not read the client registry. */
  registryError?: string
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
    ...(listing.registry_error ? { registryError: listing.registry_error } : {}),
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

/** What a refusal says: the host's own words, else `fallback`. */
export function refusal(e: unknown, fallback: string): string {
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  return msg.trim() || fallback
}

/** Rename a client. Resolves with null on success, or the host's words (a name in use is refused). */
export async function renameClient(h: ManageHost, id: string, name: string): Promise<string | null> {
  try {
    await h.clients.update(id, { name })
    return null
  } catch (e) {
    return refusal(e, 'The client could not be renamed.')
  }
}

/** Archive or restore a client. Its work is kept either way. */
export async function setArchived(h: ManageHost, id: string, archived: boolean): Promise<string | null> {
  try {
    await (archived ? h.clients.archive(id) : h.clients.restore(id))
    return null
  } catch (e) {
    return refusal(e, archived ? 'The client could not be archived.' : 'The client could not be restored.')
  }
}

/** The archived clients, newest archive first. */
export async function loadArchived(h: ManageHost): Promise<ClientRecord[]> {
  const all = await h.clients.list(true)
  return all
    .filter(c => !!c.archived_at)
    .sort((a, b) => (b.archived_at ?? '').localeCompare(a.archived_at ?? ''))
}

/** Free-text names in the documents that no client has yet. */
export async function loadLegacy(h: ManageHost): Promise<LegacyName[]> {
  return h.clients.legacy()
}

/** Turn the chosen names into clients and link their documents; says what happened in words. */
export async function adoptNames(
  h: ManageHost,
  names: string[],
): Promise<{ done: Adopted; words: string } | { error: string }> {
  if (names.length === 0) return { error: 'Choose at least one name to adopt.' }
  try {
    const done = await h.clients.adopt(names)
    return { done, words: adoptedWords(done) }
  } catch (e) {
    return { error: refusal(e, 'The clients could not be adopted.') }
  }
}

/** "Adopted 2 clients and linked 5 documents." */
export function adoptedWords(a: Adopted): string {
  const c = a.created.length
  const made = c === 0 ? 'No new clients' : `Added ${c} client${c === 1 ? '' : 's'}`
  return `${made}, linked ${a.linked} document${a.linked === 1 ? '' : 's'}.`
}
