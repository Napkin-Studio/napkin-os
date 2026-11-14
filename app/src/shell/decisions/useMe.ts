// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Who is signed in and which roles they hold, for putting a person's own items first (needs.ts mineFirst). Nothing is
// kept but the answer; a server with no accounts gives nobody, and then no item is anyone's.

import { useEffect, useState } from 'react'
import { signedInUser } from '../../host/http'

export interface Me { id: string | null; roles: readonly string[] }
const NOBODY: Me = { id: null, roles: [] }

export function useMe(): Me {
  const [me, setMe] = useState<Me>(NOBODY)
  useEffect(() => {
    let live = true
    void signedInUser().then(u => { if (live && u) setMe({ id: u.username, roles: u.roles ?? [] }) })
    return () => { live = false }
  }, [])
  return me
}
