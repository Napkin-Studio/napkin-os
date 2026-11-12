// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The one bar (features/one-bar-search.clan). Three seams for the records that come after it: the provider list
// (registerBarProvider: Ask Nap, voice), the field's slot (BarField's `slot`: the microphone) and the panel's slot
// (BarMount's `panelSlot`: Ask Nap's answer). They register from their own folders and touch neither the toolbar
// nor App.tsx.

import './bar.css'

export { BarField } from './BarField'
export { BarMount } from './BarMount'
export { openBar, closeBar, setHistory, openShortcuts } from './barStore'
export { registerBarProvider } from './providers'
export type { BarProvider, BarGroup, BarResult } from './providers'
