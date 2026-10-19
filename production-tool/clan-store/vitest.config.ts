import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 60_000,
    // One wasm module per worker is plenty.
    pool: 'forks',
  },
})
