// Prefixed ULIDs, made by the client (common.schema.json#/$defs/id):
// `<prefix>_` + 10 chars of time + 16 chars of randomness, Crockford base32.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export type IdPrefix = string

export const ID_PATTERN = /^[a-z]+_[0-9A-HJKMNP-TV-Z]{26}$/

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n)
  crypto.getRandomValues(out)
  return out
}

// Ids made in one millisecond sort in the order they were made (monotonic ULIDs): "the first created"
// (selectors' first(), mainScript) sorts ids, so a random tail let a fresh empty node win (2026-10-16,
// cards.test.tsx failed about 1 run in 3). A clock that steps back keeps the last time.
let lastTime = -1
let lastRand: number[] = []

export function ulid(now = Date.now()): string {
  let rand: number[]
  if (now <= lastTime) {
    now = lastTime
    rand = [...lastRand]
    let i = rand.length - 1
    while (i >= 0 && rand[i] === 31) rand[i--] = 0
    if (i >= 0) rand[i]++
  } else {
    const rnd = randomBytes(16)
    rand = Array.from(rnd, (x) => x % 32)
    rand[0] &= 15 // headroom: increments within a millisecond never overflow the tail
  }
  lastTime = now
  lastRand = rand
  let time = ''
  let t = now
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time
    t = Math.floor(t / 32)
  }
  return time + rand.map((x) => ALPHABET[x]).join('')
}

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${ulid()}`
}
