import type { Ratio } from '../contracts/types'

/** The ratio the person wrote in their words ("Key visual, 4:5 poster"): they asked for that shape. UAT 2026-11-23: a 4:5
 *  key visual came out 16:9 because only the storyboard's ratio reached the job. The first one named wins. */
export function ratioInWords(words: string): Ratio | undefined {
  const m = /(?<![\d:.])(16:9|9:16|4:5|1:1)(?![\d:])/.exec(words)
  return m ? (m[1] as Ratio) : undefined
}
