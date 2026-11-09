// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// <AgentSphere agent="Knowledge" size={28} state="working" />: a thin wrapper
// over the one agent engine (engine.ts). The static frame of the same sphere
// draws first (and stays without WebGL); the live view then takes the box on
// the shell's one scene. Any size; the state comes from the caller.

import { useEffect, useRef } from 'react'
import './AgentSphere.css'
import { loadScene, roles, type SphereHandle, type SphereState } from './engine'

export interface AgentSphereProps {
  /** A role, or anything that names an agent (a stage id, a stored actor). */
  agent: string
  size?: number
  state?: SphereState
  progress?: number | readonly [number, number]
  next?: string
  /** What a screen reader hears; the role's name by default. Empty: decorative. */
  label?: string
  className?: string
}

export default function AgentSphere({ agent, size = 28, state = 'idle', progress, next, label, className }: AgentSphereProps) {
  const box = useRef<HTMLSpanElement>(null)
  const view = useRef<SphereHandle | null>(null)
  const role = roles.of(agent) || 'orchestrator'
  const said = label ?? `${roles.name(role)}${state === 'working' ? ', working' : state === 'needs' ? ', needs you' : ''}`
  const p0 = Array.isArray(progress) ? progress[0] : progress
  const p1 = Array.isArray(progress) ? progress[1] : undefined

  useEffect(() => {
    let gone = false
    const el = box.current
    if (!el) return
    void loadScene().then(() => {
      if (gone || !box.current) return
      const h = roles.mount(el, { agent: role, state, progress, next, size })
      if (h.live) { el.setAttribute('data-live', ''); view.current = h } else h.destroy()
    })
    return () => { gone = true; view.current?.destroy(); view.current = null; el.removeAttribute('data-live') }
    // a new size is a new view; the rest is told to the live one below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size])

  useEffect(() => {
    view.current?.set({ agent: role, state, progress: p1 != null ? [p0 ?? 0, p1] : p0, next })
  }, [role, state, p0, p1, next])

  return (
    <span
      ref={box}
      className={`nk-ag${className ? ` ${className}` : ''}`}
      data-agent={role}
      data-state={state}
      style={{ display: 'inline-block', position: 'relative', flex: 'none', width: size, height: size, verticalAlign: 'middle' }}
      {...(said ? { role: 'img', 'aria-label': said } : { 'aria-hidden': true })}
    >
      <span className="nk-ag-still" dangerouslySetInnerHTML={{ __html: roles.still(role, size) }} />
    </span>
  )
}
