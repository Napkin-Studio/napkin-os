// The Booth's rules (features/booth.clan, features/script-freeform.clan), apart from the component so they
// can be tested: the width for what is open, whether it may hide at this window width, the key its
// remembered state is kept under, and what it starts as in a room.
//
// The Production Tool is a React app outside the shell runtime, so the hidden/shown state is the
// person's own in this tool's app UI (doc/ui.ts AppUi.booth), keyed by who is signed in; not clan:booth.

/** Where the Booth is: the Script editor, the Storyboard editor, a Video room, or the canvas (a selected
 *  Brief node, the Assets library opened on purpose; features/production-new-ui.clan). */
export type BoothPlace = 'script' | 'storyboard' | 'room' | 'canvas'

/** At or below this width the Booth stays a column: no Hide, no edge tab (booth.clan). */
export const BOOTH_NARROW = 1100
/** Below this width a room's Booth starts hidden as its edge tab: the room keeps its inspector (owner, 2026-11-16). */
export const ROOM_START_HIDDEN = 1280
/** The open Booth's width at or below BOOTH_NARROW, wherever it is. */
export const NARROW_WIDTH = 320
/** In the Storyboard and the rooms the hidden tab keeps this gutter, so it never covers a shot card. */
export const EDGE_GUTTER = 44

/** The open Booth's width (owner, 2026-11-16): 420 the whole script, 440 a part or a selection, 420 in the
 *  Storyboard, 380 in the rooms; 320 in a narrow window. */
export function boothWidth(place: BoothPlace, scoped: boolean, windowWidth: number): number {
  if (windowWidth <= BOOTH_NARROW) return NARROW_WIDTH
  if (place === 'room') return 380
  if (place === 'storyboard' || place === 'canvas') return 420
  return scoped ? 440 : 420
}

/** Whether the Booth may hide here. Below 1100 px the Script and Storyboard Booth stays a column; a room's
 *  may, since it starts hidden below 1280 px and its gutter keeps the tab off the work. */
export function boothCanHide(place: BoothPlace, windowWidth: number): boolean {
  return place === 'room' || windowWidth > BOOTH_NARROW
}

/** The gutter the hidden Booth leaves (px). */
export function boothGutter(place: BoothPlace): number {
  return place === 'script' || place === 'canvas' ? 0 : EDGE_GUTTER
}

/** Whose remembered state: the signed-in person, else this browser's local person. */
export function boothKey(participantId: string | undefined): string {
  return participantId ? `human:${participantId}` : 'local'
}

export type BoothMemory = Record<string, 'hidden' | 'shown'>

/** Shown, unless this person hid it last. */
export function rememberedOpen(memory: BoothMemory | undefined, key: string): boolean {
  return memory?.[key] !== 'hidden'
}

/** What the Booth starts as: a room below 1280 px starts hidden; elsewhere what the person left it as. */
export function startsOpen(place: BoothPlace, windowWidth: number, remembered: boolean): boolean {
  if (place === 'room' && windowWidth < ROOM_START_HIDDEN) return false
  return remembered
}

/** Whether it shows open: what it is set to, unless it may not hide here. */
export function shownOpen(place: BoothPlace, windowWidth: number, open: boolean): boolean {
  return open || !boothCanHide(place, windowWidth)
}

/** The count dot's words for the edge tab. */
export function edgeLabel(count: number): string {
  return `Open the Booth${count ? `, ${count} ${count === 1 ? 'thing' : 'things'} waiting for you` : ''}`
}

/** The Booth rule (Shrey, 2026-11-17; features/production-new-ui.clan, booth-rule.html): the Booth earns its
 *  place. It shows for a selection whose work needs room, a library opened on purpose, or the agent asked on
 *  purpose; and, until each surface carries its asks on the work itself, for something waiting for the person
 *  (so nothing is hidden). Otherwise there is no Booth and no edge tab: the surface takes the full width. */
export function boothEarned(o: { selection?: boolean; library?: boolean; asked?: boolean; waiting?: number }): boolean {
  return !!(o.selection || o.library || o.asked || (o.waiting ?? 0) > 0)
}
