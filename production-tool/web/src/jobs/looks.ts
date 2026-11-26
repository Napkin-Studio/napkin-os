// A person's look from the script, on every frame they are in (UAT round 5, S2-A; features/pt-canvas-r5.clan).
//
// Since round 4 a frame reads only its own shot (R3-12/S2-1: the whole note reached every frame and frame 3 came back a
// 2x2 collage), and Dex's shot list leaves a person's look out of the actions on purpose ("Leo's look is in the
// script"). So frame 1 of "Leo, a man in his forties with a short grey beard and a red knitted beanie, cycles to work.
// 1: Leo unlocks his bike…" was an older man in an olive beanie, and Keep a person carried that look on.
//
// The look is read from the words the storyboard was planned from (its own script, and the texts linked into it or
// into that script): the person's introduction only (an apposition, a Fountain parenthetical, "X is a …", "X wears …"),
// never a beat. It goes in the frame's shot direction as one "Look:" line per person seen, as the Cast line does
// (jobs/cast.ts), so no prompt changes and no whole note comes back.

import type { Id, JobShot, ProductionDocument, Shot } from '../contracts/types'
import { linkedWords, scopeOf } from '../model/scope'
import { scriptOfStoryboard, scriptText } from '../model/selectors'
import { namesPerson, unnamedPerson } from './cast'

type Doc = ProductionDocument

/** At most this long, a look (the line is one sentence of the person's introduction). */
export const LOOK_MAX = 200
/** At most this many people's looks on one frame. */
export const LOOKS_MAX = 2

/** Words that make a description a person's look, not a place's ("Paris, a city of light"). */
const LOOK_WORDS = /\b(?:m[ae]n|wom[ae]n|girl|boy|guy|lady|kid|child|teen(?:ager)?|person|beard(?:ed)?|moustache|mustache|stubble|hair(?:ed)?|bald|curls?|curly|braids?|ponytail|eyes|freckles|skin|wears?|wearing|dressed|coat|jacket|shirt|jumper|sweater|hoodie|dress|skirt|trousers|jeans|uniform|hat|beanie|cap|scarf|glasses|tall|short|slim|stocky|young|old|older|elderly|aged|twenties|thirties|forties|fifties|sixties|seventies|\d0s|years?)\b/i
/** Capitalised words that are never a person's name. */
const NOT_NAMES = new Set(['A', 'An', 'The', 'In', 'On', 'At', 'And', 'But', 'Then', 'When', 'Later', 'Close', 'Wide', 'Shot', 'Int', 'Ext', 'We', 'She', 'He', 'They', 'It', 'His', 'Her', 'Their', 'Four', 'Three', 'Two', 'One', 'No'])
const NAME = String.raw`([A-Z][a-z]{1,23}|[A-Z]{2,24})`

/** The sentences of a text, each beat ("1: …", "2. …") its own, scene headings left out. */
function sentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+|\s(?=\d{1,2}[:.)]\s)/)
    .map((s) => s.replace(/^\d{1,2}[:.)]\s*/, '').trim())
    .filter((s) => s && !/^(?:INT|EXT|INT\.?\/EXT)[.\s]/i.test(s))
}

const clean = (look: string) => look.replace(/\s+/g, ' ').replace(/[\s,;:]+$/, '').trim()

