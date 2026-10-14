import { defineConfig } from 'vitest/config'

// The bench runs one file at a time, so nothing else competes for the CPU it times.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['bench/**/*.bench.ts'],
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
})
