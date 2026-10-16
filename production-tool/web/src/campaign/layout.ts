// Type as layers (features/campaign-formats.clan, phase 3): the brand line, the logo, supers and
// legal laid out per format. Phase 2 sends no layers.

import type { FormatSet, Size, TypeLayer } from '../contracts/types'
import type { DocumentStore } from '../doc/types'
import type { Relay } from '../relay'

export async function layersFor(_deps: { relay: Relay; doc: DocumentStore }, _set: FormatSet, _size: Size): Promise<TypeLayer[]> {
  return []
}
