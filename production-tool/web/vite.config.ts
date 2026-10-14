import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { excalidrawFonts } from './excalidraw-fonts'

// The contracts live one level up (production-tool/contracts) and are bundled
// in, so the dev server has to be allowed to read them.
// VITE_BASE: where the build is served. napkin-web serves it at /production/ (features/os-sign-in.clan,
// with VITE_RELAY_URL=/production/api); standalone dev and tests stay at /.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  // excalidrawFonts: Excalidraw's fonts served by us, Liberation Sans and Cascadia Code replaced
  // by OFL-1.1 releases (features/licence-gate.clan).
  plugins: [react(), excalidrawFonts()],
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
