// Reads docs/design/phase3-acceptance.md (features/j001-phase3-suite.clan, done_when 1): the table rows `| n | record | gate line | wording |`,
// and the rule they must keep. Used by app/tests/phase3Suite.test.ts and by the records that read the list.

import { LINES } from './tests.mjs'

/** The rows of the list: { n, slug, line, fact }. The manual gate checks table has no number in its first column, so it is not read. */
export function parseTable(text) {
  return [...text.matchAll(/^\| (\d+) \| ([^|]*?) \| ([^|]*?) \| (.*) \|$/gm)].map(m => ({ n: Number(m[1]), slug: m[2].trim(), line: m[3].trim(), fact: m[4] }))
}

/** Problems with the rows: a number outside 74 to 111, a number used twice or missing, an owner that is empty or names no record, a gate line that is not one of the eight. */
export function checkTable(rows, { hasRecord = () => true, first = 74, last = 111 } = {}) {
  const problems = []
  const seen = new Map()
  for (const r of rows) {
    seen.set(r.n, (seen.get(r.n) ?? 0) + 1)
    if (r.n < first || r.n > last) problems.push(`test ${r.n} is outside ${first} to ${last}`)
    if (!r.slug) problems.push(`test ${r.n} has no owning record`)
    else if (!hasRecord(r.slug)) problems.push(`test ${r.n} names ${r.slug}, which is not a feature record`)
    if (!LINES.includes(r.line)) problems.push(`test ${r.n} has the gate line "${r.line}", which is not one of ${LINES.join(', ')}`)
    if (!r.fact.trim()) problems.push(`test ${r.n} has no wording`)
  }
  for (const [n, times] of seen) if (times > 1) problems.push(`test ${n} is used ${times} times`)
  for (let n = first; n <= last; n++) if (!seen.has(n)) problems.push(`test ${n} is missing`)
  return problems
}
