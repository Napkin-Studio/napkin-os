// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What the app frame's page is composed for, as every host names it.
//
// The page itself is composed by napkin-host (crates/napkin-host/src/frame.rs,
// features/doc-open-direct.clan): served at `{clanOrigin}/document?…` by the
// web and the desktop, handed back as `srcdoc` by the device host. The shell
// says only what it alone knows, in one query string the three share.

import type { FrameOptions } from './types'

/** `model=…&capture=0|1&theme=…&v=…`, in that order. */
export function frameQuery(opts: FrameOptions): string {
  const q = new URLSearchParams({
    model: opts.model,
    capture: opts.capture ? '1' : '0',
    theme: opts.theme,
    v: opts.version,
  })
  return q.toString()
}
