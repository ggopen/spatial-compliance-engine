/**
 * Scene Service：Cesium Viewer 管理 + 3D Tiles 加载 + 真实几何提取。
 *
 * 核心原则：Never guess geometry. Always call measurement tools.
 *
 * 几何数据提取管线（优先级从高到低）：
 * 1. TileGeometryExtractor: 通过 scene.pick() 获取 Cesium3DTileFeature，
 *    从 _gltfLoader.components 提取真实顶点/三角形数据 → MeshAnalyzer 分析
 * 2. 降级方案: scene.sampleHeightMostDetailed 高度采样 + PCA（旧逻辑，兼容无瓦片几何的场景）
 *
 * 关键改进：不再仅依赖 2.5D 高度采样猜测形状，
 * 而是直接从 3D Tiles 的 glTF 数据中提取真实顶点，
 * 用 three.js 计算凸包体积、表面积、实心度等精确几何特征。
 */
import * as Cesium from 'cesium'
import type { BoundingInfo } from '../core/types'
import { GeometryAnalyzer, type SamplePoint } from '../core/GeometryAnalyzer'
import { TileGeometryExtractor } from './TileGeometryExtractor'
import { MeshAnalyzer } from './MeshAnalyzer'
import { PointCloudProcessor } from './PointCloudProcessor'
import { clusterGrid, pca2d, toLocalXY } from '../utils/geo'

export class SceneService {
  private viewer: Cesium.Viewer | null = null
  private tileset: Cesium.Cesium3DTileset | null = null
  private tilesetUrl: string | null = null
  private geometryAnalyzer = new GeometryAnalyzer()
  private meshAnalyzer = new MeshAnalyzer()
  private geometryExtractor = new TileGeometryExtractor()
  private pclProcessor = PointCloudProcessor.getInstance()

  get isReady(): boolean {
    return this.viewer !== null && this.tileset !== null
  }

  /** 初始化 Viewer（不使用 ion 资源，保证离线/无令牌可用） */
  init(container: HTMLElement): Cesium.Viewer {
    const viewer = new Cesium.Viewer(container, {
      baseLayer: false,
      animation: false,
      timeline: false,
      geocoder: false,
      homeButton: true,
      sceneModePicker: false,
      baseLayerPicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false
    })
    viewer.scene.globe.show = false
    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#0b1017')
    // 启用深度测试，确保 pickPosition 能正确工作
    viewer.scene.globe.depthTestAgainstTerrain = true
    this.viewer = viewer
    return viewer
  }

  getViewer(): Cesium.Viewer {
    if (!this.viewer) throw new Error('Viewer 尚未初始化')
    return this.viewer
  }

  /** 加载 3D Tiles 并定位 */
  async loadTileset(url: string): Promise<Cesium.Cesium3DTileset> {
    const viewer = this.getViewer()
    const tileset = await Cesium.Cesium3DTileset.fromUrl(url, {
      maximumScreenSpaceError: 8,
      skipLevelOfDetail: true
    })
    viewer.scene.primitives.add(tileset)
    this.tileset = tileset
    this.tilesetUrl = url
    await viewer.zoomTo(tileset)
    return tileset
  }

  /** 拾取屏幕位置的地理坐标 */
  pickCartographic(position: Cesium.Cartesian2): Cesium.Cartographic | null {
    const viewer = this.getViewer()
    const ray = viewer.camera.getPickRay(position)
    if (!ray) return null
    const cartesian = viewer.scene.pickPosition(position)
    if (!cartesian) {
      const globe = viewer.scene.globe
      const c = globe.pick(ray, viewer.scene)
      if (!c) return null
      return Cesium.Cartographic.fromCartesian(c)
    }
    return Cesium.Cartographic.fromCartesian(cartesian)
  }

