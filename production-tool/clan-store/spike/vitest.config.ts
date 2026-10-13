import { defineConfig } from 'vitest/config'

// The contract-v3 spike: npx vitest run --config spike/vitest.config.ts
export default defineConfig({ test: { include: ['spike/**/*.spike.ts'], environment: 'node', testTimeout: 60_000 } })
