// Content addresses: sha256 of the bytes, hashed in the browser (SubtleCrypto, or clan-store's own
// SHA-256 on a plain-HTTP page, where the browser has no crypto.subtle: UAT, 2026-11-18).
import { hexOfBytes, sha256Digest } from '../../../clan-store/src'

export async function sha256Hex(data: Blob | ArrayBuffer | Uint8Array): Promise<string> {
  let buf: ArrayBuffer
  if (data instanceof Blob) buf = await data.arrayBuffer()
  else if (data instanceof Uint8Array) buf = data.slice().buffer as ArrayBuffer
  else buf = data
  return hexOfBytes(await sha256Digest(new Uint8Array(buf)))
}

export async function sha256Of(data: Blob | ArrayBuffer | Uint8Array): Promise<string> {
  return `sha256:${await sha256Hex(data)}`
}

export function hexOf(sha: string): string {
  return sha.startsWith('sha256:') ? sha.slice(7) : sha
}

export function extFor(mime: string): string {
  const m = mime.split(';')[0]
  switch (m) {
    case 'image/png': return 'png'
    case 'image/jpeg': return 'jpg'
    case 'image/webp': return 'webp'
    case 'image/svg+xml': return 'svg'
    case 'video/mp4': return 'mp4'
    case 'video/webm': return 'webm'
    default: return 'bin'
  }
}
