/**
 * pcl.js 模块类型声明
 *
 * pcl.js 自带了 dist/pcl.d.ts 类型声明文件，
 * 但由于其 package.json 使用 exports 字段且 moduleResolution 为 "bundler"，
 * 动态 import('pcl.js') 时 TypeScript 可能无法正确解析类型。
 * 此声明文件确保动态导入能通过类型检查。
 */
declare module 'pcl.js' {
  export const VERSION: string
  export const PCL_VERSION: string

  export function init(opts?: {
    wasmBinary?: ArrayBuffer | Uint8Array | Int8Array
    mainScriptUrlOrBlob?: string
    noInitialRun?: boolean
    fetchSettings?: RequestInit
    locateFile?: (path: string, scriptDirectory: string) => string
    onRuntimeInitialized?: () => void
    url?: string
  }): Promise<void>

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const PCL: any
  export default PCL
}