  /**
   * 点击分析：优先从 3D Tiles 提取真实网格几何，降级到高度采样。
   *
   * 流程：
   * 1. 用 TileGeometryExtractor 从 scene.pick() 获取 Cesium3DTileFeature
   * 2. 直接 fetch B3DM 文件，解析 GLB 提取真实顶点/三角形
   * 3. 用 MeshAnalyzer 计算凸包体积、表面积、实心度等
   * 4. 用 PointCloudProcessor (PCL.js) 计算法线、平面分割等 PCL 特征
   * 5. 若提取失败，降级到 scene.sampleHeightMostDetailed 高度采样
   */
  async analyzeAt(
    position: Cesium.Cartesian2,
    radius = 2.0,
    step = 0.4
  ): Promise<BoundingInfo | null> {
    const viewer = this.getViewer()

    // === 优先路径：真实网格几何提取 ===
    try {
      const picked = await this.geometryExtractor.extractFromScreen(
        viewer.scene,
        position,
        this.tilesetUrl ?? undefined
      )
      if (picked) {
        const bbox = await this.buildBBoxFromMesh(picked)
        if (bbox) return bbox
      }
    } catch (e) {
      // 内部 API 可能因 Cesium 版本变化而失败，降级到高度采样
      console.warn('[SceneService] 网格提取失败，降级到高度采样:', e)
    }

    // === 降级路径：高度采样 ===
    return this.analyzeByHeightSampling(position, radius, step)
  }

  /**
   * 从提取的网格几何构建 BoundingInfo（含 PCL.js 点云分析）
   */
  private async buildBBoxFromMesh(picked: {
    mesh: import('../core/types').MeshGeometry
    cartographic: Cesium.Cartographic
    batchProperties: Record<string, unknown>
  }): Promise<BoundingInfo | null> {
    const mesh = picked.mesh
    if (mesh.vertexCount < 3) return null

    // 计算网格的高级几何特征
    const meshFeatures = this.meshAnalyzer.analyze(mesh)

    // === PCL.js 点云分析（第三方库） ===
    // 计算法线、平面分割、圆柱检测等特征
    try {
      const pclFeatures = await this.pclProcessor.analyze(mesh)
      if (pclFeatures) {
        meshFeatures.pclFeatures = pclFeatures
      }
    } catch (e) {
      console.warn('[SceneService] PCL 分析失败，仅使用几何特征:', e)
    }

    // 从顶点计算 AABB（用于基础尺寸）
    const positions = mesh.positions
    let minX = Infinity, minY = Infinity, minZ = Infinity
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
    for (let i = 0; i < mesh.vertexCount; i++) {
      const x = positions[i * 3]
      const y = positions[i * 3 + 1]
      const z = positions[i * 3 + 2]
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (z < minZ) minZ = z
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
      if (z > maxZ) maxZ = z
    }

    const width = Math.max(0.01, maxX - minX)
    const length = Math.max(0.01, maxY - minY)
    const height = Math.max(0.01, maxZ - minZ)

    // 中心点（地理坐标）
    const centerLon = Cesium.Math.toDegrees(picked.cartographic.longitude)
    const centerLat = Cesium.Math.toDegrees(picked.cartographic.latitude)
    const centerHeight = picked.cartographic.height

    // 地面基准高 = 最低点
    const groundHeight = centerHeight + minZ

    // 方位角：用 OBB 的第一主轴在 XY 平面的投影
    // 简化：用对角线方向
    const orientationDeg = Math.round(
      (Math.atan2(maxY - minY, maxX - minX) * 180) / Math.PI
    )

    const bbox: BoundingInfo = {
      center: { lon: centerLon, lat: centerLat, height: centerHeight + (maxZ + minZ) / 2 },
      width: Math.min(width, length),
      length: Math.max(width, length),
      height,
      orientationDeg,
      groundHeight,
      mesh,
      meshFeatures,
      batchProperties: picked.batchProperties,
    }

    // 计算增强的形状描述子（融合真实网格特征）
    bbox.shape = this.meshAnalyzer.computeEnhancedShapeDescriptor(bbox, meshFeatures)

    return bbox
  }

