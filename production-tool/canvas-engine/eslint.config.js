// The canvas engine's own lint (features/canvas-engine.clan, contracts: Build and
// lint boundary): the engine never imports React, the document store, the web
// app, or a tldraw editor package. Only @tldraw/store (MIT) and what it brings
// (@tldraw/state, @tldraw/utils) may be used, through src/model/.

import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'node_modules']),
  {
    files: ['**/*.{ts,js}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      '@typescript-eslint/no-restricted-imports': ['error', {
        paths: [
          { name: 'react', message: 'The engine is React-free; the web app renders node bodies into its DOM slots (features/canvas-engine.clan).' },
          { name: 'react-dom', message: 'The engine is React-free (features/canvas-engine.clan).' },
          { name: 'tldraw', message: 'Never the tldraw SDK: only @tldraw/store, @tldraw/state and @tldraw/utils (MIT) (features/canvas-engine.clan).' },
          { name: '@tldraw/editor', message: 'Never @tldraw/editor (features/canvas-engine.clan).' },
        ],
        patterns: [
          { group: ['react/*', 'react-dom/*', 'tldraw/*', '@tldraw/editor/*', '@tldraw/tldraw', '@tldraw/tldraw/*'], message: 'Not in the engine (features/canvas-engine.clan).' },
          { group: ['@excalidraw/*'], message: 'The engine imports nothing from Excalidraw; the converter reads its JSON (features/engine-import.clan).' },
          { group: ['**/clan-store', '**/clan-store/**', '**/web/src', '**/web/src/**', '@napkin/production-tool-clan-store'], message: 'The engine does not reach the document store or the web app; they call it (features/canvas-engine.clan).' },
        ],
      }],
    },
  },
])
