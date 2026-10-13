// Fractional order keys (common rank): the only order of scenes, shots, beats,
// boards, sizes and cut items, so a move is one write to one field. A port of
// rocicorp/fractional-indexing (CC0) in base 62; the twin of relay/rank.py.
// Both pass contracts/examples/ranks.json.

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const ZERO = DIGITS[0]
const SMALLEST_INTEGER = 'A' + ZERO.repeat(26)

export class RankError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RankError'
  }
}

function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new RankError(`${a} >= ${b}`)
  if (a.slice(-1) === ZERO || (b !== null && b.slice(-1) === ZERO)) throw new RankError('trailing zero')
  if (b !== null) {
    let n = 0
    while ((a[n] ?? ZERO) === b[n]) n++
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n))
  }
  const digitA = a ? DIGITS.indexOf(a[0]) : 0
  const digitB = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length
  if (digitB - digitA > 1) return DIGITS[Math.round(0.5 * (digitA + digitB))]
  if (b !== null && b.length > 1) return b.slice(0, 1)
  return DIGITS[digitA] + midpoint(a.slice(1), null)
}

function integerLength(head: string): number {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 97 + 2
  if (head >= 'A' && head <= 'Z') return 90 - head.charCodeAt(0) + 2
  throw new RankError(`invalid order key head: ${head}`)
}

function integerPart(key: string): string {
  const n = integerLength(key[0])
  if (n > key.length) throw new RankError(`invalid order key: ${key}`)
  return key.slice(0, n)
}

/** Throw RankError unless `key` is a valid order key. */
export function validateRank(key: string): void {
  if (!key || key === SMALLEST_INTEGER) throw new RankError(`invalid order key: ${JSON.stringify(key)}`)
  for (const c of key) if (!DIGITS.includes(c)) throw new RankError(`invalid order key: ${JSON.stringify(key)}`)
  const i = integerPart(key)
  if (key.slice(i.length).slice(-1) === ZERO) throw new RankError(`invalid order key: ${key}`)
}

export function isValidRank(key: string): boolean {
  try {
    validateRank(key)
    return true
  } catch {
    return false
  }
}

function increment(x: string): string | null {
  const head = x[0]
  const digs = x.slice(1).split('')
  let carry = true
  for (let i = digs.length - 1; carry && i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i]) + 1
    if (d === DIGITS.length) digs[i] = ZERO
    else {
      digs[i] = DIGITS[d]
      carry = false
    }
  }
  if (!carry) return head + digs.join('')
  if (head === 'Z') return 'a' + ZERO
  if (head === 'z') return null
  const h = String.fromCharCode(head.charCodeAt(0) + 1)
  if (h > 'a') digs.push(ZERO)
  else digs.pop()
  return h + digs.join('')
}

function decrement(x: string): string | null {
  const head = x[0]
  const digs = x.slice(1).split('')
  let borrow = true
  for (let i = digs.length - 1; borrow && i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i]) - 1
    if (d === -1) digs[i] = DIGITS.slice(-1)
    else {
      digs[i] = DIGITS[d]
      borrow = false
    }
  }
  if (!borrow) return head + digs.join('')
  if (head === 'a') return 'Z' + DIGITS.slice(-1)
  if (head === 'A') return null
  const h = String.fromCharCode(head.charCodeAt(0) - 1)
  if (h < 'Z') digs.push(DIGITS.slice(-1))
  else digs.pop()
  return h + digs.join('')
}

/** A key that sorts after `a` and before `b` (null: no bound on that side). */
export function rankBetween(a: string | null, b: string | null): string {
  if (a !== null) validateRank(a)
  if (b !== null) validateRank(b)
  if (a !== null && b !== null && a >= b) throw new RankError(`${a} >= ${b}`)
  if (a === null) {
    if (b === null) return 'a' + ZERO
    const ib = integerPart(b)
    const fb = b.slice(ib.length)
    if (ib === SMALLEST_INTEGER) return ib + midpoint('', fb)
    if (ib < b) return ib
    const res = decrement(ib)
    if (res === null) throw new RankError('cannot decrement any more')
    return res
  }
  if (b === null) {
    const ia = integerPart(a)
    const fa = a.slice(ia.length)
    const i = increment(ia)
    return i === null ? ia + midpoint(fa, null) : i
  }
  const ia = integerPart(a)
  const fa = a.slice(ia.length)
  const ib = integerPart(b)
  const fb = b.slice(ib.length)
  if (ia === ib) return ia + midpoint(fa, fb)
  const i = increment(ia)
  if (i === null) throw new RankError('cannot increment any more')
  if (i < b) return i
  return ia + midpoint(fa, null)
}

/** n keys in order between a and b, spread evenly. */
export function ranksBetween(a: string | null, b: string | null, n: number): string[] {
  if (n === 0) return []
  if (n === 1) return [rankBetween(a, b)]
  if (b === null) {
    let c = rankBetween(a, b)
    const out = [c]
    for (let i = 0; i < n - 1; i++) {
      c = rankBetween(c, b)
      out.push(c)
    }
    return out
  }
  if (a === null) {
    let c = rankBetween(a, b)
    const out = [c]
    for (let i = 0; i < n - 1; i++) {
      c = rankBetween(a, c)
      out.push(c)
    }
    return out.reverse()
  }
  const mid = Math.floor(n / 2)
  const c = rankBetween(a, b)
  return [...ranksBetween(a, c, mid), c, ...ranksBetween(c, b, n - mid - 1)]
}

/** Sort by rank (then id, so ties from a concurrent insert still have one order). */
export function byRank<T extends { rank: string; id: string }>(items: Iterable<T>): T[] {
  return [...items].sort((x, y) => (x.rank < y.rank ? -1 : x.rank > y.rank ? 1 : x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
}
