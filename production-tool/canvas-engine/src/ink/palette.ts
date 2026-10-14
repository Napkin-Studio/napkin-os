// Ink colours by name (features/theme-and-pencil.clan). A stroke stores one of
// these names, never a literal, so it is redrawn in the theme's own value: the
// default 'ink' is dark on a light canvas and light on a dark one, and the five
// others are tuned per theme to stay readable. The values live in the host's
// tokens (the web chrome's --pen-* in styles.css); the light ones here are the
// fallback for a bare host and for exports, which are always on white.
// Anything that is not a name (an imported Excalidraw colour) stays a literal.

export const INK_COLOURS = ['ink', 'orange', 'blue', 'green', 'amber', 'grey'] as const
export type InkColour = (typeof INK_COLOURS)[number]
export type InkPalette = Record<InkColour, string>

/** The light theme's values (styles.css --pen-*, light). */
export const LIGHT_INK: InkPalette = {
  ink: '#14161B',
  orange: '#E2502F',
  blue: '#2F64F5',
  green: '#15803D',
  amber: '#C27803',
  grey: '#6B7180',
}

export function isInkColour(c: unknown): c is InkColour {
  return typeof c === 'string' && (INK_COLOURS as readonly string[]).includes(c)
}

/** The colour to paint: a name through the palette, a literal as is, nothing as ink. */
export function resolveInk(c: string | undefined | null, palette: InkPalette = LIGHT_INK): string {
  if (!c) return palette.ink
  return isInkColour(c) ? palette[c] : c
}
