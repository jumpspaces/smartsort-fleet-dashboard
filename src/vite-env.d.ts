/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional default fleet API base URL, baked at build time. */
  readonly VITE_FLEET_API?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
