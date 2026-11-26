// Types for src/validators.gen.js (scripts/precompile-validators.mjs).
export interface ValidatorError { instancePath: string; message?: string; params?: unknown }
export interface Validator { (data: unknown): boolean; errors?: ValidatorError[] | null }
export const validateDocument: Validator
export const validatePatchBatch: Validator
