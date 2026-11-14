export type Row = { n: number; slug: string; line: string; fact: string }
export function parseTable(text: string): Row[]
export function checkTable(rows: Row[], opts?: { hasRecord?: (slug: string) => boolean; first?: number; last?: number }): string[]
