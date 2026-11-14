// The preview bitmap cache (features/canvas-engine.clan, contracts: "Memory caps"):
// an LRU keyed by asset sha256 and level of detail, counted in decoded bytes
// (width x height x 4) and never over its cap. Evicted bitmaps are closed at
// once, so the browser frees them before the next frame.

export interface Bitmap {
  readonly width: number
  readonly height: number
  close?(): void
}

export type Level = 'full' | 'small'

const bytesOf = (b: Bitmap) => b.width * b.height * 4

export class BitmapCache<B extends Bitmap = Bitmap> {
  readonly cap: number
  private readonly map = new Map<string, B>()
  private used = 0
  /** The most bytes ever held (the bench reports it). */
  peak = 0

  constructor(capBytes: number) {
    this.cap = capBytes
  }

  private key(sha: string, level: Level) {
    return `${level}:${sha}`
  }

  get(sha: string, level: Level): B | undefined {
    const k = this.key(sha, level)
    const b = this.map.get(k)
    if (b) {
      // Most recently used last.
      this.map.delete(k)
      this.map.set(k, b)
    }
    return b
  }

  /** Keep a bitmap, evicting the least recently used until it fits. One larger than the cap is not kept. */
  put(sha: string, level: Level, b: B): boolean {
    const k = this.key(sha, level)
    const size = bytesOf(b)
    const old = this.map.get(k)
    if (old) this.drop(k, old)
    if (size > this.cap) {
      b.close?.()
      return false
    }
    while (this.used + size > this.cap && this.map.size) {
      const [ek, eb] = this.map.entries().next().value as [string, B]
      this.drop(ek, eb)
    }
    this.map.set(k, b)
    this.used += size
    this.peak = Math.max(this.peak, this.used)
    return true
  }

  private drop(k: string, b: B) {
    this.map.delete(k)
    this.used -= bytesOf(b)
    b.close?.()
  }

  bytes(): number {
    return this.used
  }

  size(): number {
    return this.map.size
  }

  clear() {
    for (const [k, b] of [...this.map]) this.drop(k, b)
  }
}
