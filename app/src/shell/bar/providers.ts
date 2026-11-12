// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The bar's seam for what it shows (features/one-bar-search.clan): results come from providers behind one
// interface. Search and the command table are two; Ask Nap and the microphone plug in as more, from their own
// folders, without touching the bar or the toolbar. The bar owns three seams and this record builds them
// empty: this provider list, a slot inside the field (BarField's `slot`) and a panel slot (BarMount's `panelSlot`).

import { barSearch } from '../../host/http'
import { matchCommands, type Command } from './commands'

/** What Enter does with a result. */
export type Act =
  | { type: 'route'; hash: string }
  | { type: 'document'; path: string }
  | { type: 'person'; name: string; line: string; jobs: string[] }
  | { type: 'command'; command: Command }

export interface BarResult {
  /** Unique within the list. */
  key: string
  kind: string
  title: string
  line: string
  act: Act
}

export interface BarGroup {
  id: string
  label: string
  items: BarResult[]
}

export interface ProviderContext {
  commands: readonly Command[]
}

export interface BarProvider {
  id: string
  /** Groups for a non-empty query. May be async; an aborted call's answer is dropped. */
  results: (query: string, ctx: ProviderContext, signal: AbortSignal) => BarGroup[] | Promise<BarGroup[]>
}

export const GROUP_LABEL: Record<string, string> = {
  job: 'Jobs', brief: 'Briefs', script: 'Scripts', idea: 'Ideas', document: 'Documents', asset: 'Assets',
  client: 'Clients', person: 'People', command: 'Commands', recent: 'Recent', go: 'Go to',
}
/** The kind, as one word a screen reader says before the title. */
export const KIND_WORD: Record<string, string> = {
  job: 'Job', brief: 'Brief', script: 'Script', idea: 'Idea', document: 'Document', asset: 'Asset',
  client: 'Client', person: 'Person', command: 'Command', recent: 'Recent',
}

export const commandResult = (c: Command): BarResult => ({ key: `command:${c.id}`, kind: 'command', title: c.title, line: '', act: { type: 'command', command: c } })

/** The command table, as a provider: synchronous. */
export const commandProvider: BarProvider = {
  id: 'commands',
  results: (q, ctx) => {
    const hits = matchCommands(ctx.commands, q)
    return hits.length ? [{ id: 'command', label: GROUP_LABEL.command, items: hits.map(commandResult) }] : []
  },
}

/** The agency's own documents, jobs, clients and people, from the host's index: only what this person may open. */
export const searchProvider: BarProvider = {
  id: 'search',
  results: async (q, _ctx, signal) => {
    const answer = await barSearch(q, signal)
    if (!answer) return []
    return answer.groups.map(g => ({
      id: g.kind,
      label: GROUP_LABEL[g.kind] ?? g.kind,
      items: g.items.map(i => ({
        key: `${i.kind}:${i.id}`,
        kind: i.kind,
        title: i.title,
        line: i.line,
        act: i.open.action === 'route' ? { type: 'route' as const, hash: i.open.target }
          : i.open.action === 'document' ? { type: 'document' as const, path: i.open.target }
          : { type: 'person' as const, name: i.title, line: i.line, jobs: i.jobs ?? [] },
      })),
    }))
  },
}

const registry: BarProvider[] = [commandProvider, searchProvider]
const listeners = new Set<() => void>()

/** Add a provider (Ask Nap, voice); the returned function removes it. */
export function registerBarProvider(p: BarProvider): () => void {
  registry.push(p)
  listeners.forEach(l => l())
  return () => { const i = registry.indexOf(p); if (i >= 0) registry.splice(i, 1); listeners.forEach(l => l()) }
}
export const barProviders = (): readonly BarProvider[] => registry.slice()

/** Run every provider for `q`; a provider that fails is a provider with nothing to say. Groups of one id are joined. */
export async function runProviders(q: string, ctx: ProviderContext, signal: AbortSignal, providers: readonly BarProvider[] = barProviders()): Promise<BarGroup[]> {
  const all = await Promise.all(providers.map(async p => { try { return await p.results(q, ctx, signal) } catch { return [] } }))
  const joined: BarGroup[] = []
  for (const g of all.flat()) {
    const at = joined.find(x => x.id === g.id)
    if (at) at.items = [...at.items, ...g.items]
    else joined.push({ ...g, items: [...g.items] })
  }
  return joined
}
