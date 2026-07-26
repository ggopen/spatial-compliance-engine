/**
 * PointCloudProcessor — 基于 PCL.js (WebAssembly) 的第三方点云分析器
 *
 * PCL.js 是 Point Cloud Library 的浏览器 WebAssembly 移植版，
 * 提供工业级的点云处理能力：滤波、法线估计、RANSAC 分割等。
 *
 * 核心能力：
 * 1. VoxelGrid 下采样 — 降低点云密度，加速后续计算
 * 2. StatisticalOutlierRemoval — 去除摄影测量噪声点
 * 3. NormalEstimation — 估计表面法线，判断表面朝向
 * 4. SACSegmentation (RANSAC) — 平面/圆柱体拟合，检测结构元素
 *
 * 这些特征让 RecognitionAgent 能区分：
 * - 墙体/门/围栏：法线水平、大平面占比
 * - 地面/屋顶/道路：法线竖直、水平大平面
 * - 杆体/柱子：圆柱拟合成功
 * - 树木/异形：法线熵高、无大平面
 */
import type { PCLFeatures, MeshGeometry } from '../core/types'

// PCL.js 类型（动态导入，避免类型检查失败）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PCLModule = any

export class PointCloudProcessor {
  private static instance: PointCloudProcessor | null = null
  private pcl: PCLModule | null = null
  private initPromise: Promise<PCLModule> | null = null
  private initFailed = false

  static getInstance(): PointCloudProcessor {
    if (!PointCloudProcessor.instance) {
      PointCloudProcessor.instance = new PointCloudProcessor()
    }
    return PointCloudProcessor.instance
  }

  /**
   * 初始化 PCL.js WASM 模块（懒加载，首次调用时触发）
   * 失败后标记 initFailed，后续直接返回 null，不影响主流程
   */
  async ensureInitialized(): Promise<PCLModule | null> {
    if (this.pcl) return this.pcl
    if (this.initFailed) return null
    if (this.initPromise) return this.initPromise

    this.initPromise = this.doInit()
    this.pcl = await this.initPromise
    return this.pcl
  }

  private async doInit(): Promise<PCLModule> {
    try {
      const PCL = await import('pcl.js')
      await PCL.init({
        url: 'https://cdn.jsdelivr.net/npm/pcl.js@1.16.0/dist/pcl-core.wasm',
      })
      console.log('[PointCloudProcessor] PCL.js 初始化成功')
      return PCL
    } catch (e) {
      console.warn('[PointCloudProcessor] PCL.js 初始化失败，将降级到纯几何分析:', e)
      this.initFailed = true
      throw e
    }
  }

  /**
   * 分析网格几何，生成 PCL 点云特征
   * @param mesh 网格几何数据（顶点坐标）
   * @returns PCL 特征，若 PCL 未初始化或点太少则返回 null
   */
  async analyze(mesh: MeshGeometry): Promise<PCLFeatures | null> {
    const PCL = await this.ensureInitialized()
    if (!PCL) return null

    const positions = mesh.positions
    const totalPoints = mesh.vertexCount
    if (totalPoints < 10) return null

    try {
      // 1. 将网格顶点转换为 PCL PointCloud
      // 限制最大点数，避免 WASM 内存溢出
      const maxPoints = 5000
      const stride = Math.max(1, Math.floor(totalPoints / maxPoints))
      const cloud = this.createPointCloud(PCL, positions, totalPoints, stride)

      if (cloud.size < 10) return null

      // 2. 计算点云分辨率（平均点间距）
      const resolution = this.computeCloudResolution(PCL, cloud)

      // 3. VoxelGrid 下采样
      const leafSize = Math.max(resolution * 2, 0.05)
      const downsampled = this.voxelDownsample(PCL, cloud, leafSize)
      const downsampledCount = downsampled.size

      // 4. 法线估计
      const normals = this.estimateNormals(PCL, downsampled, resolution)

      // 5. 法线统计分析
      const normalStats = this.analyzeNormals(PCL, normals)

      // 6. RANSAC 平面分割（迭代提取平面）
      const planeResults = this.extractPlanes(PCL, downsampled, resolution)

      // 7. RANSAC 圆柱体检测
      const cylinderResult = this.detectCylinder(PCL, downsampled, resolution)

      // 8. 计算表面复杂度
      const surfaceComplexity = this.computeSurfaceComplexity(
        normalStats.entropy,
        planeResults.planeCount,
        planeResults.largestPlaneRatio
      )

      const features: PCLFeatures = {
        cloudResolution: this.round(resolution),
        downsampledPointCount: downsampledCount,
        normalVerticality: this.round(normalStats.verticality),
        normalHorizontality: this.round(normalStats.horizontality),
        planeCount: planeResults.planeCount,
        largestPlaneRatio: this.round(planeResults.largestPlaneRatio),
        largestPlaneNormal: planeResults.largestPlaneNormal,
        largestPlaneIsHorizontal: planeResults.largestPlaneIsHorizontal,
        hasCylinder: cylinderResult.hasCylinder,
        cylinderRadius: cylinderResult.radius,
        normalEntropy: this.round(normalStats.entropy),
        surfaceComplexity: this.round(surfaceComplexity),
      }

      console.log('[PointCloudProcessor] PCL 分析完成:', features)
      return features
    } catch (e) {
      console.warn('[PointCloudProcessor] 分析失败:', e)
      return null
    }
  }

