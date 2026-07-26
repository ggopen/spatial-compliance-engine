/**
 * TilesetScanner — 递归扫描 3D Tiles tileset.json，收集所有 B3DM 瓦片 URL 及其变换矩阵
 *
 * 核心能力：
 * 1. fetch tileset.json 并递归遍历子 tileset
 * 2. 收集每个 content.url 指向的 B3DM 文件路径
 * 3. 计算每个瓦片的完整变换矩阵（root transform × parent transforms × tile transform）
 * 4. 处理 LOD 层级，优先选择最高精度的瓦片
 *
 * 这是直接获取 B3DM 数据的第一步：
 * 知道有哪些 B3DM 文件、它们的 URL 和空间变换。
 */

/** 瓦片变换信息 */
export interface TileEntry {
  /** B3DM 文件的完整 URL */
  url: string
  /** 瓦片的完整变换矩阵（4×4，列主序，与 Cesium Matrix4 兼容） */
  transform: number[]
  /** 包围盒中心（ECEF Cartesian3） */
  boundingSphereCenter: number[]
  /** 包围球半径 */
  boundingSphereRadius: number
  /** 几何误差（越小精度越高） */
  geometricError: number
  /** LOD 层级深度（0=根） */
  depth: number
}

/** tileset.json 节点结构 */
interface TilesetNode {
  content?: { url?: string; uri?: string }
  children?: TilesetNode[]
  transform?: number[]
  boundingVolume?: {
    region?: number[]
    box?: number[]
    sphere?: number[]
  }
  geometricError?: number
  refine?: string
}

/** tileset.json 根结构 */
interface TilesetRoot {
  asset: { version: string; gltfUpAxis?: string }
  geometricError: number
  root: TilesetNode
}

export class TilesetScanner {
  /**
   * 扫描 tileset.json，收集所有 B3DM 瓦片
   * @param tilesetUrl tileset.json 的 URL
   * @param maxDepth 最大递归深度（默认 5）
   * @param maxTiles 最大瓦片数（默认 50，避免下载过多）
   * @returns 瓦片条目列表，按 geometricError 升序（精度高的在前）
   */
  static async scan(
    tilesetUrl: string,
    maxDepth = 5,
    maxTiles = 50
  ): Promise<TileEntry[]> {
    const baseUrl = this.getBaseUrl(tilesetUrl)
    const tiles: TileEntry[] = []

    await this.scanNode(tilesetUrl, baseUrl, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 0, maxDepth, maxTiles, tiles)

    // 按 geometricError 升序排列（精度高的在前）
    tiles.sort((a, b) => a.geometricError - b.geometricError)

    return tiles.slice(0, maxTiles)
  }

  /**
   * 递归扫描 tileset 节点
   */
  private static async scanNode(
    url: string,
    baseUrl: string,
    parentTransform: number[],
    depth: number,
    maxDepth: number,
    maxTiles: number,
    results: TileEntry[]
  ): Promise<void> {
    if (depth > maxDepth || results.length >= maxTiles) return

    let tileset: TilesetRoot
    try {
      const response = await fetch(url)
      if (!response.ok) return
      tileset = await response.json()
    } catch {
      return
    }

    // 根节点的 transform
    const rootTransform = tileset.root.transform
      ? this.multiplyMatrices(parentTransform, tileset.root.transform)
      : parentTransform

    await this.processTileNode(tileset.root, baseUrl, rootTransform, depth, maxDepth, maxTiles, results)
  }

  /**
   * 处理单个 tile 节点
   */
  private static async processTileNode(
    node: TilesetNode,
    baseUrl: string,
    parentTransform: number[],
    depth: number,
    maxDepth: number,
    maxTiles: number,
    results: TileEntry[]
  ): Promise<void> {
    if (results.length >= maxTiles) return

    // 当前节点的变换
    const tileTransform = node.transform
      ? this.multiplyMatrices(parentTransform, node.transform)
      : parentTransform

    // 处理 content
    if (node.content) {
      const contentUrl = node.content.url ?? node.content.uri
      if (contentUrl) {
        const fullUrl = this.resolveUrl(contentUrl, baseUrl)

        // 只收集 B3DM 文件
        if (fullUrl.toLowerCase().endsWith('.b3dm')) {
          const { center, radius } = this.extractBoundingInfo(node.boundingVolume)

          results.push({
            url: fullUrl,
            transform: tileTransform,
            boundingSphereCenter: center,
            boundingSphereRadius: radius,
            geometricError: node.geometricError ?? 0,
            depth,
          })
        }
      }
    }

    // 递归处理子节点
    if (node.children && depth < maxDepth) {
      for (const child of node.children) {
        if (results.length >= maxTiles) break
        await this.processTileNode(child, baseUrl, tileTransform, depth + 1, maxDepth, maxTiles, results)
      }
    }
  }

  /**
   * 从 URL 获取基础路径（去掉文件名，保留目录）
   */
  private static getBaseUrl(url: string): string {
    const idx = url.lastIndexOf('/')
    return idx >= 0 ? url.substring(0, idx + 1) : ''
  }

  /**
   * 解析相对 URL
   */
  private static resolveUrl(url: string, baseUrl: string): string {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url
    }
    return baseUrl + url
  }

  /**
   * 从 boundingVolume 提取中心和半径
   */
  private static extractBoundingInfo(
    bv: TilesetNode['boundingVolume']
  ): { center: number[]; radius: number } {
    if (!bv) return { center: [0, 0, 0], radius: 0 }

    if (bv.sphere) {
      // sphere: [cx, cy, cz, radius]
      return {
        center: [bv.sphere[0], bv.sphere[1], bv.sphere[2]],
        radius: bv.sphere[3],
      }
    }

    if (bv.box) {
      // box: [cx, cy, cz, hx, hy, hz, ...]
      // 简化：用半轴长度之和作为半径估算
      const cx = bv.box[0], cy = bv.box[1], cz = bv.box[2]
      const hx = bv.box[3], hy = bv.box[7], hz = bv.box[11]
      const radius = Math.sqrt(hx * hx + hy * hy + hz * hz)
      return { center: [cx, cy, cz], radius }
    }

    if (bv.region) {
      // region: [west, south, east, north, minHeight, maxHeight]
      // 简化估算
      const west = bv.region[0], south = bv.region[1]
      const east = bv.region[2], north = bv.region[3]
      const minH = bv.region[4], maxH = bv.region[5]
      const cx = (west + east) / 2
      const cy = (south + north) / 2
      const cz = (minH + maxH) / 2
      const radius = Math.max(
        Math.abs(east - west) * 111320,
        Math.abs(north - south) * 111320,
        maxH - minH
      ) / 2
      return { center: [cx, cy, cz], radius }
    }

    return { center: [0, 0, 0], radius: 0 }
  }

  /**
   * 4×4 矩阵乘法（列主序）
   */
  private static multiplyMatrices(a: number[], b: number[]): number[] {
    const result = new Array(16).fill(0)
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        let sum = 0
        for (let k = 0; k < 4; k++) {
          sum += a[k * 4 + j] * b[i * 4 + k]
        }
        result[i * 4 + j] = sum
      }
    }
    return result
  }
}
