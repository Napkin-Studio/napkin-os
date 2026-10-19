// Content addresses: sha256 of the bytes, hashed in the browser (SubtleCrypto).

export async function sha256Hex(data: Blob | ArrayBuffer | Uint8Array): Promise<string> {
  let buf: ArrayBuffer
  if (data instanceof Blob) buf = await data.arrayBuffer()
  else if (data instanceof Uint8Array) buf = data.slice().buffer as ArrayBuffer
  else buf = data
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
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
