import { wasmHost, route, json, appSchema } from './lib.mjs'
const h = await wasmHost()
console.log(h.newDocument('production-tool', 'Bench'))
const s = appSchema(); console.log('root addlProps', s.additionalProperties, 'required', s.required, Object.keys(s.properties))
try { console.log(json(route(h, '/patch-data', { patch: { canvas: { a: 1 } }, agent: 'human:bench', action: 'x' }))) } catch (e) { console.log('ERR', e.message) }
try { console.log(json(route(h, '/upload-asset', new Uint8Array([1,2,3]), 'name=canvas.ybin&agent=human%3Abench'))) } catch (e) { console.log('ERR', e.message) }
console.log(h.entry('manifest.yaml').slice(0,1500))
