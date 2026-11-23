// Validation against the locked contract, as it is written: the three schema
// files with their cross-file $refs, precompiled (validators.gen.js). (The .clan carries a bundled copy, made
// by scripts/bundle-schema.mjs, which the SDK checks again on each write.)
import { document } from './validators.gen.js'
import type { Doc } from './types'

export class InvalidDocument extends Error {
  readonly problems: string[]
  constructor(problems: string[], what = 'the document') {
    super(`${what} does not match document.schema.json: ${problems.join('; ')}`)
    this.name = 'InvalidDocument'
    this.problems = problems
  }
}

type Check = ((d: unknown) => boolean) & { errors?: { instancePath: string; message?: string; params?: unknown }[] | null }

// Precompiled by scripts/make-validators.mjs (ajv standalone): no runtime code
// generation, so a CSP without 'unsafe-eval' is fine.
const compiled = (): Check => document

/** The problems with `data`, as one line each; empty when it is valid. */
export function problems(data: unknown): string[] {
  const v = compiled()
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
