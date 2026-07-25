/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CESIUM_ACCESS_TOKEN: string
  readonly VITE_APP_TITLE: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
