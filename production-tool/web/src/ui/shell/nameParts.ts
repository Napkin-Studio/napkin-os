/** A name split where a narrow bar may cut it: the start, and the number or copy mark that tells it from its
 *  namesake, which always shows (re-test N-D: at 1116 px "PW Lumo Gen Z cut-down brief 2" lost its " 2"). */
export function nameParts(name: string): [string, string] {
  const m = /^(.+?)( \d+| \(copy(?: \d+)?\))$/.exec(name)
  return m ? [m[1], m[2]] : [name, '']
}
