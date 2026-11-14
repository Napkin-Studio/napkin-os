// Jude's per-format checks (features/campaign-formats.clan). They never block: a flag makes the tile
// "Needs a look" until it is fixed or ignored. Pure: a size, its set and the document in, the size's
// checks out (an Ignore recorded on a check is kept while its result stands).
//
//   subject_safe    every protected box inside the safe area of the crop (a layout: of its panel; an
//                   extend keeps the whole master; a regenerate is not measured)
//   logo_safe       the logo inside the safe area (a logo on the Brand board that is not on the size too)
//   clear_space     no words inside the logo's clear space
//   type_size       every word at least the channel's minimum size
//   ooh_words       an out-of-home line of 7 words or fewer
//   line_present    the brand line is on the size (once the set has one)
//   end_card        a film ends on its end card
//   sound_off       social films carry supers or captions
//   brand_first_3s  social films show the brand in their first 3 s

import type { FormatCheck, FormatCheckCode, FormatSet, ProductionDocument, Region, Size } from '../contracts/types'
import { protectedInside } from './crop'
import { formatById } from './formats'
import { CLEAR, OOH_WORDS, MIN_CAP, layoutInput, layoutType } from './layout'
import { rowFracs } from './rules'
import { spokenOf } from './film'

type Checks = Partial<Record<FormatCheckCode, FormatCheck>>

const pass = (note: string): FormatCheck => ({ result: 'pass', note })
const flag = (note: string): FormatCheck => ({ result: 'flag', note })
const overlaps = (a: Region, b: Region) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length
const SOCIAL_SHAPES = [[9, 16], [4, 5], [1, 1]]

/** Every check of a size, from what it shows now. */
export function checksFor(size: Size, set: FormatSet, d: ProductionDocument): Checks {
  const out: Checks = {}
  const f = formatById(size.format.format_id)
  const fr = f ? rowFracs({ format: f.format }) : ([0, 0, 0, 0] as const)
  if (size.media === 'image' && set.protect?.boxes?.length) {
    // An extend keeps the whole master, placed with what must stay in the middle of the safe area (relay
    // formats.pad_plan); a regenerate is a new picture Jude cannot measure, so it makes no claim.
    if (size.method === 'extend') out.subject_safe = pass('Extended round the whole master: what must stay is kept, in the safe area.')
    else if (size.crop && (size.method === 'crop' || size.method === 'layout')) {
      out.subject_safe = protectedInside(size.crop, set.protect.boxes, size.method === 'layout' ? [0, 0, 0, 0] : fr)
        ? pass('What must stay is inside the safe area.')
        : flag('The crop cuts what must stay, or puts it outside the safe area. Adjust crop, or change the method to Extend.')
    }
  }
  const inp = layoutInput(d, set, size)
  const laid = layoutType(inp)
  const logo = laid.find((l) => l.kind === 'logo')
  const typed = laid.filter((l) => l.kind !== 'logo')
  const inside = (b: Region) => b.x >= fr[0] - 1e-6 && b.y >= fr[1] - 1e-6 && b.x + b.w <= 1 - fr[2] + 1e-6 && b.y + b.h <= 1 - fr[3] + 1e-6
  if (inp.brand.logo) {
    if (!logo) out.logo_safe = flag(size.layers?.logo?.hidden ? 'The logo is hidden on this size.' : 'The logo did not fit this size.')
    else {
      out.logo_safe = inside(logo.box) ? pass('The logo is inside the safe area.') : flag('The logo is outside the safe area.')
      const padX = (CLEAR * logo.box.h * size.delivery.height) / size.delivery.width
      const zone = { x: logo.box.x - padX, y: logo.box.y - CLEAR * logo.box.h, w: logo.box.w + 2 * padX, h: logo.box.h * (1 + 2 * CLEAR) }
      out.clear_space = typed.some((l) => overlaps(l.box, zone)) ? flag('Words sit in the logo\'s clear space.') : pass('The logo has its clear space.')
    }
  }
  if (typed.length) {
    const min = MIN_CAP[inp.channel]
    const small = typed.filter((l) => l.kind !== 'legal' && (l.capPx ?? 0) + 0.01 < Math.max(min.frac * inp.h, min.px))
    out.type_size = small.length ? flag(`The ${small[0].kind} is under the smallest size this format reads at.`) : pass('Type is at least this format\'s smallest size.')
  }
  const line = size.layers?.line?.text ?? set.copy?.line
  if (inp.channel === 'ooh' && line && !size.layers?.line?.hidden) {
    const n = words(line)
    out.ooh_words = n > OOH_WORDS
      ? flag(`The line is ${n} words; a poster is read in 3 to 5 seconds, so 7 or fewer. Write a shorter line for this size in Edit type.`)
      : pass(`The line is ${n} words.`)
  }
  if (set.copy?.line) {
    out.line_present = laid.some((l) => l.kind === 'line') ? pass('The brand line is on this size.') : flag('The brand line is not on this size.')
  }
  if (size.media === 'video') {
    const edl = size.edl ?? []
    // A cutdown made from a Video node (it has Dex's beats) always ends on the end card stitch draws at its size.
    if (edl.length) out.end_card = edl.at(-1)?.end_card || size.beats ? pass('The film ends on its end card.') : flag('This film does not end on its end card.')
    const r = size.delivery.width / size.delivery.height
    if (SOCIAL_SHAPES.some(([a, b]) => Math.abs(r - a / b) < 0.02)) {
      const supers = (set.copy?.supers?.length ?? 0) > 0 && !size.layers?.supers?.hidden
      // Captions of the spoken lines are on by default on the social shapes (CF9), off when hidden on the tile.
      const captions = !size.layers?.captions?.hidden && edl.some((w) => spokenOf(d, w.shot_id).length > 0)
      out.sound_off = supers || captions ? pass(captions ? 'Its spoken lines are captioned for sound off.' : 'It carries supers for sound off.')
        : flag('No supers or captions: most social video plays without sound.')
      if (edl.length) {
        // The brand is on screen from the start when the logo or the line is laid over the film.
        const branded = !!logo || laid.some((l) => l.kind === 'line') || !!edl[0]?.end_card
        out.brand_first_3s = branded ? pass('The brand shows in the first 3 seconds.') : flag('The brand does not show in the first 3 seconds.')
      }
    }
  }
  return keepIgnores(size.checks, out)
}

/** An Ignore stays on a check while its result stands. */
export function keepIgnores(before: Checks | undefined, after: Checks): Checks {
  for (const [code, c] of Object.entries(after) as [FormatCheckCode, FormatCheck][]) {
    const was = before?.[code]
    if (was?.ignored && was.result === c.result) c.ignored = was.ignored
  }
  return after
}

/** A flag no one has ignored. */
export function flagged(size: Pick<Size, 'checks'>): boolean {
  return Object.values(size.checks ?? {}).some((c) => c && c.result === 'flag' && !c.ignored)
}
