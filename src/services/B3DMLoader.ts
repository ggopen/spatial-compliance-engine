/**
 * B3DMLoader — 直接 fetch + 解析 B3DM（Batched 3D Model）文件
 *
 * 核心原理：B3DM 本质就是 28字节头 + Feature/Batch Table + 一段标准 GLB。
 * 绕过 Cesium 内部渲染器，直接从 HTTP 获取原始几何数据。
 *
 * 这是解决"Cesium内部API静默失败"问题的关键模块：
 * - Cesium 1.121 的 loadAttributesAsTypedArray 默认 false，顶点在 GPU Buffer
 * - posAttr.typedArray 为 undefined，导致几何提取静默失败
 * - 直接解析 B3DM 文件则完全不依赖 Cesium 内部 API
 *
 * B3DM 文件结构（little-endian）:
 *   [0..3]   magic = "b3dm"
 *   [4..7]   version = 1
 *   [8..11]  byteLength（整个文件总字节数）
 *   [12..15] featureTableJSONByteLength
 *   [16..19] featureTableBinaryByteLength
 *   [20..23] batchTableJSONByteLength
 *   [24..27] batchTableBinaryByteLength
 *   [28..]   Feature Table JSON → Binary → Batch Table JSON → Binary → GLB
 *
 * 参考：https://github.com/CesiumGS/3d-tiles/blob/main/specification/TileFormats/Batched3DModel/README.adoc
 */

/** B3DM 解析结果 */
export interface B3DMResult {
  /** 版本号 */
  version: number
  /** Feature Table JSON（含 BATCH_LENGTH, RTC_CENTER 等） */
  featureTable: Record<string, unknown>
  /** Batch Table JSON（语义属性） */
  batchTable: Record<string, unknown> | null
  /** GLB 二进制数据（标准 Binary glTF） */
  glb: ArrayBuffer
  /** RTC_CENTER（相对中心坐标），若存在 */
  rtcCenter: number[] | null
  /** Batch 数量 */
  batchLength: number
}

export class B3DMLoader {
  /**
   * 从 URL 获取并解析 B3DM 文件
   */
  static async fetchAndParse(url: string): Promise<B3DMResult> {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`B3DM fetch failed: HTTP ${response.status} for ${url}`)
    }
    const buffer = await response.arrayBuffer()
    return this.parse(buffer)
  }

  /**
   * 解析 B3DM ArrayBuffer
   */
  static parse(arrayBuffer: ArrayBuffer): B3DMResult {
    const view = new DataView(arrayBuffer)
    const u8 = new Uint8Array(arrayBuffer)

    // 1. 校验 magic
    const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3])
    if (magic !== 'b3dm') {
      throw new Error(`Not a b3dm file: magic="${magic}"`)
    }

    // 2. 读取 header（28 字节，little-endian uint32）
    const version = view.getUint32(4, true)
    const byteLength = view.getUint32(8, true)
    const ftJSONByteLength = view.getUint32(12, true)
    const ftBinaryByteLength = view.getUint32(16, true)
    const btJSONByteLength = view.getUint32(20, true)
    const btBinaryByteLength = view.getUint32(24, true)

    if (version !== 1) {
      throw new Error(`Unsupported b3dm version: ${version}`)
    }

    let offset = 28

    // 3. Feature Table JSON
    let featureTable: Record<string, unknown> = {}
    if (ftJSONByteLength > 0) {
      const jsonBytes = u8.subarray(offset, offset + ftJSONByteLength)
      const jsonStr = new TextDecoder().decode(jsonBytes)
      featureTable = JSON.parse(jsonStr)
    }
    offset += ftJSONByteLength + ftBinaryByteLength

    // 4. Batch Table JSON
    let batchTable: Record<string, unknown> | null = null
    if (btJSONByteLength > 0) {
      const jsonBytes = u8.subarray(offset, offset + btJSONByteLength)
      const jsonStr = new TextDecoder().decode(jsonBytes)
      batchTable = JSON.parse(jsonStr)
    }
    offset += btJSONByteLength + btBinaryByteLength

    // 5. 提取 GLB（用 GLB 自身 header 的 length，而非 byteLength - offset，避免尾 padding 干扰）
    const glbStart = offset
    if (glbStart + 12 > arrayBuffer.byteLength) {
      throw new Error('B3DM: GLB data missing or truncated')
    }

    const glbMagic = view.getUint32(glbStart, true)
    if (glbMagic !== 0x46546c67) {
      // 0x46546C67 = 'glTF' in little-endian
      throw new Error(
        `B3DM: Embedded glTF magic not found (got 0x${glbMagic.toString(16)})`
      )
    }

    const glbVersion = view.getUint32(glbStart + 4, true)
    const glbLength = view.getUint32(glbStart + 8, true)

    if (glbVersion !== 2) {
      console.warn(`[B3DMLoader] Unexpected GLB version: ${glbVersion}`)
    }

    // 切出 GLB 数据（确保 4 字节对齐）
    const glbEnd = Math.min(glbStart + glbLength, arrayBuffer.byteLength)
    const glbBytes = arrayBuffer.slice(glbStart, glbEnd)

    // 6. 提取 RTC_CENTER 和 BATCH_LENGTH
    const rtcCenter = (featureTable.RTC_CENTER as number[]) ?? null
    const batchLength = (featureTable.BATCH_LENGTH as number) ?? 0

    return {
      version,
      featureTable,
      batchTable,
      glb: glbBytes,
      rtcCenter,
      batchLength,
    }
  }
}
