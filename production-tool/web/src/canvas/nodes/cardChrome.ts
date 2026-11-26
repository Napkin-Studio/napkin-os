// What the chrome lends the node cards (features/canvas-nodes.clan): its node
// icon, its title rule and its agent figures (a card at work shows the crew member
// working, never the Napkin loader: ui-behaviour 6.5). feat/production-ui
// provides its own (ui/chrome/Bar NodeIcon, ui/chrome/panels nodeTitle,
// the full cast) through CardChromeContext; these are the
// plain defaults, so the cards render on any branch.

import { createContext, createElement, type ReactNode } from 'react'
import { AgentFigure } from '../../ui/agents/AgentFigure'
import type { CastKey } from '../../ui/agents/cast'

export type CardKind = 'script' | 'storyboard' | 'video'
export type Agent = 'dex' | 'skye' | 'wren' | 'edie'

export interface CardChrome {
  icon(kind: CardKind): ReactNode
  /** The node's title: its own, else the ad's name, else the template word. */
  title(own: string | undefined, templateWord: string, project: string | undefined): string
  agent(agent: Agent, working: boolean): ReactNode
  /**
   * An empty node's start (ui-behaviour 3.3 Empty; ui/prompt): drawn in the card in place of the
   * "No script yet" line while the node is empty. Optional: without it the card keeps that line.
   */
  PromptStart?: (p: { kind: CardKind; nodeId: string }) => ReactNode
}

/** production-ui's nodeTitle rule (ui/chrome/panels.ts), as the default. */
export function defaultTitle(own: string | undefined, templateWord: string, project: string | undefined): string {
  if (own && own.trim() && own.trim() !== templateWord && !/^untitled/i.test(own.trim())) return own.trim()
  const ad = project?.split(' · ').at(-1)?.trim()
  return ad && !/^untitled/i.test(ad) ? ad : templateWord
}

const CAST: readonly string[] = ['dex', 'ellis', 'jude', 'skye']

export const DEFAULT_CHROME: CardChrome = {
  icon: (kind) => createElement('span', { className: 'bl-icon', 'aria-hidden': 'true' }, kind === 'script' ? '✎' : kind === 'storyboard' ? '▦' : '▶'),
  title: defaultTitle,
  agent: (agent, working) => (CAST.includes(agent)
    ? createElement(AgentFigure, { agent: agent as CastKey, size: 24, decorative: true, ...(working ? { state: 'working' as const } : {}) })
    : null),
}

export const CardChromeContext = createContext<CardChrome>(DEFAULT_CHROME)
