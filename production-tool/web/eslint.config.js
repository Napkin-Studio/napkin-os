import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

const ENGINE = {
  group: ['@excalidraw/*', '@excalidraw/excalidraw'],
  message: 'Engine code lives in src/canvas/adapter (features/canvas-core.clan)',
  allowTypeImports: false,
}

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  // The canvas engine lives behind src/canvas/adapter (features/canvas-core.clan).
  // allowTypeImports is false, so `import type` and `export … from` are caught too;
  // src/canvas/boundary.test.ts catches the strings lint cannot see.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/canvas/adapter/**'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [ENGINE],
      }],
    },
  },
  // The core is engine-free: no engine, no sync library, and no adapter.
  {
    files: ['src/canvas/core/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [
          ENGINE,
          { group: ['@tldraw/*', 'yjs', 'y-*'], message: 'src/canvas/core stays free of engines and sync libraries (features/canvas-core.clan).', allowTypeImports: false },
          { group: ['**/adapter', '**/adapter/**'], message: 'src/canvas/core must not import an adapter; adapters implement core/canvasAdapter.ts (features/canvas-core.clan).', allowTypeImports: false },
        ],
      }],
    },
  },
])
