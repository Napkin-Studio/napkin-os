// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Where the client-link routes (/s/<token>/client-links) exist: behind a server. The desktop app loads its frames from
// a url (host/tauri.ts, frameLoad 'url') but has no server, so Share > Send the client copy must not open the form there.
// Apart from words.ts so the words stay free of the host (and a test can read them without a window).

import { hasServer, host, onDevice } from '../../host'

export const clientLinkRoutes = (): boolean => hasServer && host.frameLoad === 'url' && !onDevice()
