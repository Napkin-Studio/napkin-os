// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The six tools a client's circle carries, and the one table that says which
// installed app each is. Idea and Prod are dimmed "Soon": Idea is not built,
// and the Production Tool has its own stack and no client link yet.

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
  { id: 'idea', name: 'Idea', full: 'Idea', appId: 'ie.napkin.idea-room', noun: ['idea', 'ideas'] },
  { id: 'deck', name: 'Deck', full: 'Deck Maker', appId: 'ie.napkin.deck-maker', noun: ['deck', 'decks'] },
  { id: 'prod', name: 'Prod', full: 'Production Tool', appId: null, noun: ['production', 'productions'] },
  // Advertising Studio's id is the one it has always carried (examples/make_advertising_studio.rs).
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
