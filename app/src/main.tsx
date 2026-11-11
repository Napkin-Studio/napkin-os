// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { isDesktop, isViewerRoute, serverless } from './host'
import { SignInGate } from './shell/SignIn'
import { DogfoodGate } from './dogfood/Dogfood'
import { registerServiceWorker } from './pwa/pwa'
import ClientLink, { linkToken } from './clientLink/ClientLink'

// A client's own link (`/c/<token>`) is a page of its own: no sign-in, no shell, no service worker,
// no host. The token in the address is the whole of the visitor's authority.
const clientToken = linkToken()

// The desktop serves its own files; a service worker is for the web.
if (!isDesktop && !clientToken) registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  clientToken ? <StrictMode><ClientLink token={clientToken} /></StrictMode> :
  <StrictMode>
    {/* A server with accounts asks for a sign-in before the studio opens; a
        dogfood build (NAPKIN_DOGFOOD) then has the person acknowledge that it records. */}
      <SignInGate check={!isDesktop && !serverless && !isViewerRoute}>
        {!isDesktop && !serverless && !isViewerRoute ? <DogfoodGate><App /></DogfoodGate> : <App />}
      </SignInGate>
  </StrictMode>,
)
