// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The agents, by role, each as its sphere: what the "Your agents" modal shows.

import AgentSphere from './AgentSphere'
import { roles } from './engine'

const SHOWN = ['knowledge', 'strategy', 'research', 'brief', 'review', 'deck'] as const

export default function AgentGallery() {
  return (
    <ul className="ag-gallery" data-testid="agent-gallery" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 16, listStyle: 'none', padding: 0, margin: '12px 0 0' }}>
      {SHOWN.map(r => (
        <li key={r} style={{ display: 'grid', justifyItems: 'center', gap: 6, textAlign: 'center' }}>
          <AgentSphere agent={r} size={88} label="" />
          <b style={{ fontSize: 14 }}>{roles.name(r)}</b>
          <span className="mono" style={{ fontSize: 10.5, letterSpacing: '.06em', color: 'var(--ink3, #6F757F)' }}>{roles.mat(r).toUpperCase()} SPHERE</span>
          <span style={{ fontSize: 12.5, color: 'var(--ink2, #3C4048)' }}>{roles.job(r).replace(/^./, c => c.toUpperCase())}.</span>
        </li>
      ))}
    </ul>
  )
}
