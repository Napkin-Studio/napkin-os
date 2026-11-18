import { wasmHost } from './lib.mjs'
const h = await wasmHost(); h.newDocument('production-tool', 'Bench')
console.log(h.entry('manifest.yaml').match(/path: .*/g).join('\n'))
