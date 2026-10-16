// Jude's per-format checks (features/campaign-formats.clan). They never block: a flag makes the
// tile "Needs a look" until it is fixed or ignored. Pure: a size, its set and the document in, the
// size's checks out (an Ignore already recorded on a check is kept while the result stands).

import type { FormatCheck, FormatCheckCode, FormatSet, ProductionDocument, Size } from '../contracts/types'
import { protectedInside } from './crop'
import { formatById } from './formats'
import { rowFracs } from './rules'

type Checks = Partial<Record<FormatCheckCode, FormatCheck>>

/** Every check of a size, from what it shows now. */
export function checksFor(size: Size, set: FormatSet, _d: ProductionDocument): Checks {
  const out: Checks = {}
  const f = formatById(size.format.format_id)
  if (size.media === 'image' && size.crop && set.protect?.boxes?.length) {
    const fr = f ? rowFracs({ format: f.format }) : undefined
    out.subject_safe = protectedInside(size.crop, set.protect.boxes, fr)
      ? { result: 'pass', note: 'What must stay is inside the safe area.' }
      : { result: 'flag', note: 'The crop cuts what must stay, or puts it outside the safe area. Adjust crop, or wait for Extend.' }
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