/** The looks a text gives, by lower-case name: each person's introduction, the first one that reads as a look. */
export function looksIn(text: string): Map<string, string> {
  const out = new Map<string, string>()
  const put = (name: string, look: string) => {
    const key = name.toLowerCase()
    const said = clean(look)
    if (NOT_NAMES.has(name[0] + name.slice(1).toLowerCase()) || out.has(key) || !LOOK_WORDS.test(said) || said.length < 6) return
    out.set(key, said.length > LOOK_MAX ? `${said.slice(0, LOOK_MAX - 1).replace(/\s+\S*$/, '')}…` : said)
  }
  for (const s of sentences(text)) {
    // "Leo, a man in his forties with a short grey beard, cycles…" / "Leo, 45, in a red beanie, …"
    for (const m of s.matchAll(new RegExp(String.raw`\b${NAME}\s*,\s*((?:a|an|aged|in (?:his|her|their)|now|still|\d{1,2}\b)[^,.;]{2,${LOOK_MAX}}?(?:,\s*(?:in|with|wearing|dressed)\b[^,.;]{2,80}?)?)\s*(?:,|\.|;|$)`, 'g'))) put(m[1], m[2])
    // Fountain: "LEO (40s, short grey beard, red beanie) unlocks…"
    for (const m of s.matchAll(new RegExp(String.raw`\b${NAME}\s*\(([^)]{3,${LOOK_MAX}})\)`, 'g'))) put(m[1], m[2])
    // "Leo is a man in his forties…" / "Leo wears a red beanie…"
    for (const m of s.matchAll(new RegExp(String.raw`\b${NAME}\s+(?:is|was)\s+((?:a|an)\s[^.;]{3,${LOOK_MAX}})`, 'g'))) put(m[1], m[2])
    for (const m of s.matchAll(new RegExp(String.raw`\b${NAME}\s+((?:wears|is wearing|has|with)\s[^.;]{3,${LOOK_MAX}})`, 'g'))) put(m[1], m[2])
  }
  return out
}

/** The words a storyboard was planned from: its own script (planning moves a scene's words into the shots, so this
 *  holds what is left), the texts linked into the storyboard or that script (the live repro's note), and the words its
 *  plans were sent with (a shot_list job keeps its text in the document). */
export function plannedWords(d: Doc, storyboardId: Id | undefined): string {
  if (!storyboardId) return ''
  const script = scriptOfStoryboard(d, storyboardId)
  const parts = [script ? scriptText(d, script.id) : '']
  for (const n of [storyboardId, ...(script ? [script.id] : [])]) for (const t of linkedWords(scopeOf(d, n))) parts.push(t.words)
  for (const j of Object.values(d.jobs ?? {})) if (j.op === 'shot_list' && j.node?.kind === 'storyboard' && j.node.id === storyboardId && j.text) parts.push(j.text)
  return [...new Set(parts.filter(Boolean))].join('\n')
}

/** Whether a name is said in the shot's words. */
const says = (shot: Shot, name: string) => new RegExp(`(^|[^a-z0-9_])@?${name}(?![a-z0-9])`, 'i').test(`${shot.action ?? ''} ${shot.direction ?? ''}`)

/** The looks of the people this shot shows: each one it names; with none named but a person implied ("He rides…")
 *  and only one person described, that one. A shot that brings in someone else ("a flatmate") gets none. */
export function looksFor(d: Doc, storyboardId: Id | undefined, shot: Shot): { name: string; look: string }[] {
  const looks = looksIn(plannedWords(d, storyboardId))
  if (!looks.size) return []
  const named = [...looks].filter(([name]) => says(shot, name))
  const seen = named.length ? named : looks.size === 1 && namesPerson(d, shot) && !unnamedPerson(d, shot) ? [...looks] : []
  return seen.slice(0, LOOKS_MAX).map(([name, look]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), look }))
}

/** The line a frame's direction carries for one person: plain name (no @: no picture is looked for), then the look as
 *  the script says it ("Look: Leo, a man in his forties with a short grey beard and a red knitted beanie."). */
export const lookLine = (name: string, look: string) => `Look: ${name}, ${look}${/[.!?…]$/.test(look) ? '' : '.'}`

/** The shot as a frame sends it, with a Look line for each person it shows whose look the script gives. */
export function lookShot(d: Doc, storyboardId: Id | undefined, shot: Shot, js: JobShot): JobShot {
  const lines = looksFor(d, storyboardId, shot).map((l) => lookLine(l.name, l.look))
  if (!lines.length) return js
  return { ...js, direction: [js.direction, ...lines].filter(Boolean).join('\n').slice(0, 4000) }
}
