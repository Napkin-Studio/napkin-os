// A project born in the library (features/production-in-library.clan): the host makes the document from the app's
// template, with the client the person named; the tool opens its bytes, starts the project and saves the whole file.
// The manifest the host wrote (its id, its client, its title) must come out of every save as it went in: a save with
// another id is refused by the host, and one that drops the client would unassign it silently (S1-13).
import { unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { APP_ID, freshHost } from '../src/host'
import { MAYA, store, wasmBytes } from './fixtures'

const manifestOf = (bytes: Uint8Array) => parseYaml(new TextDecoder().decode(unzipSync(bytes)['manifest.yaml'])) as Record<string, any>

const CLIENT = { id: 'cli_0a1b2c3d', name: 'Hollow Oak Co' }

/** What POST /documents hands over: the app's blank instance, with the client the person named (the registry is the
 *  host's, so here the manifest says it, as the host's write does). */
async function hostBlank(title: string, client = false): Promise<Uint8Array> {
  const h = await freshHost(wasmBytes())
  h.newDocument(APP_ID, title, null)
  const b = h.download() as Uint8Array | number[]
  const bytes = b instanceof Uint8Array ? b : Uint8Array.from(b)
  if (!client) return bytes
  const z = unzipSync(bytes)
  z['manifest.yaml'] = new TextEncoder().encode(stringifyYaml({ ...parseYaml(new TextDecoder().decode(z['manifest.yaml'])), client: CLIENT }))
  return zipSync(z)
}

describe('a blank document from the library', () => {
  it('opens as a started project, keeping the manifest as the host wrote it', async () => {
    const bytes = await hostBlank('Hollow Oak', true)
    const before = manifestOf(bytes)
    const s = store()
    const doc = await s.open(bytes)
    expect(doc.contract_version).toBe('3')
    expect(doc.project.title).toBe('Hollow Oak')
    const after = manifestOf(await s.exportClan())
    expect(after.document_id).toBe(before.document_id) // `id` is the revision; `document_id` is the one the host checks
    expect(before.client).toEqual(CLIENT)
    expect(after.client).toEqual(CLIENT)
    expect(after.title).toBe('Hollow Oak')
  })

  it('a rename reaches the manifest, the title the library lists, and the client stays', async () => {
    const s = store({ person: MAYA })
    await s.open(await hostBlank('Untitled project', true))
    await s.setTitle('Maya waves')
    const m = manifestOf(await s.exportClan())
    expect(m.title).toBe('Maya waves')
    expect(m.client).toEqual(CLIENT)
  })
})
