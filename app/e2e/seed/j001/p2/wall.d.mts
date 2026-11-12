export const CANARY_SENTENCE: string
export const AGENCY_ONLY: { judge_score: string; agency_note: string; idea_card: string; banned_list: string }
export function plantCanary<T>(doc: T, sentence?: string): { doc: T; planted: number }
