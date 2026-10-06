/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The relay base URL (http://localhost:8787 locally, /api deployed). Unset → the in-browser mock. */
  readonly VITE_RELAY_URL?: string
}
