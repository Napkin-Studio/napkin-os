export function count(read: (file: string) => string | null, registry?: readonly { n: number; slug: string; file: string }[]): { problems: string[]; fixme: Map<number, string>; live: Map<number, string>; total: number }
export function declared(text: string): { fixme: number[]; live: number[] }
export function countDir(dir: string): { problems: string[]; fixme: Map<number, string>; live: Map<number, string>; total: number }
