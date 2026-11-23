// A small label over a canvas picture (the Rights? chip, a size caption) at the canvas's zoom (features/pt-canvas-r2.clan).

/** Below this zoom a chip on the canvas is a dot (UAT round 2 R2-11: at 10-28% the chips covered the thumbnails). */
export const DOT_BELOW = 0.4

/** How a small label over a canvas picture is drawn at `zoom`: scaled down with the canvas, never up; a dot below DOT_BELOW. */
export function chipLook(zoom: number): { dot: boolean; scale: number } {
  return { dot: zoom < DOT_BELOW, scale: Math.max(DOT_BELOW, Math.min(1, zoom)) }
}
