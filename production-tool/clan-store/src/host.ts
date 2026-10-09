// napkin-wasm, loaded once per page. The glue is built by `npm run wasm`
// (wasm-bindgen --target web), as app/src/wasm is for the shell.
import init, { NapkinHost, type InitInput } from './wasm/napkin_wasm.js'
import { APP_ID, APP_TEMPLATE_BASE64 } from './app-template.gen'

export { NapkinHost }
export type WasmSource = InitInput | Promise<InitInput>

let ready: Promise<unknown> | null = null

/** Load the module. In a browser the default finds napkin_wasm_bg.wasm beside
 * the glue (Vite rewrites the URL); in node, pass the bytes. */
export function loadWasm(source?: WasmSource): Promise<unknown> {
  // A failed load (a dropped fetch) is not remembered: the next call tries again.
  ready ??= init(source === undefined ? undefined : { module_or_path: source }).catch((e: unknown) => {
    ready = null
    throw e
  })
  return ready
}

function base64Bytes(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
  // node without atob (very old): Buffer, reached without needing node's types in a browser build.
  const B = (globalThis as unknown as { Buffer: { from(s: string, enc: string): Uint8Array } }).Buffer
  return Uint8Array.from(B.from(b64, 'base64'))
}

let template: Uint8Array | null = null

/** The Production Tool template app (built by `npm run app`). */
export function appTemplate(): Uint8Array {
  template ??= base64Bytes(APP_TEMPLATE_BASE64)
  return template
}

/** A host with an empty store holding only the Production Tool app. */
export async function freshHost(source?: WasmSource): Promise<NapkinHost> {
  await loadWasm(source)
  const h = new NapkinHost()
  h.installApp(appTemplate())
  return h
}

export { APP_ID }

/** What `NapkinHost.handle` gives back. */
export interface RawResponse {
  status: number
  headers: [string, string][]
  body: Uint8Array | number[]
  events: { name: string; payload: unknown }[]
}

export function asBytes(value: Uint8Array | number[]): Uint8Array {
  return value instanceof Uint8Array ? value : Uint8Array.from(value)
}

/** A route as a function call: parsed JSON back, or a thrown refusal in the
 * host's own words. */
export function route<T = unknown>(h: NapkinHost, path: string, body: unknown = {}): T {
  const resp = h.handle(path, '', new TextEncoder().encode(JSON.stringify(body))) as RawResponse
  const text = new TextDecoder().decode(asBytes(resp.body))
  let parsed: unknown = null
  try { parsed = JSON.parse(text) } catch { /* not JSON: the body is the message */ }
  if (resp.status !== 200) {
    const err = (parsed as { error?: unknown } | null)?.error
    throw new HostRefused(resp.status, (typeof err === 'string' ? err : '') || text || `${path}: ${resp.status}`)
  }
  return parsed as T
}

export class HostRefused extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'HostRefused'
    this.status = status
  }
}
