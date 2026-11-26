// The words a direction or a mandatory quotes: 'End card with the super: "Quietboil. Let them sleep."',
// 'End line must be "Quietboil. Let them sleep."' (UAT 2026-11-18: both were cut at the first quote, so a
// card read 'End card with the super: "Quietboil' and the sizes' line 'must be "Quietboil. Let them sleep.').

const DOUBLE = /["“„«]([^"“”„«»]+)(?:["”»]|$)/
// A single quote opens after a space or a colon, and closes before a space, punctuation or the end, so the
// apostrophe in "don't" or "Hearth's" is never taken for one.
const SINGLE = /(?:^|[\s:(–—-])['‘](.+?)['’](?=$|[\s.,;:!?)–—-])/

/** The words inside the first pair of quotes in `text` (straight or curly, double or single; an opening double
 *  quote with no closing one runs to the end), trimmed. Undefined when nothing is quoted. */
export function quoted(text: string): string | undefined {
  const t = text.trim()
  const hit = DOUBLE.exec(t) ?? SINGLE.exec(t)
  const words = hit?.[1].trim()
  return words || undefined
}
