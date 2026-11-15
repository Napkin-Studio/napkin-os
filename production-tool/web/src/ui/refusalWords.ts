// Refusals show no figure (features/production-platform-rules.clan, done_when 7; Phase 3 test 79's unit half).
// The line's limit_reached and spend_stop refusals reach the person as one plain line, the relay's message, and
// the screen shows that line and nothing else (JobNode, CampaignLayer). This module says what such a line may not
// hold, and finds the lines in the relay's source, so a test here and one in app/tests/shellRules.test.ts read the
// same rule. Pure: the callers read the files.

/** The codes whose messages are refusals about money: the agency's limit and the spend guard. */
export const REFUSAL_CODES = ['limit_reached', 'spend_stop'] as const

/** A figure: any digit. */
export const FIGURE = /\d/
/** A currency or money word, as Phase 3 test 79 reads it (app/e2e/j001-p3-production-platform-rules.spec.ts), plus "charge". */
export const MONEY_WORD = /euro|eur|dollar|usd|credit|price|cost|charge|€|\$/i

/** What is wrong with a refusal line: a figure, a money word, or nothing (null). */
export function figureIn(line: string): string | null {
  const d = line.match(FIGURE)
  if (d) return `the figure "${d[0]}"`
  const m = line.match(MONEY_WORD)
  return m ? `the money word "${m[0]}"` : null
}

/** The relay files whose strings make up a limit_reached or spend_stop message (paths under production-tool/). */
export const RELAY_REFUSAL_FILES = [
  'relay/service.py',
  'relay/director/spend.py',
  'relay/director/model.py',
  'relay/providers/runway.py',
] as const

export interface RefusalLine { where: string; text: string; code: 'limit_reached' | 'spend_stop' | 'guard' }

// A Python string literal on one line, with an optional f/r prefix (no triple quotes).
const LITERAL = /(?<![A-Za-z0-9_])([fFrR]?)("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/g
// A value an f-string may put in a refusal that could be a figure: a format spec or a money-ish name.
const RISKY_FIELD = /\{[^}]*(cap|amount|usd|eur|spent|price|cost|cents|credit|:[^}]*)\}/i

function literals(line: string): string[] {
  const out: string[] = []
  for (const m of line.matchAll(LITERAL)) {
    const body = m[2].slice(1, -1)
    if (!body) continue
    if (/^[fF]$/.test(m[1])) {
      // A field that names money or carries a format spec is a figure in waiting; other fields (another refusal's
      // reason, a purpose, a provider's name) are read where they are written.
      const risky = body.match(RISKY_FIELD)
      out.push(risky ? body.replace(risky[0], '0') : body.replace(/\{[^}]*\}/g, ''))
    } else out.push(body)
  }
  return out.filter((s) => !/^[a-z_]+$/.test(s)) // codes and keys ("spend_stop"), not words a person reads
}

/** Module constants: NAME = "..." on one line, or NAME = ( "..." "..." ) over several. */
function constants(text: string): Map<string, string> {
  const out = new Map<string, string>()
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Z][A-Z0-9_]+)\s*=\s*(.*)$/)
    if (!m) continue
    let rest = m[2]
    if (rest.trim() === '(') {
      const parts: string[] = []
      while (++i < lines.length && lines[i].trim() !== ')') parts.push(lines[i])
      rest = parts.join(' ')
    }
    const lits = literals(rest)
    if (lits.length) out.set(m[1], lits.join(''))
  }
  return out
}

/**
 * Every line of text the relay can send as a limit_reached or spend_stop message, from the files' text
 * (`files`: path under production-tool/ -> its source). Read: the literals on a line that names either code (and the
 * constant it raises with), and every reason the spend guard gives (Verdict(False, ...), which a spend_stop
 * message carries).
 */
export function relayRefusals(files: Record<string, string>): RefusalLine[] {
  const out: RefusalLine[] = []
  for (const [path, text] of Object.entries(files)) {
    const consts = constants(text)
    text.split('\n').forEach((line, i) => {
      const where = `${path}:${i + 1}`
      const t = line.trim()
      if (t.startsWith('#')) return
      const code = REFUSAL_CODES.find((c) => line.includes(`"${c}"`) || line.includes(`'${c}'`))
      const guard = /Verdict\(\s*False/.test(line) || /SpendRefused\(/.test(line)
      if (!code && !guard) return
      for (const s of literals(line)) out.push({ where, text: s, code: code ?? 'guard' })
      for (const name of line.match(/\b[A-Z][A-Z0-9_]{3,}\b/g) ?? []) {
        const v = consts.get(name)
        if (v) out.push({ where: `${where} (${name})`, text: v, code: code ?? 'guard' })
      }
    })
  }
  return out
}
