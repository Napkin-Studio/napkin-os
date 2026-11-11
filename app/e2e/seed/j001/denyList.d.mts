export function parseList(text: string): string[]
export function scan(paths: string[], list: string[]): { file: string; string: string }[]
export function assertDeIdentified(opts?: { listPath?: string; paths?: string[] }): { checked: boolean; note: string }
