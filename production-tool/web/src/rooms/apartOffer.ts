// Whether the Make room's Change tab offers to make a shot apart (UAT round 4, R4-F9).

/** Whether the Change tab offers to make a shot apart: not for an ask of the Camera agent about the take as a whole
 *  (UAT round 4, R4-F9: "the empty room for shot 4, Maya in shot 5" offered "Make shot 4 apart?"); only when the ask names
 *  this shot and no other of the take. A change of the shot's own words or feel offers it as before. */
export function offersApart(ask: string | undefined, n: number, others: number[]): boolean {
  if (!ask?.trim()) return true
  const named = new Set([...ask.matchAll(/\bshots?\s+(\d+)(?:\s*(?:and|&|,|-|–|to)\s*(\d+))?/gi)].flatMap((m) => [m[1], m[2]]).filter(Boolean).map(Number))
  return named.has(n) && !others.some((o) => named.has(o))
}
