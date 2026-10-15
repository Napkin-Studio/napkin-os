// What production-ui lends the shared node cards (canvas/nodes/cards.tsx through
// CardChromeContext): the bar's node icon, the node title rule and the full cast's
// figures (at work in place of any loader, ui-behaviour 6.5), and an empty node's prompt start. The stage provides it over both the Excalidraw
// overlay (BoardsLayer) and the own engine's node layer, so both draw one card.

import { createElement } from 'react'
import type { CardChrome } from '../nodes/cardChrome'
import { AgentFigure } from '../../ui/agents/AgentFigure'
import { NodeIcon } from '../../ui/chrome/Bar'
import { nodeTitle } from '../../ui/chrome/panels'
import { PromptStart } from '../../ui/prompt/PromptStart'

export const PRODUCTION_CARD_CHROME: CardChrome = {
  icon: (kind) => createElement(NodeIcon, { kind }),
  title: nodeTitle,
  agent: (agent, working) => createElement(AgentFigure, { agent, size: 24, decorative: true, ...(working ? { state: 'working' as const } : {}) }),
  // An empty card's start (features/prompt-start.clan), in the cards' slot (canvas-nodes).
  PromptStart: (p) => createElement(PromptStart, { ...p, place: 'card' }),
}
