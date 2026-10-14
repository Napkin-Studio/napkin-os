// What the chrome lends the node cards (features/canvas-nodes.clan): its node
// icon, its title rule, its loader and its agent figures. feat/production-ui
// provides its own (ui/chrome/Bar NodeIcon, ui/chrome/panels nodeTitle,
// ui/loader/NapkinLoader, the full cast) through CardChromeContext; these are the
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
  loader(work: 'plan' | 'produce' | 'create'): ReactNode
  agent(agent: Agent, working: boolean): ReactNode
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
  loader: () => null,
  agent: (agent, working) => (CAST.includes(agent)
    ? createElement(AgentFigure, { agent: agent as CastKey, size: 24, decorative: true, ...(working ? { state: 'working' as const } : {}) })
    : null),
}

export const CardChromeContext = createContext<CardChrome>(DEFAULT_CHROME)
