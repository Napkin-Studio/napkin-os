export const ANSWERS_DIR: string
export function answeredTasks(dir?: string): string[]
export function answerFor(task: string, variant?: string | null, dir?: string): Record<string, unknown> | null
