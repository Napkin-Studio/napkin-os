import { JSDOM } from 'jsdom'
export const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'tauri://localhost/' })
const g = globalThis as Record<string, unknown>
;(dom.window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke: async () => null, transformCallback: () => 0 }
g.window = dom.window; g.document = dom.window.document; g.location = dom.window.location