  /**
   * 降级方案：高度采样 + PCA（旧逻辑）
   */
  private async analyzeByHeightSampling(
    position: Cesium.Cartesian2,
    radius = 2.0,
    step = 0.4
  ): Promise<BoundingInfo | null> {
    const center = this.pickCartographic(position)
    if (!center) return null

    const centerLon = Cesium.Math.toDegrees(center.longitude)
    const centerLat = Cesium.Math.toDegrees(center.latitude)
    const latDegPerM = 1 / 111320
    const lonDegPerM = 1 / (111320 * Math.cos(center.latitude))

    const cartos: Cesium.Cartographic[] = []
    const gridXY: Array<{ x: number; y: number }> = []
    const n = Math.max(2, Math.round((radius * 2) / step))
    for (let iy = 0; iy <= n; iy++) {
      for (let ix = 0; ix <= n; ix++) {
        const x = -radius + ix * step
        const y = -radius + iy * step
        gridXY.push({ x, y })
        cartos.push(
          Cesium.Cartographic.fromDegrees(centerLon + x * lonDegPerM, centerLat + y * latDegPerM)
        )
      }
    }

    const sampled = await this.sampleHeights(cartos, 120)
    const heights = sampled.filter((s): s is Cesium.Cartographic => !!s).map((s) => s.height)
    if (heights.length < 4) return null

    const ground = Math.min(...heights)
    const threshold = ground + 0.3
    const elevated: Array<{ x: number; y: number; h: number; lon: number; lat: number }> = []
    sampled.forEach((s, i) => {
      if (s && s.height > threshold) {
        elevated.push({
          x: gridXY[i].x,
          y: gridXY[i].y,
          h: s.height,
          lon: Cesium.Math.toDegrees(s.longitude),
          lat: Cesium.Math.toDegrees(s.latitude)
        })
      }
    })

    if (elevated.length < 3) {
      const groundBbox: BoundingInfo = {
        center: { lon: centerLon, lat: centerLat, height: ground },
        width: radius * 2,
        length: radius * 2,
        height: 0.1,
        orientationDeg: 0,
        groundHeight: ground
      }
      groundBbox.shape = this.geometryAnalyzer.analyze(groundBbox)
      return groundBbox
    }

    const pca = pca2d(elevated.map((p) => ({ x: p.x, y: p.y })))
    const maxH = Math.max(...elevated.map((p) => p.h))
    const objHeight = maxH - ground
    const mLon = elevated.reduce((s, p) => s + p.lon, 0) / elevated.length
    const mLat = elevated.reduce((s, p) => s + p.lat, 0) / elevated.length

    const bbox: BoundingInfo = {
      center: { lon: mLon, lat: mLat, height: ground + objHeight },
      width: Math.max(0.1, Math.min(pca.lengthAlongMajor, pca.lengthAlongMinor) + step),
      length: Math.max(0.1, Math.max(pca.lengthAlongMajor, pca.lengthAlongMinor) + step),
      height: objHeight,
      orientationDeg: pca.orientationDeg,
      groundHeight: ground
    }

    const samplePoints: SamplePoint[] = elevated.map((p) => ({ x: p.x, y: p.y, h: p.h }))
    bbox.shape = this.geometryAnalyzer.analyze(bbox, samplePoints)

    return bbox
  }

  /** 分批对瓦片集做最详细层级高度采样 */
  private async sampleHeights(
    cartos: Cesium.Cartographic[],
    chunkSize = 120,
    onProgress?: (done: number, total: number) => void
  ): Promise<Array<Cesium.Cartographic | undefined>> {
    const scene = this.getViewer().scene
    const results: Array<Cesium.Cartographic | undefined> = new Array(cartos.length)
    for (let i = 0; i < cartos.length; i += chunkSize) {
      const chunk = cartos.slice(i, i + chunkSize)
      const sampled = await scene.sampleHeightMostDetailed(chunk)
      for (let j = 0; j < chunk.length; j++) {
        results[i + j] = sampled[j] && Number.isFinite(sampled[j].height) ? sampled[j] : undefined
      }
      onProgress?.(Math.min(i + chunkSize, cartos.length), cartos.length)
    }
    return results
  }

  /**
   * 自动扫描：优先遍历已加载瓦片提取真实几何，降级到高度采样。
   */
  async autoScan(
    gridSize = 22,
    maxObjects = 10,
    onProgress?: (done: number, total: number) => void
  ): Promise<BoundingInfo[]> {
    if (!this.tileset) throw new Error('瓦片集未加载')

    // === 优先路径：遍历已加载瓦片提取真实几何 ===
    try {
      onProgress?.(0, 1)
      const tileMeshes = await this.geometryExtractor.extractAllFromTileset(
        this.tileset,
        maxObjects * 2
      )
      onProgress?.(1, 2)
      if (tileMeshes.length > 0) {
        const results: BoundingInfo[] = []
        for (let i = 0; i < Math.min(tileMeshes.length, maxObjects * 3); i++) {
          const tm = tileMeshes[i]
          onProgress?.(i + 1, Math.min(tileMeshes.length, maxObjects * 3))
          const bbox = await this.buildBBoxFromMesh(tm)
          if (bbox) results.push(bbox)
          if (results.length >= maxObjects) break
        }
        if (results.length > 0) {
          onProgress?.(1, 1)
          return results
        }
      }
    } catch (e) {
      console.warn('[SceneService] 瓦片遍历提取失败，降级到高度采样:', e)
    }

    // === 降级路径：高度采样 + 聚类 ===
    return this.autoScanByHeightSampling(gridSize, maxObjects, onProgress)
  }

