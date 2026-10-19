// Bundle production-tool/contracts/document.schema.json into one
// self-contained schema: every `common.schema.json#/$defs/X` and
// `director.schema.json#/$defs/X` becomes a local `#/$defs/<file>.X`.
//
// The SDK validates each data write against the schema the .clan carries
// (agent/output-schema.json), and it resolves no external `$ref`, so the
// document has to carry its schema whole. The locked contract files are
// read, never changed; ajv in src/validate.ts validates against them as they are.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const contracts = join(here, '..', '..', 'contracts')
const read = name => JSON.parse(readFileSync(join(contracts, name), 'utf8'))

export function bundle() {
  const doc = read('document.schema.json')
  const files = { 'common.schema.json': read('common.schema.json'), 'director.schema.json': read('director.schema.json') }
  const defs = { ...doc.$defs }
  const pulled = new Set()

  const local = (file, def) => `${file.replace('.schema.json', '')}.${def}`

  function rewrite(node, from) {
    if (Array.isArray(node)) return node.map(n => rewrite(n, from))
    if (!node || typeof node !== 'object') return node
    const out = {}
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string') {
        const [file, frag] = v.split('#')
        const target = file || from
        if (target === 'document.schema.json') {
          out[k] = `#${frag}`
        } else {
          const def = frag.replace('/$defs/', '')
          const name = local(target, def)
          if (!pulled.has(name)) {
            pulled.add(name)
            const src = files[target]?.$defs?.[def]
            if (!src) throw new Error(`unresolved $ref ${v}`)
            defs[name] = null // reserve, so a cycle terminates
            defs[name] = rewrite(src, target)
          }
          out[k] = `#/$defs/${name}`
        }
      } else {
        out[k] = rewrite(v, from)
      }
    }
    return out
  }

  const { $defs: _drop, $id: _id, ...rest } = doc
  const body = rewrite(rest, 'document.schema.json')
  for (const [k, v] of Object.entries(doc.$defs)) defs[k] = rewrite(v, 'document.schema.json')
  return { ...body, $defs: Object.fromEntries(Object.entries(defs).sort(([a], [b]) => a.localeCompare(b))) }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2]
  const json = JSON.stringify(bundle(), null, 2) + '\n'
  if (out) writeFileSync(out, json)
  else process.stdout.write(json)
}
