// The plain SHA-256 used where a page has no crypto.subtle (plain HTTP, UAT 2026-11-18) gives the same
// digest as SubtleCrypto: the FIPS 180-4 vectors, block-boundary lengths and a large buffer.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hexOfBytes, sha256Digest, sha256Sync } from '../src/sha256'
import { sha256Hex } from '../src/bundle'

const enc = (s: string) => new TextEncoder().encode(s)

describe('sha256 without SubtleCrypto', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('matches the FIPS 180-4 vectors', () => {
    expect(hexOfBytes(sha256Sync(enc('')))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(hexOfBytes(sha256Sync(enc('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(hexOfBytes(sha256Sync(enc('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))))
      .toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1')
  })

  it('agrees with SubtleCrypto at every length around the block edges and on a large buffer', async () => {
    const lengths = [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 1 << 20]
    for (const n of lengths) {
      const bytes = new Uint8Array(n)
      for (let i = 0; i < n; i++) bytes[i] = (i * 31 + 7) & 0xff
      const subtle = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
      expect(hexOfBytes(sha256Sync(bytes)), `length ${n}`).toBe(hexOfBytes(subtle))
    }
  })

  it('is what sha256Digest and sha256Hex use when the page has no crypto.subtle', async () => {
    const bytes = enc('a picture, as bytes')
    const expected = hexOfBytes(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) })
    expect(globalThis.crypto.subtle).toBeUndefined()
    expect(hexOfBytes(await sha256Digest(bytes))).toBe(expected)
    expect(await sha256Hex(bytes)).toBe(expected)
  })
})
