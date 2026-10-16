// Edit type on a tile (features/campaign-formats.clan, phase 3). Phase 2: a note that type layers come next.

import type { FormatSet, PersonRef, Size } from '../contracts/types'
import type { TileBox } from './board'
import type { CampaignDeps } from './make'

export function TypeOverlay(_: { size: Size; set: FormatSet; box: TileBox }) {
  return null
}

export function TypeEditor({ onClose, zoom }: { size: Size; set: FormatSet; deps: CampaignDeps; by: PersonRef; zoom: number; onClose(): void }) {
  return (
    <div className="cb-pop pt-panel" style={{ transform: `scale(${1 / zoom})` }} role="dialog" aria-label="Edit type" onPointerDown={(e) => e.stopPropagation()}>
      <p>The line, the logo and legal are laid out on every size in the next build.</p>
      <button type="button" className="btn xs" onClick={onClose}>OK</button>
    </div>
  )
}
