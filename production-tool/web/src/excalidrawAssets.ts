// Where Excalidraw loads its fonts from: our own copy (excalidraw-fonts.ts puts it in the build),
// which replaces Liberation Sans and Cascadia Code with OFL-1.1 releases (features/licence-gate.clan).
// Without this Excalidraw fetches its own files from esm.sh. Imported first in main.tsx, before any
// canvas loads a font.
declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[]
  }
}

window.EXCALIDRAW_ASSET_PATH = new URL(`${import.meta.env.BASE_URL}excalidraw-assets/`, window.location.href).href

export {}