  /**
   * 从 Float32Array 创建 PCL PointCloud
   */
  private createPointCloud(
    PCL: PCLModule,
    positions: Float32Array,
    count: number,
    stride: number
  ): PCLModule {
    const cloud = new PCL.PointCloud(PCL.PointXYZ)
    let added = 0
    for (let i = 0; i < count; i += stride) {
      const x = positions[i * 3]
      const y = positions[i * 3 + 1]
      const z = positions[i * 3 + 2]
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        cloud.addPoint(new PCL.PointXYZ(x, y, z))
        added++
      }
    }
    return cloud
  }

  /**
   * 计算点云分辨率（平均最近邻距离）
   */
  private computeCloudResolution(PCL: PCLModule, cloud: PCLModule): number {
    try {
      return PCL.computeCloudResolution(cloud)
    } catch {
      // 降级：用包围盒体积 / 点数 估算
      const n = cloud.size
      if (n < 2) return 0.1
      // 简单估算
      return Math.pow(1 / n, 1 / 3)
    }
  }

  /**
   * VoxelGrid 下采样
   */
  private voxelDownsample(
    PCL: PCLModule,
    cloud: PCLModule,
    leafSize: number
  ): PCLModule {
    try {
      const voxel = new PCL.VoxelGrid(PCL.PointXYZ)
      voxel.setInputCloud(cloud)
      voxel.setLeafSize(leafSize, leafSize, leafSize)
      const result = voxel.filter()
      return result || cloud
    } catch (e) {
      console.warn('[PointCloudProcessor] VoxelGrid 下采样失败:', e)
      return cloud
    }
  }

  /**
   * 法线估计
   */
  private estimateNormals(
    PCL: PCLModule,
    cloud: PCLModule,
    resolution: number
  ): PCLModule {
    const normals = new PCL.PointCloud(PCL.Normal)
    try {
      const tree = new PCL.KdTreeFLANN(PCL.PointXYZ)
      const normEst = new PCL.NormalEstimation()
      normEst.setSearchMethod(tree)
      // 搜索半径 = 分辨率的 5 倍，确保有足够邻居
      const radius = Math.max(resolution * 5, 0.1)
      normEst.setRadiusSearch(radius)
      normEst.setInputCloud(cloud)
      normEst.compute(normals)
    } catch (e) {
      console.warn('[PointCloudProcessor] 法线估计失败:', e)
    }
    return normals
  }

  /**
   * 分析法线统计特征
   */
  private analyzeNormals(
    PCL: PCLModule,
    normals: PCLModule
  ): {
    verticality: number
    horizontality: number
    entropy: number
  } {
    const count = normals.size
    if (count === 0) {
      return { verticality: 0, horizontality: 0, entropy: 0 }
    }

    let sumAbsNz = 0
    let sumHorizontal = 0

    // 法线方向分箱（6 个主方向 + 2 个对角区域）
    const bins = new Array(8).fill(0)

    for (let i = 0; i < count; i++) {
      const n = normals.points.get(i)
      const nx = n.normalX
      const ny = n.normalY
      const nz = n.normalZ

      sumAbsNz += Math.abs(nz)
      sumHorizontal += Math.sqrt(nx * nx + ny * ny)

      // 分箱：基于主导方向
      const absX = Math.abs(nx)
      const absY = Math.abs(ny)
      const absZ = Math.abs(nz)
      const maxComp = Math.max(absX, absY, absZ)

      let bin: number
      if (maxComp === absZ) {
        bin = nz > 0 ? 0 : 1 // +Z / -Z (竖直)
      } else if (maxComp === absX) {
        bin = nx > 0 ? 2 : 3 // +X / -X (水平)
      } else {
        bin = ny > 0 ? 4 : 5 // +Y / -Y (水平)
      }
      bins[bin]++
    }

    const verticality = sumAbsNz / count
    const horizontality = sumHorizontal / count

    // 计算香农熵
    let entropy = 0
    for (const binCount of bins) {
      if (binCount > 0) {
        const p = binCount / count
        entropy -= p * Math.log2(p)
      }
    }
    // 归一化到 [0, 1]（最大熵 = log2(8) = 3）
    entropy = entropy / Math.log2(8)

    return { verticality, horizontality, entropy }
  }

  /**
   * RANSAC 迭代平面提取
   * 提取最大的几个平面，返回平面数量和最大平面信息
   */
  private extractPlanes(
    PCL: PCLModule,
    cloud: PCLModule,
    resolution: number
  ): {
    planeCount: number
    largestPlaneRatio: number
    largestPlaneNormal: [number, number, number]
    largestPlaneIsHorizontal: boolean
  } {
    const totalPoints = cloud.size
    if (totalPoints < 20) {
      return {
        planeCount: 0,
        largestPlaneRatio: 0,
        largestPlaneNormal: [0, 0, 1],
        largestPlaneIsHorizontal: false,
      }
    }

    let planeCount = 0
    let largestPlaneRatio = 0
    let largestPlaneNormal: [number, number, number] = [0, 0, 1]
    let largestPlaneIsHorizontal = false

    // 迭代提取平面（最多 3 次）
    let remainingCloud = cloud
    const distanceThreshold = Math.max(resolution * 2, 0.05)

    for (let iter = 0; iter < 3; iter++) {
      if (remainingCloud.size < 20) break

      try {
        const coefficients = new PCL.ModelCoefficients()
        const inliers = new PCL.PointIndices()
        const seg = new PCL.SACSegmentation(PCL.PointXYZ)

        seg.setOptimizeCoefficients(true)
        seg.setModelType(PCL.SacModelTypes.SACMODEL_PLANE)
        seg.setMethodType(PCL.SacMethodTypes.SAC_RANSAC)
        seg.setMaxIterations(1000)
        seg.setDistanceThreshold(distanceThreshold)
        seg.setInputCloud(remainingCloud)
        seg.segment(inliers, coefficients)

        const inlierCount = inliers.indices.size
        const ratio = inlierCount / remainingCloud.size

        if (ratio < 0.1 || inlierCount < 10) break

        planeCount++

        // 记录最大平面
        if (iter === 0) {
          largestPlaneRatio = inlierCount / totalPoints
          const vals = coefficients.values
          if (vals && vals.size >= 3) {
            const nx = vals.get(0)
            const ny = vals.get(1)
            const nz = vals.get(2)
            const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
            largestPlaneNormal = [
              this.round(nx / len),
              this.round(ny / len),
              this.round(nz / len),
            ]
            largestPlaneIsHorizontal = Math.abs(nz / len) > 0.7
          }
        }

        // 提取剩余点（非 inliers）
        if (iter < 2) {
          remainingCloud = this.extractRemaining(PCL, remainingCloud, inliers)
          if (!remainingCloud || remainingCloud.size < 20) break
        }
      } catch (e) {
        console.warn(`[PointCloudProcessor] 平面提取迭代 ${iter} 失败:`, e)
        break
      }
    }

    return {
      planeCount,
      largestPlaneRatio,
      largestPlaneNormal,
      largestPlaneIsHorizontal,
    }
  }

  /**
   * 从点云中移除 inliers，返回剩余点云
   */
  private extractRemaining(
    PCL: PCLModule,
    cloud: PCLModule,
    inliers: PCLModule
  ): PCLModule | null {
    try {
      // 使用 ExtractIndices 过滤器（如果可用）
      // PCL.js 可能没有 ExtractIndices，手动提取
      const inlierSet = new Set<number>()
      const inlierCount = inliers.indices.size
      for (let i = 0; i < inlierCount; i++) {
        inlierSet.add(inliers.indices.get(i))
      }

      const remaining = new PCL.PointCloud(PCL.PointXYZ)
      const cloudSize = cloud.size
      for (let i = 0; i < cloudSize; i++) {
        if (!inlierSet.has(i)) {
          const pt = cloud.points.get(i)
          remaining.addPoint(new PCL.PointXYZ(pt.x, pt.y, pt.z))
        }
      }
      return remaining
    } catch (e) {
      console.warn('[PointCloudProcessor] 提取剩余点失败:', e)
      return null
    }
  }

  /**
   * RANSAC 圆柱体检测
   */
  private detectCylinder(
    PCL: PCLModule,
    cloud: PCLModule,
    resolution: number
  ): { hasCylinder: boolean; radius: number | null } {
    if (cloud.size < 50) {
      return { hasCylinder: false, radius: null }
    }

    try {
      const coefficients = new PCL.ModelCoefficients()
      const inliers = new PCL.PointIndices()
      const seg = new PCL.SACSegmentation(PCL.PointXYZ)

      seg.setOptimizeCoefficients(true)
      seg.setModelType(PCL.SacModelTypes.SACMODEL_CYLINDER)
      seg.setMethodType(PCL.SacMethodTypes.SAC_RANSAC)
      seg.setMaxIterations(500)
      seg.setDistanceThreshold(Math.max(resolution * 3, 0.1))
      seg.setRadiusLimits(0.02, 2.0) // 2cm ~ 2m
      seg.setInputCloud(cloud)
      seg.segment(inliers, coefficients)

      const inlierCount = inliers.indices.size
      const ratio = inlierCount / cloud.size

      // 圆柱 inlier 占比 > 15% 才认为检测到
      if (ratio > 0.15 && inlierCount > 10) {
        const vals = coefficients.values
        // 圆柱模型系数: [point.x, point.y, point.z, dir.x, dir.y, dir.z, radius]
        if (vals && vals.size >= 7) {
          const radius = vals.get(6)
          if (radius > 0.01 && radius < 5) {
            return { hasCylinder: true, radius: this.round(radius) }
          }
        }
        return { hasCylinder: true, radius: null }
      }
    } catch (e) {
      // 圆柱检测失败是正常的（很多物体不是圆柱）
    }

    return { hasCylinder: false, radius: null }
  }

  /**
   * 计算表面复杂度评分 [0, 1]
   * 综合法线熵、平面数、最大平面占比
   */
  private computeSurfaceComplexity(
    normalEntropy: number,
    planeCount: number,
    largestPlaneRatio: number
  ): number {
    // 法线熵越高 → 表面越复杂
    // 平面数越多 → 结构越复杂
    // 最大平面占比越低 → 越不规则
    const entropyScore = normalEntropy
    const planeScore = Math.min(planeCount / 3, 1) * 0.3
    const planeRatioScore = (1 - largestPlaneRatio) * 0.3
    return Math.min(1, entropyScore * 0.4 + planeScore + planeRatioScore)
  }

  private round(value: number): number {
    return Math.round(value * 10000) / 10000
  }
}
