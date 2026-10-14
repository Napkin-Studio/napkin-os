// Memory caps (features/canvas-engine.clan, contracts: "Memory caps"). iOS Safari
// limits the total memory of all canvases on a page and reloads the tab past it,
// so the engine holds these everywhere, and the bench checks them on every PR.

/** The device pixel ratio the engine draws at, at most. */
export const MAX_DPR = 2

/** Decoded preview bitmaps kept, at most (bytes, 4 per pixel). */
export const BITMAP_CACHE_BYTES = { ipad: 96 * 1024 * 1024, desktop: 256 * 1024 * 1024 } as const
export type DeviceClass = keyof typeof BITMAP_CACHE_BYTES

/** Below this zoom only the small level of detail is drawn; full-resolution bitmaps only above it. */
export const FULL_RES_MIN_ZOOM = 0.4

/** The small level of detail's width, in pixels (Spike O's 160 px). */
export const SMALL_PREVIEW_W = 160

/** An export larger than this is drawn in tiles on iPad, into a canvas released at once. */
export const EXPORT_TILE_PIXELS = 8 * 1000 * 1000

/** The device pixel ratio to draw at. */
export const drawDpr = (devicePixelRatio: number) => Math.min(MAX_DPR, Math.max(1, devicePixelRatio || 1))

/** The bytes behind the main and live-ink canvases: viewport size only, at the capped ratio. */
export function backingBytes(viewport: { width: number; height: number }, devicePixelRatio: number, canvases = 2): number {
  const d = drawDpr(devicePixelRatio)
  return Math.round(viewport.width * d) * Math.round(viewport.height * d) * 4 * canvases
}

/** An iPad (or any touch-first WebKit) gets the smaller cache. */
export function deviceClass(nav: { maxTouchPoints?: number; userAgent?: string } | undefined): DeviceClass {
  if (!nav) return 'desktop'
  const ua = nav.userAgent ?? ''
  return /iPad|iPhone/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1) ? 'ipad' : 'desktop'
}
