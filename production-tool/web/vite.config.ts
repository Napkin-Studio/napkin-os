import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { excalidrawFonts } from './excalidraw-fonts'

// The contracts live one level up (production-tool/contracts) and are bundled
// in, so the dev server has to be allowed to read them.
// VITE_BASE: where the build is served. napkin-web serves it at /production/ (features/os-sign-in.clan,
// with VITE_RELAY_URL=/production/api); standalone dev and tests stay at /.
// One copy of the live-text stack: clan-store's source (imported from ../clan-store/src) and the
// editors must share yjs, ProseMirror and y-tiptap, or Yjs warns "already imported", schemas fail
// instanceof and plugin keys differ (features/script-editor.clan). src/script/dedupe.test.ts checks it.
const DEDUPE = [
  'yjs', 'lib0', 'y-protocols', '@tiptap/core', '@tiptap/pm', '@tiptap/y-tiptap',
  'prosemirror-model', 'prosemirror-state', 'prosemirror-view', 'prosemirror-transform', 'prosemirror-keymap',
  'prosemirror-commands', 'prosemirror-changeset',
]

export default defineConfig({
  base: process.env.VITE_BASE || '/',
  // excalidrawFonts: Excalidraw's fonts served by us, Liberation Sans and Cascadia Code replaced
  // by OFL-1.1 releases (features/licence-gate.clan).
  plugins: [react(), excalidrawFonts()],
  resolve: { dedupe: DEDUPE },
  define: {
    // Excalidraw checks this at runtime; it is not set outside its own build.
    'process.env.IS_PREACT': JSON.stringify('false'),
  },
  build: { chunkSizeWarningLimit: 4000 },
  // The store Worker (src/store/worker.ts, features/engine-store.clan) is a module Worker: it imports napkin-wasm and zstd by URL.
  worker: { format: 'es' },
  server: {
    fs: { allow: ['..'] },
  },
  // Dev server only: crawl the canvas engines and the store Worker from the start. They load by dynamic
  // import (src/canvas/adapter/index.ts), so without this Vite found their packages (yjs, @tldraw/store,
  // rbush…) only when a canvas first opened, re-bundled, and reloaded the page under the person or a
  // test (the canvas-picture e2e failed on "Execution context was destroyed" once the own engine became
  // the default). Builds are unaffected.
  optimizeDeps: {
    entries: ['index.html', 'src/canvas/adapter/own/engine.ts', 'src/canvas/adapter/excalidraw/engine.ts', 'src/store/worker.ts'],
  },
  test: {
    environment: 'node',
    // DOM tests say '// @vitest-environment happy-dom' at their top; the default stays node.
    include: ['src/**/*.test.{ts,tsx}'],
    // Quarantined (owner, 2026-10-16; testing policy: flaky -> quarantine, fix within 7 days): the
    // script perf budget fails whenever the machine is busy. It runs in `npm run test:perf`, which
    // scripts/check.sh runs after the suites and reports without failing the check.
    exclude: process.env.NAPKIN_PERF === '1' ? [] : ['src/script/perf.test.ts'],
  },
})
