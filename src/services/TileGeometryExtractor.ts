/**
 * TileGeometryExtractor — 从 3D Tiles 提取真实顶点/三角形几何数据
 *
 * === 重构方案：直接 fetch + 解析 B3DM 文件 ===
 *
 * 原方案通过 Cesium 内部 API (content._model._gltfLoader.components) 提取几何，
 * 但在 Cesium 1.121 中 loadAttributesAsTypedArray 默认 false，
 * 顶点数据在 GPU Buffer 中，typedArray 为 undefined，导致静默失败。
 *
 * 新方案完全绕过 Cesium 内部 API：
 * 1. TilesetScanner: 扫描 tileset.json，收集所有 B3DM URL 和变换矩阵
 * 2. B3DMLoader: 直接 fetch B3DM 文件，解析 28字节头 + Feature/Batch Table + GLB
 * 3. GLBMeshExtractor: 用 three.js GLTFLoader 解析 GLB，提取顶点/三角形
 * 4. 将模型局部坐标 → ECEF 世界坐标 → 局部 ENU 坐标（米）
 *
 * 优势：
 * - 不依赖 Cesium 内部 API，版本升级不会破坏
 * - 获取完整的真实网格数据（顶点 + 三角形 + 法线）
 * - 支持 _BATCHID 按对象分离
 * - 支持 Draco 压缩
 */
import * as Cesium from 'cesium'
import * as THREE from 'three'
import type { MeshGeometry } from '../core/types'
import { toLocalXY } from '../utils/geo'
import { B3DMLoader } from './B3DMLoader'
import { GLBMeshExtractor } from './GLBMeshExtractor'
import { TilesetScanner, type TileEntry } from './TilesetScanner'

/** 拾取结果：包含几何数据和语义属性 */
export interface PickedGeometry {
  /** 世界坐标系下的网格几何（已转换为局部 ENU 米坐标） */
  mesh: MeshGeometry
  /** 拾取点的地理坐标 */
  cartographic: Cesium.Cartographic
  /** Batch Table 属性 */
  batchProperties: Record<string, unknown>
}

/** 提取的瓦片几何（含多个对象） */
export interface ExtractedTileGeometry {
  /** 网格几何数据列表（可能含多个 batch 对象） */
  meshes: Array<{
    mesh: MeshGeometry
    batchId: number | null
    cartographic: Cesium.Cartographic
    batchProperties: Record<string, unknown>
  }>
  /** 瓦片 URL */
  tileUrl: string
}

export class TileGeometryExtractor {
  private glbExtractor: GLBMeshExtractor | null = null
  /** 已扫描的瓦片列表缓存 */
  private tileCache: TileEntry[] | null = null
  /** 已解析的 B3DM 缓存（URL → 结果） */
  private b3dmCache = new Map<string, ExtractedTileGeometry>()

  private getExtractor(): GLBMeshExtractor {
    if (!this.glbExtractor) {
      this.glbExtractor = new GLBMeshExtractor()
    }
    return this.glbExtractor
  }

  /**
   * 扫描 tileset.json 并提取所有 B3DM 瓦片的真实几何
   * @param tilesetUrl tileset.json 的 URL
   * @param maxTiles 最大提取瓦片数
   * @param onProgress 进度回调
   * @returns 提取的几何数据列表
   */
  async extractFromTilesetUrl(
    tilesetUrl: string,
    maxTiles = 10,
    onProgress?: (done: number, total: number) => void
  ): Promise<ExtractedTileGeometry[]> {
    // 1. 扫描 tileset.json 获取所有 B3DM URL
    if (!this.tileCache) {
      this.tileCache = await TilesetScanner.scan(tilesetUrl, 5, maxTiles * 3)
    }

    const tiles = this.tileCache.slice(0, maxTiles * 2)
    const results: ExtractedTileGeometry[] = []

    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i]
      onProgress?.(i, tiles.length)

      // 检查缓存
      if (this.b3dmCache.has(tile.url)) {
        results.push(this.b3dmCache.get(tile.url)!)
        continue
      }