  /**
   * 降级方案：高度采样 + 聚类自动扫描
   */
  private async autoScanByHeightSampling(
    gridSize = 22,
    maxObjects = 10,
    onProgress?: (done: number, total: number) => void
  ): Promise<BoundingInfo[]> {
    const sphere = this.tileset!.boundingSphere
    const centerCarto = Cesium.Cartographic.fromCartesian(sphere.center)
    const centerLon = Cesium.Math.toDegrees(centerCarto.longitude)
    const centerLat = Cesium.Math.toDegrees(centerCarto.latitude)
    const half = sphere.radius * 0.75
    const latDegPerM = 1 / 111320
    const lonDegPerM = 1 / (111320 * Math.cos(centerCarto.latitude))

    const cartos: Cesium.Cartographic[] = []
    for (let iy = 0; iy < gridSize; iy++) {
      for (let ix = 0; ix < gridSize; ix++) {
        const x = -half + (2 * half * ix) / (gridSize - 1)
        const y = -half + (2 * half * iy) / (gridSize - 1)
        cartos.push(
          Cesium.Cartographic.fromDegrees(centerLon + x * lonDegPerM, centerLat + y * latDegPerM)
        )
      }
    }

    const sampled = await this.sampleHeights(cartos, 100, onProgress)
    const heights = sampled.filter((s): s is Cesium.Cartographic => !!s).map((s) => s.height)
    if (heights.length < 10) return []

    const sorted = [...heights].sort((a, b) => a - b)
    const ground = sorted[Math.floor(sorted.length * 0.1)]
    const threshold = ground + 1.0

    const mask = sampled.map((s) => !!s && s.height > threshold)
    const clusters = clusterGrid(mask, gridSize, gridSize)

    const ref = { lon: centerLon, lat: centerLat }
    const results: BoundingInfo[] = []
    const sortedClusters = clusters
      .filter((c) => c.length >= 2)
      .sort((a, b) => b.length - a.length)
      .slice(0, maxObjects)

    for (const cluster of sortedClusters) {
      const pts: Array<{ lon: number; lat: number; h: number; x: number; y: number }> = []
      for (const idx of cluster) {
        const s = sampled[idx]
        if (!s) continue
        const lon = Cesium.Math.toDegrees(s.longitude)
        const lat = Cesium.Math.toDegrees(s.latitude)
        const xy = toLocalXY({ lon, lat }, ref)
        pts.push({ lon, lat, h: s.height, x: xy.x, y: xy.y })
      }
      if (pts.length < 2) continue
      const pca = pca2d(pts.map((p) => ({ x: p.x, y: p.y })))
      const cell = (2 * half) / (gridSize - 1)
      const maxH = Math.max(...pts.map((p) => p.h))
      const mLon = pts.reduce((s, p) => s + p.lon, 0) / pts.length
      const mLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length
      const bbox: BoundingInfo = {
        center: { lon: mLon, lat: mLat, height: maxH },
        width: Math.max(0.2, Math.min(pca.lengthAlongMajor, pca.lengthAlongMinor) + cell),
        length: Math.max(0.2, Math.max(pca.lengthAlongMajor, pca.lengthAlongMinor) + cell),
        height: maxH - ground,
        orientationDeg: pca.orientationDeg,
        groundHeight: ground
      }
      const samplePoints: SamplePoint[] = pts.map((p) => ({ x: p.x, y: p.y, h: p.h }))
      bbox.shape = this.geometryAnalyzer.analyze(bbox, samplePoints)
      results.push(bbox)
    }
    return results
  }

  /** 飞到指定包围盒 */
  flyTo(bbox: BoundingInfo): void {
    const viewer = this.getViewer()
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        bbox.center.lon,
        bbox.center.lat,
        bbox.center.height + Math.max(bbox.length, bbox.height) * 4 + 30
      ),
      duration: 1.2
    })
  }
}
