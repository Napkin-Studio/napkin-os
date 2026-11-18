// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The six tools a client's circle carries, and the one table that says which
// installed app each is. Idea is dimmed "Soon": it is not built. Prod is the
// Production Tool, which is not an installed app: napkin-web serves it at
// /production (features/os-sign-in.clan), and its tile opens it there, in the
// tool's own UI, when the server says it is served (features/production-tool-land.clan).

import type { InstalledApp } from '../../host'
import type { ToolId } from '../route'

export interface Tool {
  id: ToolId
  /** On the circle. */
  name: string
  /** In words, as the app calls itself. */
  full: string
  /** The installed app that serves it, when there is one at all. */
  appId: string | null
  /** What a document of this tool is called, and many. */
  noun: readonly [string, string]
}

export const TOOLS: readonly Tool[] = [
  { id: 'brief', name: 'Brief', full: 'Brief Maker', appId: 'ie.napkin.brief-maker', noun: ['brief', 'briefs'] },
  { id: 'research', name: 'Research', full: 'Research Tool', appId: 'ie.napkin.campaign-research', noun: ['research', 'research'] },
  { id: 'idea', name: 'Idea', full: 'Idea', appId: null, noun: ['idea', 'ideas'] },
  { id: 'deck', name: 'Deck', full: 'Deck Maker', appId: 'ie.napkin.deck-maker', noun: ['deck', 'decks'] },
  { id: 'prod', name: 'Prod', full: 'Production Tool', appId: null, noun: ['production', 'productions'] },
  // Advertising Studio is retired (the Production Tool replaces it; features/os-sign-in.clan D15) and no
  // longer built. Its id stays so the ads its old documents made still file under Ads.
  { id: 'ads', name: 'Ads', full: 'Advertising Studio', appId: 'ie.napkin.film', noun: ['ad', 'ads'] },
]

export const toolById = (id: string): Tool | undefined => TOOLS.find(t => t.id === id)

/** The tool an app id belongs to. */
export const toolOfApp = (appId: string | null | undefined): Tool | undefined =>
  appId ? TOOLS.find(t => t.appId === appId) : undefined

/** A tool is live when it has an app and that app is installed; otherwise it is "Soon". */
export function isLive(tool: Tool, installed: readonly Pick<InstalledApp, 'app_id'>[]): boolean {
  return tool.appId !== null && installed.some(a => a.app_id === tool.appId)
}

/** The Production Tool's path on this origin. */
export const PRODUCTION_PATH = '/production/'

/** Where a tool opens with a full page load, outside the shell (Prod: the Production Tool), or null
 *  when it opens as the shell's own tool page. */
export const toolHref = (tool: { id: string }): string | null => (tool.id === 'prod' ? PRODUCTION_PATH : null)

/** The tools a person can open now: each whose app is installed, and Prod when this server serves
 *  the Production Tool to this person (/api/session `production`). */
export function liveTools(installed: readonly Pick<InstalledApp, 'app_id'>[], production: boolean): Set<string> {
  const live = new Set(TOOLS.filter(t => isLive(t, installed)).map(t => t.id as string))
  if (production) live.add('prod')
  return live
}
