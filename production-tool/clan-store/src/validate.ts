// Validation against the locked contract, as it is written: the three schema
// files with their cross-file $refs. (The .clan carries a bundled copy, made
// by scripts/bundle-schema.mjs, which the SDK checks again on each write.)
// The validator is precompiled (scripts/precompile-validators.mjs, src/validators.gen.js): no eval at
// runtime, so the page's CSP needs no 'unsafe-eval' (owner, 2026-11-24).
import type { Doc } from './types'
import { validateDocument } from './validators.gen.js'

export class InvalidDocument extends Error {
  readonly problems: string[]
  constructor(problems: string[], what = 'the document') {
    super(`${what} does not match document.schema.json: ${problems.join('; ')}`)
    this.name = 'InvalidDocument'
    this.problems = problems
  }
}

/** The problems with `data`, as one line each; empty when it is valid. */
export function problems(data: unknown): string[] {
  const v = validateDocument
  if (v(data)) return []
  return (v.errors ?? []).map(e => {
    const extra = e.params && typeof e.params === 'object' && 'additionalProperty' in e.params
      ? ` (${String((e.params as { additionalProperty: unknown }).additionalProperty)})`
      : ''
    return `${e.instancePath || '/'} ${e.message ?? 'is invalid'}${extra}`
  })
}

export function assertValid(data: unknown, what?: string): asserts data is Doc {
  const p = problems(data)
  if (p.length) throw new InvalidDocument(p, what)
}
