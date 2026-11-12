export const QUERY: string
export const SCOPE_QUERY: string
export function queryOf(job: { job: string }): string
export function scopeQueryOf(job: { job: string }): string
export function scopeClan(job: { job: string }, client: { id: string; name: string }): Buffer
