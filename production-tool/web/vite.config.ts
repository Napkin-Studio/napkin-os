import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// The contracts live one level up (production-tool/contracts) and are bundled
// in, so the dev server has to be allowed to read them.
export default defineConfig({
  plugins: [react()],
  define: {
    // Excalidraw checks this at runtime; it is not set outside its own build.
    'process.env.IS_PREACT': JSON.stringify('false'),
  },
  build: { chunkSizeWarningLimit: 4000 },
  server: {
    fs: { allow: ['..'] },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
