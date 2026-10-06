// ajv over the locked contract schemas, for tests.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'

export const CONTRACTS = join(__dirname, '../../../contracts')

export function loadJson<T = unknown>(rel: string): T {
  return JSON.parse(readFileSync(join(CONTRACTS, rel), 'utf8')) as T
}

export function makeAjv() {
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  addFormats(ajv)
  for (const f of readdirSync(CONTRACTS).filter((x) => x.endsWith('.schema.json'))) ajv.addSchema(loadJson(f))
  return ajv
}

export const SCHEMA = (name: string) => `https://napkin.ie/production-tool/contracts/${name}.schema.json`
