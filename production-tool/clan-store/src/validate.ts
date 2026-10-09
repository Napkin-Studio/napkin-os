// Validation against the locked contract, as it is written: the three schema
// files with their cross-file $refs. (The .clan carries a bundled copy, made
// by scripts/bundle-schema.mjs, which the SDK checks again on each write.)
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import common from '../../contracts/common.schema.json'
import director from '../../contracts/director.schema.json'
import document from '../../contracts/document.schema.json'
import type { Doc } from './types'

export class InvalidDocument extends Error {
  readonly problems: string[]
  constructor(problems: string[], what = 'the document') {
    super(`${what} does not match document.schema.json: ${problems.join('; ')}`)
    this.name = 'InvalidDocument'
    this.problems = problems
  }
}

let check: ((d: unknown) => boolean) & { errors?: { instancePath: string; message?: string; params?: unknown }[] | null } | null = null

function compiled() {
  if (check) return check
  // ajv-formats is CommonJS; under some bundlers its default arrives wrapped.
  const Ajv = ((Ajv2020 as unknown as { default?: typeof Ajv2020 }).default ?? Ajv2020)
  const formats = ((addFormats as unknown as { default?: typeof addFormats }).default ?? addFormats)
  const ajv = new Ajv({ allErrors: true, strict: false })
  formats(ajv)
  ajv.addSchema(common)
  ajv.addSchema(director)
  check = ajv.compile(document)
  return check
}

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