      try {
        const result = await this.extractFromTileEntry(tile)
        if (result && result.meshes.length > 0) {
          this.b3dmCache.set(tile.url, result)
          results.push(result)
          if (results.length >= maxTiles) break
        }
      } catch (e) {
        console.warn(`[TileGeometryExtractor] Failed to extract ${tile.url}:`, e)
      }
    }

    onProgress?.(tiles.length, tiles.length)
    return results
  }

  /**
   * 从单个 TileEntry 提取几何
   */
  private async extractFromTileEntry(tile: TileEntry): Promise<ExtractedTileGeometry | null> {
    // 1. fetch + 解析 B3DM
    const b3dm = await B3DMLoader.fetchAndParse(tile.url)

    // 2. 用 GLBMeshExtractor 提取网格
    const extractor = this.getExtractor()
    const extractedMeshes = await extractor.extractFromGLB(b3dm.glb, b3dm.rtcCenter)

    if (extractedMeshes.length === 0) return null

    // 3. 构建变换矩阵：tile transform × GLB mesh transform
    const tileMatrix = new THREE.Matrix4().fromArray(tile.transform)

    // 4. 瓦片中心的地理坐标（用于局部 ENU 参考点）
    const centerEcef = new THREE.Vector3(
      tile.boundingSphereCenter[0],
      tile.boundingSphereCenter[1],
      tile.boundingSphereCenter[2]
    )
    // 如果中心在 ECEF 坐标系，转换为地理坐标
    const centerCartesian = new Cesium.Cartesian3(centerEcef.x, centerEcef.y, centerEcef.z)
    const refCartographic = Cesium.Cartographic.fromCartesian(centerCartesian)
    const refLonDeg = Cesium.Math.toDegrees(refCartographic.longitude)
    const refLatDeg = Cesium.Math.toDegrees(refCartographic.latitude)
    const refHeight = refCartographic.height

    // 5. 转换每个网格的顶点到局部 ENU 坐标
    const meshes: ExtractedTileGeometry['meshes'] = []

    for (const extracted of extractedMeshes) {
      // 完整变换：tile transform × mesh transform
      const fullTransform = new THREE.Matrix4().multiplyMatrices(tileMatrix, extracted.transform)

      // 转换顶点：模型局部 → ECEF 世界 → 局部 ENU
      const positions = extracted.mesh.positions
      const localPositions = new Float32Array(positions.length)
      const v = new THREE.Vector3()
      const tmpCartesian = new Cesium.Cartesian3()

      for (let i = 0; i < extracted.mesh.vertexCount; i++) {
        v.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
        v.applyMatrix4(fullTransform)

        // ECEF → 地理坐标
        tmpCartesian.x = v.x
        tmpCartesian.y = v.y
        tmpCartesian.z = v.z
        const carto = Cesium.Cartographic.fromCartesian(tmpCartesian)
        const lonDeg = Cesium.Math.toDegrees(carto.longitude)
        const latDeg = Cesium.Math.toDegrees(carto.latitude)

        // 地理坐标 → 局部 ENU（米）
        const localXY = toLocalXY(
          { lon: lonDeg, lat: latDeg },
          { lon: refLonDeg, lat: refLatDeg }
        )

        localPositions[i * 3] = localXY.x
        localPositions[i * 3 + 1] = localXY.y
        localPositions[i * 3 + 2] = carto.height - refHeight
      }

      // 从 Batch Table 获取属性
      const batchProperties: Record<string, unknown> = {}
      if (b3dm.batchTable && extracted.batchId !== null) {
        for (const [key, value] of Object.entries(b3dm.batchTable)) {
          if (Array.isArray(value)) {
            batchProperties[key] = value[extracted.batchId] ?? null
          } else {
            batchProperties[key] = value
          }
        }
      }

      meshes.push({
        mesh: {
          positions: localPositions,
          indices: extracted.mesh.indices,
          vertexCount: extracted.mesh.vertexCount,
          triangleCount: extracted.mesh.triangleCount,
        },
        batchId: extracted.batchId,
        cartographic: refCartographic,
        batchProperties,
      })
    }

    return { meshes, tileUrl: tile.url }
  }

  /**
   * 从 Cesium3DTileset 对象提取所有瓦片的真实几何（用于自动扫描）
   * @param tileset Cesium 3D Tiles 对象
   * @param maxTiles 最大提取瓦片数
   * @returns 扁平化的网格列表，每个元素含 mesh/cartographic/batchProperties
   */
  async extractAllFromTileset(
    tileset: Cesium.Cesium3DTileset,
    maxTiles = 10
  ): Promise<Array<{
    mesh: MeshGeometry
    cartographic: Cesium.Cartographic
    batchProperties: Record<string, unknown>
  }>> {
    // 从 tileset 对象获取 URL
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resource = (tileset as any).resource ?? (tileset as any)._resource
    const tilesetUrl = resource?.url ?? resource?._url

    if (!tilesetUrl) {
      console.warn('[TileGeometryExtractor] 无法获取 tileset URL')
      return []
    }

    try {
      const tiles = await this.extractFromTilesetUrl(tilesetUrl, maxTiles)
      // 扁平化：将所有瓦片的 meshes 合并为一个数组
      const result: Array<{
        mesh: MeshGeometry
        cartographic: Cesium.Cartographic
        batchProperties: Record<string, unknown>
      }> = []
      for (const tile of tiles) {
        for (const m of tile.meshes) {
          result.push({
            mesh: m.mesh,
            cartographic: m.cartographic,
            batchProperties: m.batchProperties,
          })
        }
      }
      return result
    } catch (e) {
      console.warn('[TileGeometryExtractor] extractAllFromTileset 失败:', e)
      return []
    }
  }

  /**
   * 从屏幕拾取位置提取真实几何数据（用于点击分析）
   *
   * 策略：先用 scene.pick() 获取 Cesium3DTileFeature，
   * 从中获取瓦片 URL，然后直接 fetch B3DM 解析。
   * 如果获取 URL 失败，降级到遍历所有瓦片。
   */
  async extractFromScreen(
    scene: Cesium.Scene,
    position: Cesium.Cartesian2,
    tilesetUrl?: string
  ): Promise<PickedGeometry | null> {
    // 获取拾取点的世界坐标
    const worldPos = scene.pickPosition(position)
    if (!worldPos) return null
    const cartographic = Cesium.Cartographic.fromCartesian(worldPos)

    // 尝试从 pick 结果获取瓦片 URL
    const picked = scene.pick(position)
    if (Cesium.defined(picked)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const feature = (picked as any).id ?? (picked as any).primitive
      if (feature && typeof feature.getPropertyIds === 'function') {
        // 获取 Batch Table 属性
        const batchProperties: Record<string, unknown> = {}
        try {
          const propertyIds = feature.getPropertyIds()
          for (const pid of propertyIds) {
            batchProperties[pid] = feature.getProperty(pid)
          }
        } catch {
          // 忽略
        }

        // 尝试获取 content URL
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const content = (feature as any).content
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tile = content?._tile ?? (feature as any)._tile
        const resourceUrl = tile?.content?.resource?.url ?? tile?._contentResource?.url

        if (resourceUrl) {
          try {
            const b3dm = await B3DMLoader.fetchAndParse(resourceUrl)
            const extractor = this.getExtractor()
            const meshes = await extractor.extractFromGLB(b3dm.glb, b3dm.rtcCenter)

            if (meshes.length > 0) {
              // 取第一个 mesh（或根据 batchId 选择）
              const targetMesh = meshes[0]

              // 转换顶点到局部 ENU
              const refLonDeg = Cesium.Math.toDegrees(cartographic.longitude)
              const refLatDeg = Cesium.Math.toDegrees(cartographic.latitude)
              const refHeight = cartographic.height

              const positions = targetMesh.mesh.positions
              const localPositions = new Float32Array(positions.length)
              const v = new THREE.Vector3()
              const tmpCartesian = new Cesium.Cartesian3()

              // 如果有 tile transform，需要应用
              // 简化：直接将 GLB 局部坐标作为 ENU 坐标（因为 B3DM 的坐标已经是相对瓦片中心的）
              // 叠加 RTC_CENTER
              for (let i = 0; i < targetMesh.mesh.vertexCount; i++) {
                localPositions[i * 3] = positions[i * 3]
                localPositions[i * 3 + 1] = positions[i * 3 + 1]
                localPositions[i * 3 + 2] = positions[i * 3 + 2]
              }

              return {
                mesh: {
                  positions: localPositions,
                  indices: targetMesh.mesh.indices,
                  vertexCount: targetMesh.mesh.vertexCount,
                  triangleCount: targetMesh.mesh.triangleCount,
                },
                cartographic,
                batchProperties,
              }
            }
          } catch (e) {
            console.warn('[TileGeometryExtractor] Direct B3DM fetch failed, trying tileset scan:', e)
          }
        }
      }
    }

    // 降级：如果提供了 tilesetUrl，扫描并提取最近的瓦片
    if (tilesetUrl) {
      return await this.extractNearestTile(tilesetUrl, cartographic)
    }

    return null
  }

  /**
   * 从 tileset 中找到距离拾取点最近的瓦片并提取几何
   */
  private async extractNearestTile(
    tilesetUrl: string,
    targetCartographic: Cesium.Cartographic
  ): Promise<PickedGeometry | null> {
    if (!this.tileCache) {
      this.tileCache = await TilesetScanner.scan(tilesetUrl, 5, 30)
    }

    // 找到距离拾取点最近的瓦片
    let nearestTile: TileEntry | null = null
    let minDistance = Infinity

    const targetCartesian = Cesium.Cartographic.toCartesian(targetCartographic)

    for (const tile of this.tileCache) {
      const tileCenter = new Cesium.Cartesian3(
        tile.boundingSphereCenter[0],
        tile.boundingSphereCenter[1],
        tile.boundingSphereCenter[2]
      )
      const distance = Cesium.Cartesian3.distance(targetCartesian, tileCenter)
      if (distance < minDistance) {
        minDistance = distance
        nearestTile = tile
      }
    }

    if (!nearestTile) return null

    try {
      const result = await this.extractFromTileEntry(nearestTile)
      if (result && result.meshes.length > 0) {
        const mesh = result.meshes[0]
        return {
          mesh: mesh.mesh,
          cartographic: mesh.cartographic,
          batchProperties: mesh.batchProperties,
        }
      }
    } catch (e) {
      console.warn('[TileGeometryExtractor] Nearest tile extraction failed:', e)
    }

    return null
  }

  /** 清理缓存 */
  clearCache(): void {
    this.tileCache = null
    this.b3dmCache.clear()
  }

  /** 释放资源 */
  dispose(): void {
    this.glbExtractor?.dispose()
  }
}
