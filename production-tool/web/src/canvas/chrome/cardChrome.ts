// What production-ui lends the shared node cards (canvas/nodes/cards.tsx through
// CardChromeContext): the bar's node icon, the node title rule, the Napkin loader
// and the full cast's figures. The stage provides it over both the Excalidraw
// overlay (BoardsLayer) and the own engine's node layer, so both draw one card.

import { createElement } from 'react'
import type { CardChrome } from '../nodes/cardChrome'
import { AgentFigure } from '../../ui/agents/AgentFigure'
import { NodeIcon } from '../../ui/chrome/Bar'
import { nodeTitle } from '../../ui/chrome/panels'
import { NapkinLoader } from '../../ui/loader/NapkinLoader'
import { PromptStart, type PromptStartProps } from '../../ui/prompt/PromptStart'

export const PRODUCTION_CARD_CHROME: CardChrome = {
  icon: (kind) => createElement(NodeIcon, { kind }),
  title: nodeTitle,
  loader: (work) => createElement(NapkinLoader, { work, size: 16 }),
  agent: (agent, working) => createElement(AgentFigure, { agent, size: 24, decorative: true, ...(working ? { state: 'working' as const } : {}) }),
  ...{ PromptStart: (p: PromptStartProps) => createElement(PromptStart, p) }, // an empty card's start (features/prompt-start.clan; canvas-nodes' slot)
}
