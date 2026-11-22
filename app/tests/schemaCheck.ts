// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The JSON Schema subset (draft-07) the template schemas use, as a small checker: the app has no JSON Schema
// validator among its declared dependencies and adds none. Shared by deckMakerFixtures.test.ts and stylePack.test.ts.

// ------------------------------------------------- JSON Schema subset (draft-07)

export type Schema = {
  type?: string | string[]
  enum?: unknown[]
  required?: string[]
  properties?: Record<string, Schema>
  additionalProperties?: Schema | boolean
  items?: Schema
  maxItems?: number
  oneOf?: Schema[]
  const?: unknown
  pattern?: string
  minimum?: number
  maximum?: number
  minItems?: number
  minLength?: number
  maxLength?: number
  propertyNames?: Schema
  default?: unknown
  uniqueItems?: boolean
  if?: Schema
  then?: Schema
}

function typeOk(v: unknown, t: string): boolean {
  if (t === 'null') return v === null
  if (t === 'array') return Array.isArray(v)
  if (t === 'object') return typeof v === 'object' && v !== null && !Array.isArray(v)
  if (t === 'integer') return Number.isInteger(v)
  return typeof v === t
}

function check(v: unknown, s: Schema, path: string, errs: string[]): void {
  if (s.type !== undefined) {
    const ts = Array.isArray(s.type) ? s.type : [s.type]
    if (!ts.some(t => typeOk(v, t))) { errs.push(`${path}: expected ${ts.join('|')}`); return }
  }
  if (s.enum && !s.enum.some(e => e === v)) errs.push(`${path}: ${JSON.stringify(v)} is not one of ${JSON.stringify(s.enum)}`)
  if ('const' in s && s.const !== v) errs.push(`${path}: ${JSON.stringify(v)} is not ${JSON.stringify(s.const)}`)
  if (s.if && s.then) {
    const e: string[] = []
    check(v, s.if, path, e)
    if (e.length === 0) check(v, s.then, path, errs)
  }
  if (typeof v === 'string') {
    if (s.pattern !== undefined && !new RegExp(s.pattern).test(v)) errs.push(`${path}: does not match ${s.pattern}`)
    if (s.minLength !== undefined && v.length < s.minLength) errs.push(`${path}: shorter than ${s.minLength}`)
    if (s.maxLength !== undefined && v.length > s.maxLength) errs.push(`${path}: longer than ${s.maxLength}`)
  }
  if (typeof v === 'number') {
    if (s.minimum !== undefined && v < s.minimum) errs.push(`${path}: under ${s.minimum}`)
    if (s.maximum !== undefined && v > s.maximum) errs.push(`${path}: over ${s.maximum}`)
  }
  if (s.oneOf) {
    const hits = s.oneOf.filter(o => { const e: string[] = []; check(v, o, path, e); return e.length === 0 })
    if (hits.length !== 1) errs.push(`${path}: matches ${hits.length} of ${s.oneOf.length} oneOf branches`)
  }
  if (Array.isArray(v)) {
    if (s.maxItems !== undefined && v.length > s.maxItems) errs.push(`${path}: more than ${s.maxItems} items`)
    if (s.minItems !== undefined && v.length < s.minItems) errs.push(`${path}: fewer than ${s.minItems} items`)
    if (s.uniqueItems && new Set(v.map(x => JSON.stringify(x))).size !== v.length) errs.push(`${path}: items are not unique`)
    if (s.items) v.forEach((x, i) => check(x, s.items!, `${path}[${i}]`, errs))
  } else if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>
    for (const k of s.required ?? []) if (!(k in o)) errs.push(`${path}: missing required "${k}"`)
    for (const [k, x] of Object.entries(o)) {
      if (s.propertyNames) check(k, s.propertyNames, `${path}.${k} (name)`, errs)
      const p = s.properties?.[k]
      if (p) check(x, p, `${path}.${k}`, errs)
      else if (typeof s.additionalProperties === 'object') check(x, s.additionalProperties, `${path}.${k}`, errs)
      else if (s.additionalProperties === false) errs.push(`${path}: unexpected "${k}"`)
    }
  }
}

export function validate(data: unknown, schema: Schema): string[] {
  const errs: string[] = []
  check(data, schema, '$', errs)
  return errs
}

