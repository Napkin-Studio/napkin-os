// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { useEffect, type ReactNode } from 'react'
import { setScreen } from '../dogfood/recorder'
import './StudioShell.css'

interface Props {
  /** The home screen: the desk, or the apps launcher. */
  children: ReactNode
  /** The one OS bar (components/Toolbar.tsx), in its desk state. */
  bar: ReactNode
}

/** The studio frame: the OS bar, and under it the home screen filling the rest. */
export default function StudioShell({ children, bar }: Props) {
  // the dogfood build records where people go (a no-op elsewhere)
  useEffect(() => { setScreen({ screen: 'home' }) }, [])
  return (
    <div className="studio">
      <header className="studio-top">{bar}</header>
      <main className="studio-panel">
        {children}
      </main>
    </div>
  )
}
