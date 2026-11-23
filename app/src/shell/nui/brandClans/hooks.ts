// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { BrandApi } from '../../../host/brandClans'
import { BrandClansController, type BrandState } from './controller'

/** One controller per client page; the section and the work rows' chips share it. */
export function useBrandClans(api: BrandApi, clientId: string): BrandClansController {
  const c = useMemo(() => new BrandClansController(api, clientId), [api, clientId])
  useEffect(() => { void c.load() }, [c])
  return c
}

export function useBrandState(c: BrandClansController): BrandState {
  return useSyncExternalStore(c.subscribe, c.snapshot, c.snapshot)
}

