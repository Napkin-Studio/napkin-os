// Prefixed ULIDs, made by the client (common.schema.json#/$defs/id):
// `<prefix>_` + 10 chars of time + 16 chars of randomness, Crockford base32.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export type IdPrefix = 'job' | 'ref' | 'shot' | 'frame' | 'take' | 'rev' | 'combine' | 'pin' | 'sketch' | 'exp'

export const ID_PATTERN = /^[a-z]+_[0-9A-HJKMNP-TV-Z]{26}$/

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n)
  crypto.getRandomValues(out)
  return out
}

export function ulid(now = Date.now()): string {
  let time = ''
  let t = now
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time
    t = Math.floor(t / 32)
  }
  const rnd = randomBytes(16)
  let rand = ''
  for (let i = 0; i < 16; i++) rand += ALPHABET[rnd[i] % 32]
  return time + rand
}

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${ulid()}`
}
