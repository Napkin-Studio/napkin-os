// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// /states.html: the gallery of the nine screen states (features/screen-states.clan).
// `?mode=white|grey|black` shows one mode only, as a screenshot wants it.

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import '../shell/nui/tokens.css'
import '../components/chrome.css'
import { Gallery } from '../components/states/Gallery'
import { MODES, type Mode } from '../components/states/words'

const asked = new URLSearchParams(location.search).get('mode')
const one = MODES.find(m => m === asked) as Mode | undefined
const paper = { white: '#FFFDF8', grey: '#DEDAD0', black: '#1B1A18' }
document.body.style.margin = '0'
document.body.style.background = paper[one ?? 'white']

createRoot(document.getElementById('root')!).render(
  <StrictMode><Gallery modes={one ? [one] : MODES} /></StrictMode>,
)
