// The agents are role spheres (features/production-new-ui.clan): the shell's one agent engine
// (app/src/shell/agents/AgentSphere.tsx, imported, never copied), with the production roles added once
// (productionRoles.ts). The crew keys stay as stored (dex, skye, wren, rhea, edie, jude, ellis) and map to
// roles only here, at the surface (ROLE_OF), so a later naming change is one table. AgentFigure and
// AgentAvatar keep their props, so every place that drew a figure draws the sphere.

import type { CSSProperties } from 'react'
import AgentSphere from '@napkin/app/shell/agents/AgentSphere'
import { CAST, ROLE_OF, type AgentState, type CastKey } from './cast'
import './productionRoles'

const SPHERE_STATE = { idle: 'idle', working: 'working', 'needs-you': 'needs' } as const

export interface AgentFigureProps {
  agent: CastKey
  /** The box in px (the figures' old height): the sphere takes most of it. Default 64. */
  size?: number
  /** idle, working (the arcs travel), needs-you (the needs state). */
  state?: AgentState
  /** Kept for callers that moved a figure; a sphere does not walk. */
  walking?: boolean
  /** Hidden from assistive tech when the words beside it already say who and what. */
  decorative?: boolean
  className?: string
  style?: CSSProperties
}

/** A sphere side for a box the figures used: small ones keep their size, large ones are a little smaller. */
const sphereSize = (size: number) => (size <= 28 ? size : Math.round(size * 0.72))

export function AgentFigure({ agent, size = 64, state = 'idle', decorative = false, className, style }: AgentFigureProps) {
  const a = CAST[agent] ?? CAST.dex
  const label = decorative ? '' : `${a.given}, ${a.role}${state === 'needs-you' ? ', needs you' : state === 'working' ? ', working' : ''}`
  return (
    <span className={['agent-figure', 'af-sphere', className].filter(Boolean).join(' ')} data-agent={agent} data-state={state} style={style}>
      <AgentSphere agent={ROLE_OF[agent] ?? 'director'} size={sphereSize(size)} state={SPHERE_STATE[state]} label={label} />
    </span>
  )
}

export interface AgentAvatarProps {
  agent: CastKey
  /** Side in px. Default 38. */
  size?: number
  decorative?: boolean
  className?: string
  style?: CSSProperties
}

/** The sphere at rest, at avatar size (the crew sheet, Home). */
export function AgentAvatar({ agent, size = 38, decorative = false, className, style }: AgentAvatarProps) {
  return <AgentFigure agent={agent} size={size} decorative={decorative} className={['agent-avatar', className].filter(Boolean).join(' ')} style={style} />
}
