// The Download control on a picture, a frame, a clip and the ad (features/media-download.clan).
// The same name as in Download all media; when the bytes are neither in this browser nor on the
// relay, it says 'Not in this browser' and saves nothing.

import type { MediaItem } from '../media/names'
import { downloadLabel, useDownload } from './useDownload'

/** A Download button inside a card: the click stays with the button. */
export function DownloadButton({ items, className = 'btn sm', iconOnly = false, title }: { items: MediaItem[]; className?: string; iconOnly?: boolean; title?: string }) {
  const [state, run] = useDownload()
  if (!items.length) return null
  const tip = title ?? (items.length === 1 ? `Download ${items[0].name}` : `Download ${items.length} pictures`)
  return (
    <button type="button" className={`${className} dlbtn ${state === 'missing' ? 'missing' : ''}`} disabled={state === 'busy'}
      aria-label={iconOnly && state === 'idle' ? 'Download' : undefined} title={state === 'missing' ? 'Its file is not in this browser or on the relay' : tip}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); void run(items) }}>
      <span aria-hidden="true">↓</span>{(!iconOnly || state !== 'idle') && <span className="dl-label">{downloadLabel(state)}</span>}
    </button>
  )
}
