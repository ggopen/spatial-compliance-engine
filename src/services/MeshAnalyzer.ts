/**
 * MeshAnalyzer — 基于 three.js + turf.js 的真实网格几何分析器
 *
 * 核心能力：
 * 1. 从顶点/三角形数据计算 OBB（有向包围盒）—— 3D PCA
 * 2. 计算凸包体积、表面积、紧凑度等 3D 形状特征
 * 3. 计算 2D 轮廓（投影到 XY 平面）的凸包、面积、周长、凹度
 * 4. 计算实心度 solidity = 凸包体积 / OBB体积 —— 异形物体的核心判据
 * 5. 基于 PCA 主成分方差比判定线状/板状/体状
 *
 * 这是解决"只能识别成立方体"问题的关键模块：
 * 原先仅靠高度采样的 width/length/height 猜测形状，
 * 现在用真实顶点数据计算精确的几何特征。
 */
import * as THREE from 'three'
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js'
import * as turf from '@turf/turf'
import type { MeshGeometry, MeshFeatures, BoundingInfo, ShapeDescriptor, ShapeCategory } from '../core/types'

export class MeshAnalyzer {
  /**
   * 分析网格几何，计算高级几何特征
   */
  analyze(mesh: MeshGeometry): MeshFeatures {
    const positions = mesh.positions
    if (positions.length < 9) {
      return this.emptyFeatures()
    }

    // 提取 THREE.Vector3 数组
    const vertices = this.extractVertices(mesh)

    // 1. 计算 3D 凸包
    const convexHull = this.computeConvexHull(vertices)
    const convexHullVolume = convexHull ? this.computeMeshVolume(convexHull) : 0
    const convexHullSurfaceArea = convexHull ? this.computeMeshSurfaceArea(convexHull) : 0

    // 2. 计算原始网格表面积
    const surfaceArea = this.computeMeshSurfaceAreaFromData(mesh)

    // 3. 计算 OBB（3D PCA）
    const obb = this.computeOBB(vertices)
    const obbVolume = obb.extents[0] * obb.extents[1] * obb.extents[2]

    // 4. 实心度 = 凸包体积 / OBB体积
    const solidity = obbVolume > 1e-10 ? Math.min(1, convexHullVolume / obbVolume) : 0

    // 5. 紧凑度 = 36π × V² / S³
    const compactness =
      convexHullSurfaceArea > 1e-10
        ? (36 * Math.PI * convexHullVolume * convexHullVolume) /
          (convexHullSurfaceArea * convexHullSurfaceArea * convexHullSurfaceArea)
        : 0

    // 6. 2D 轮廓分析（投影到 XY 平面）
    const footprint = this.analyzeFootprint(positions)

    // 7. PCA 主成分方差比
    const pcaStats = this.computePCAVarianceRatios(vertices)

    // 8. 判断是否为凸体
    const isConvex = solidity > 0.95

    return {
      convexHullVolume: this.round(convexHullVolume),
      surfaceArea: this.round(surfaceArea),
      convexHullSurfaceArea: this.round(convexHullSurfaceArea),
      compactness: this.round(compactness),
      footprintArea: this.round(footprint.area),
      footprintPerimeter: this.round(footprint.perimeter),
      footprintConvexity: this.round(footprint.convexity),
      obbExtents: [
        this.round(obb.extents[0]),
        this.round(obb.extents[1]),
        this.round(obb.extents[2]),
      ] as [number, number, number],
      obbVolume: this.round(obbVolume),
      solidity: this.round(solidity),
      linearity3D: this.round(pcaStats.linearity),
      planarity3D: this.round(pcaStats.planarity),
      isConvex,
    }
  }

  /**
   * 从网格数据提取顶点数组
   */
  private extractVertices(mesh: MeshGeometry): THREE.Vector3[] {
    const vertices: THREE.Vector3[] = []
    const positions = mesh.positions
    const count = mesh.vertexCount

    for (let i = 0; i < count; i++) {
      vertices.push(
        new THREE.Vector3(
          positions[i * 3],
          positions[i * 3 + 1],
          positions[i * 3 + 2]
        )
      )
    }
    return vertices
  }

  /**
   * 计算凸包几何体（使用 three.js ConvexGeometry）
   */
  private computeConvexHull(vertices: THREE.Vector3[]): THREE.BufferGeometry | null {
    if (vertices.length < 4) return null
    try {
      // ConvexGeometry 需要至少 4 个不共面的点
      const geometry = new ConvexGeometry(vertices)
      return geometry
    } catch {
      // 退化情况（共面点等）
      return null
    }
  }

  /**
   * 计算 BufferGeometry 的体积（基于有符号四面体体积）
   * 注意：three.js ConvexGeometry 的三角形可能不是全部同向的，
   * 因此取绝对值求和更可靠
   */
  private computeMeshVolume(geometry: THREE.BufferGeometry): number {
    const position = geometry.attributes.position
    if (!position) return 0

    const index = geometry.index
    let volume = 0
    const v0 = new THREE.Vector3()
    const v1 = new THREE.Vector3()
    const v2 = new THREE.Vector3()

    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i)
        const b = index.getX(i + 1)
        const c = index.getX(i + 2)
        v0.fromBufferAttribute(position, a)
        v1.fromBufferAttribute(position, b)
        v2.fromBufferAttribute(position, c)
        // 取绝对值避免正负相消
        volume += Math.abs(this.signedTetrahedronVolume(v0, v1, v2))
      }
    } else {
      for (let i = 0; i < position.count; i += 3) {
        v0.fromBufferAttribute(position, i)
        v1.fromBufferAttribute(position, i + 1)
        v2.fromBufferAttribute(position, i + 2)
        volume += Math.abs(this.signedTetrahedronVolume(v0, v1, v2))
      }
    }

    return volume
  }

  /**
   * 有符号四面体体积
   */
  private signedTetrahedronVolume(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3
  ): number {
    return a.dot(b.cross(c)) / 6
  }

  /**
   * 计算 BufferGeometry 的表面积
   */
  private computeMeshSurfaceArea(geometry: THREE.BufferGeometry): number {
    const position = geometry.attributes.position
    if (!position) return 0

    const index = geometry.index
    let area = 0
    const v0 = new THREE.Vector3()
    const v1 = new THREE.Vector3()
    const v2 = new THREE.Vector3()
    const ab = new THREE.Vector3()
    const ac = new THREE.Vector3()
    const cross = new THREE.Vector3()

    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i)
        const b = index.getX(i + 1)
        const c = index.getX(i + 2)
        v0.fromBufferAttribute(position, a)
        v1.fromBufferAttribute(position, b)
        v2.fromBufferAttribute(position, c)
        ab.subVectors(v1, v0)
        ac.subVectors(v2, v0)
        cross.crossVectors(ab, ac)
        area += cross.length() / 2
      }
    } else {
      for (let i = 0; i < position.count; i += 3) {
        v0.fromBufferAttribute(position, i)
        v1.fromBufferAttribute(position, i + 1)
        v2.fromBufferAttribute(position, i + 2)
        ab.subVectors(v1, v0)
        ac.subVectors(v2, v0)
        cross.crossVectors(ab, ac)
        area += cross.length() / 2
      }
    }

    return area
  }

  /**
   * 从原始顶点/索引数据计算表面积
   */
  private computeMeshSurfaceAreaFromData(mesh: MeshGeometry): number {
    const positions = mesh.positions
    let area = 0
    const v0 = new THREE.Vector3()
    const v1 = new THREE.Vector3()
    const v2 = new THREE.Vector3()
    const ab = new THREE.Vector3()
    const ac = new THREE.Vector3()
    const cross = new THREE.Vector3()

    if (mesh.indices && mesh.indices.length > 0) {
      const indices = mesh.indices
      for (let i = 0; i < indices.length; i += 3) {
        const a = indices[i] * 3
        const b = indices[i + 1] * 3
        const c = indices[i + 2] * 3
        v0.set(positions[a], positions[a + 1], positions[a + 2])
        v1.set(positions[b], positions[b + 1], positions[b + 2])
        v2.set(positions[c], positions[c + 1], positions[c + 2])
        ab.subVectors(v1, v0)
        ac.subVectors(v2, v0)
        cross.crossVectors(ab, ac)
        area += cross.length() / 2
      }
    } else {
      // 无索引，每3个顶点一个三角形
      for (let i = 0; i < positions.length; i += 9) {
        v0.set(positions[i], positions[i + 1], positions[i + 2])
        v1.set(positions[i + 3], positions[i + 4], positions[i + 5])
        v2.set(positions[i + 6], positions[i + 7], positions[i + 8])
        ab.subVectors(v1, v0)
        ac.subVectors(v2, v0)
        cross.crossVectors(ab, ac)
        area += cross.length() / 2
      }
    }

    return area
  }

  /**
   * 计算 3D OBB（有向包围盒）—— 基于 PCA
   * 返回三个主轴方向上的半轴长度（降序）
   */
  private computeOBB(vertices: THREE.Vector3[]): {
    extents: [number, number, number]
    axes: THREE.Vector3[]
    center: THREE.Vector3
  } {
    // 计算质心
    const center = new THREE.Vector3()
    for (const v of vertices) center.add(v)
    center.divideScalar(vertices.length)

    // 构建协方差矩阵
    const cov = new THREE.Matrix3()
    let cxx = 0, cyy = 0, czz = 0, cxy = 0, cxz = 0, cyz = 0

    for (const v of vertices) {
      const dx = v.x - center.x
      const dy = v.y - center.y
      const dz = v.z - center.z
      cxx += dx * dx
      cyy += dy * dy
      czz += dz * dz
      cxy += dx * dy
      cxz += dx * dz
      cyz += dy * dz
    }

    const n = vertices.length
    cxx /= n; cyy /= n; czz /= n
    cxy /= n; cxz /= n; cyz /= n

    cov.set(
      cxx, cxy, cxz,
      cxy, cyy, cyz,
      cxz, cyz, czz
    )

    // 使用解析特征值分解（适用于 3×3 对称矩阵）
    // 幂迭代法在特征值重复时（如立方体）会退化，因此使用解析方法
    const eigen = this.eigenDecomposition3x3Symmetric(cov)
    const axes = eigen.vectors
    // 确保右手坐标系
    if (axes[0].dot(new THREE.Vector3().crossVectors(axes[1], axes[2])) < 0) {
      axes[2].negate()
    }

    // 将顶点投影到主轴上，计算各轴范围
    const extents: [number, number, number] = [0, 0, 0]
    for (let i = 0; i < 3; i++) {
      let minProj = Infinity
      let maxProj = -Infinity
      for (const v of vertices) {
        const proj = v.clone().sub(center).dot(axes[i])
        if (proj < minProj) minProj = proj
        if (proj > maxProj) maxProj = proj
      }
      extents[i] = maxProj - minProj
    }

    // 降序排列
    const indexed = extents.map((e, i) => ({ e, i }))
    indexed.sort((a, b) => b.e - a.e)
    const sortedExtents = indexed.map((x) => x.e) as [number, number, number]
    const sortedAxes = indexed.map((x) => axes[x.i])

    return { extents: sortedExtents, axes: sortedAxes, center }
  }

  /**
   * 3×3 对称矩阵的解析特征值分解
   * 基于 Cardano 公式和向量叉积构造特征向量
   * 相比幂迭代法，能正确处理重复特征值（如立方体的协方差矩阵）
   *
   * 参考：Smith, O.K. (1961). "Eigenvalues of a symmetric 3 × 3 matrix."
   * Communications of the ACM, 4(4), 168.
   */
  private eigenDecomposition3x3Symmetric(matrix: THREE.Matrix3): {
    values: [number, number, number]
    vectors: THREE.Vector3[]
  } {
    // THREE.Matrix3 以列主序存储
    // elements = [m00, m10, m20, m01, m11, m21, m02, m12, m22]
    const e = matrix.elements
    const m11 = e[0], m12 = e[3], m13 = e[6]
    const m22 = e[4], m23 = e[7]
    const m33 = e[8]

    const p1 = m12 * m12 + m13 * m13 + m23 * m23
    // 球形协方差（各向同性），返回标准正交基
    if (p1 < 1e-14) {
      return {
        values: [m11, m22, m33],
        vectors: [
          new THREE.Vector3(1, 0, 0),
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(0, 0, 1),
        ],
      }
    }

    const q = (m11 + m22 + m33) / 3
    const p2 = (m11 - q) ** 2 + (m22 - q) ** 2 + (m33 - q) ** 2 + 2 * p1
    const p = Math.sqrt(p2 / 6)

    // B = (1/p) * (A - q*I)
    const b11 = (m11 - q) / p
    const b22 = (m22 - q) / p
    const b33 = (m33 - q) / p
    const b12 = m12 / p
    const b13 = m13 / p
    const b23 = m23 / p

    // det(B)
    const detB =
      b11 * (b22 * b33 - b23 * b23) -
      b12 * (b12 * b33 - b23 * b13) +
      b13 * (b12 * b23 - b22 * b13)
    const r = Math.max(-1, Math.min(1, detB / 2))

    // 特征值
    const phi = Math.acos(r) / 3
    const eig1 = q + 2 * p * Math.cos(phi)
    const eig3 = q + 2 * p * Math.cos(phi + (2 * Math.PI) / 3)
    const eig2 = 3 * q - eig1 - eig3

    // 特征向量：对每个特征值 λ，求解 (A - λI) v = 0
    // 用 (A-λI) 的两行叉积得到特征向量
    const eigenvectors: THREE.Vector3[] = []
    for (const lambda of [eig1, eig2, eig3]) {
      const row0 = new THREE.Vector3(m11 - lambda, m12, m13)
      const row1 = new THREE.Vector3(m12, m22 - lambda, m23)
      const row2 = new THREE.Vector3(m13, m23, m33 - lambda)

      // 取两个最大范数的行做叉积，数值更稳定
      const r0 = row0.lengthSq()
      const r1 = row1.lengthSq()
      const r2 = row2.lengthSq()
      let v: THREE.Vector3
      if (r0 > 1e-14 || r1 > 1e-14) {
        if (r0 >= r1) v = new THREE.Vector3().crossVectors(row0, row1)
        else v = new THREE.Vector3().crossVectors(row1, row0)
      } else {
        v = new THREE.Vector3(1, 0, 0)
      }

      const len = v.length()
      if (len < 1e-14) {
        // 退化情况：尝试其他行叉积
        if (r1 > 1e-14 || r2 > 1e-14) {
          v = new THREE.Vector3().crossVectors(row1, row2)
        } else {
          v = new THREE.Vector3().crossVectors(row0, row2)
        }
        const len2 = v.length()
        if (len2 < 1e-14) {
          v = new THREE.Vector3(1, 0, 0)
        } else {
          v.divideScalar(len2)
        }
      } else {
        v.divideScalar(len)
      }
      eigenvectors.push(v)
    }

    return {
      values: [eig1, eig2, eig3],
      vectors: eigenvectors,
    }
  }

  /**
   * 计算 PCA 主成分方差比
   * linearity = λ₁ / (λ₁+λ₂+λ₃) — 越大越线状
   * planarity = (λ₁+λ₂) / (λ₁+λ₂+λ₃) — 趋近1为板状
   */
  private computePCAVarianceRatios(vertices: THREE.Vector3[]): {
    linearity: number
    planarity: number
  } {
    const center = new THREE.Vector3()
    for (const v of vertices) center.add(v)
    center.divideScalar(vertices.length)

    const cov = new THREE.Matrix3()
    let cxx = 0, cyy = 0, czz = 0, cxy = 0, cxz = 0, cyz = 0
    for (const v of vertices) {
      const dx = v.x - center.x
      const dy = v.y - center.y
      const dz = v.z - center.z
      cxx += dx * dx
      cyy += dy * dy
      czz += dz * dz
      cxy += dx * dy
      cxz += dx * dz
      cyz += dy * dz
    }
    const n = vertices.length
    cov.set(
      cxx / n, cxy / n, cxz / n,
      cxy / n, cyy / n, cyz / n,
      cxz / n, cyz / n, czz / n
    )

    // 用解析特征值分解获取特征值（正确处理重复特征值）
    const eigen = this.eigenDecomposition3x3Symmetric(cov)

    // 取绝对值并降序排列
    const absVals = eigen.values.map((e) => Math.abs(e)).sort((a, b) => b - a)
    const sum = absVals[0] + absVals[1] + absVals[2]
    if (sum < 1e-15) return { linearity: 0, planarity: 0 }

    return {
      linearity: absVals[0] / sum,
      planarity: (absVals[0] + absVals[1]) / sum,
    }
  }

  /**
   * 分析 2D 轮廓（投影到 XY 平面）
   * 使用 turf.js 计算凸包、面积、周长、凹度
   */
  private analyzeFootprint(positions: Float32Array): {
    area: number
    perimeter: number
    convexity: number
  } {
    // 收集所有 (x, y) 点
    const points: Array<[number, number]> = []
    const count = positions.length / 3
    for (let i = 0; i < count; i++) {
      points.push([positions[i * 3], positions[i * 3 + 1]])
    }

    if (points.length < 3) {
      return { area: 0, perimeter: 0, convexity: 0 }
    }

    // 使用 turf.js 计算
    try {
      // 创建 GeoJSON 点集
      const turfPoints = points.map((p) => turf.point([p[0], p[1]]))
      const fc = turf.featureCollection(turfPoints)

      // 计算凸包
      const hull = turf.convex(fc)
      if (!hull || hull.geometry.type !== 'Polygon') {
        return { area: 0, perimeter: 0, convexity: 0 }
      }

      // 凸包面积
      const hullArea = turf.area(hull)

      // 凸包周长
      const hullPerimeter = this.polygonPerimeter(hull)

      // 计算实际轮廓面积（用 ConvexGeometry 的投影或用 turf 的 tin）
      // 简化：使用凸包面积作为上界，实际面积用顶点三角剖分估算
      const actualArea = this.estimateFootprintArea(points)

      // 凹度 = 1 - 实际面积 / 凸包面积
      const convexity =
        hullArea > 1e-10 ? 1 - actualArea / hullArea : 0

      return {
        area: actualArea,
        perimeter: hullPerimeter,
        convexity: Math.max(0, convexity),
      }
    } catch {
      // turf 计算失败，降级到简单估算
      const actualArea = this.estimateFootprintArea(points)
      return { area: actualArea, perimeter: 0, convexity: 0 }
    }
  }

  /**
   * 估算 2D 点集的面积（Shoelace 公式，需要有序顶点）
   * 对于无序点，用凸包面积作为上界估算
   */
  private estimateFootprintArea(points: Array<[number, number]>): number {
    if (points.length < 3) return 0

    // 计算质心
    let cx = 0, cy = 0
    for (const p of points) {
      cx += p[0]
      cy += p[1]
    }
    cx /= points.length
    cy /= points.length

    // 按极角排序
    const sorted = points
      .map((p) => ({ x: p[0], y: p[1], angle: Math.atan2(p[1] - cy, p[0] - cx) }))
      .sort((a, b) => a.angle - b.angle)

    // Shoelace 公式
    let area = 0
    for (let i = 0; i < sorted.length; i++) {
      const j = (i + 1) % sorted.length
      area += sorted[i].x * sorted[j].y - sorted[j].x * sorted[i].y
    }

    return Math.abs(area / 2)
  }

  /**
   * 计算 turf 多边形的周长
   */
  private polygonPerimeter(polygon: ReturnType<typeof turf.convex>): number {
    if (!polygon || polygon.geometry.type !== 'Polygon') return 0
    const coords = (polygon.geometry as { coordinates: number[][][] }).coordinates[0]
    let perimeter = 0
    for (let i = 0; i < coords.length - 1; i++) {
      const [x1, y1] = coords[i]
      const [x2, y2] = coords[i + 1]
      perimeter += Math.hypot(x2 - x1, y2 - y1)
    }
    return perimeter
  }

  /**
   * 基于 MeshFeatures 计算增强的 ShapeDescriptor
   * 将真实网格特征融合到形状描述子中
   */
  computeEnhancedShapeDescriptor(
    bbox: BoundingInfo,
    meshFeatures?: MeshFeatures
  ): ShapeDescriptor {
    if (!meshFeatures) {
      // 降级：无网格数据时用旧逻辑
      const dims = [bbox.length, bbox.width, bbox.height].sort((a, b) => b - a)
      const [e1, e2, e3] = dims
      const safeE2 = e2 > 1e-10 ? e2 : 1e-10
      const safeE3 = e3 > 1e-10 ? e3 : 1e-10
      const safeE1 = e1 > 1e-10 ? e1 : 1e-10
      const linearity = e1 / safeE2
      const planarity = e2 / safeE3
      const scattering = e3 / safeE1
      const meanExtent = (e1 + e2 + e3) / 3
      const variance = ((e1 - meanExtent) ** 2 + (e2 - meanExtent) ** 2 + (e3 - meanExtent) ** 2) / 3
      const sphericity = meanExtent > 1e-10 ? Math.max(0, 1 - Math.sqrt(variance) / meanExtent) : 0
      const fillFactor = 1.0
      const aspectRatio = bbox.height > 1e-10 ? Math.max(bbox.length, bbox.width) / bbox.height : 0

      return {
        linearity: this.round(linearity),
        planarity: this.round(planarity),
        scattering: this.round(scattering),
        sphericity: this.round(sphericity),
        fillFactor: this.round(fillFactor),
        aspectRatio: this.round(aspectRatio),
        category: this.classifyShape(linearity, planarity, scattering, sphericity, fillFactor),
      }
    }

    // 使用真实网格特征
    const [e1, e2, e3] = meshFeatures.obbExtents
    const safeE2 = e2 > 1e-10 ? e2 : 1e-10
    const safeE3 = e3 > 1e-10 ? e3 : 1e-10
    const safeE1 = e1 > 1e-10 ? e1 : 1e-10

    const linearity = e1 / safeE2
    const planarity = e2 / safeE3
    const scattering = e3 / safeE1

    // 球度用紧凑度近似
    const sphericity = meshFeatures.compactness

    // 填充率用实心度
    const fillFactor = meshFeatures.solidity

    // 宽高比
    const horizontalMax = Math.max(e1, e2)
    const aspectRatio = e3 > 1e-10 ? horizontalMax / e3 : 0

    const category = this.classifyShapeEnhanced(
      linearity,
      planarity,
      scattering,
      sphericity,
      fillFactor,
      meshFeatures.linearity3D,
      meshFeatures.planarity3D,
      meshFeatures.footprintConvexity
    )

    return {
      linearity: this.round(linearity),
      planarity: this.round(planarity),
      scattering: this.round(scattering),
      sphericity: this.round(sphericity),
      fillFactor: this.round(fillFactor),
      aspectRatio: this.round(aspectRatio),
      category,
    }
  }

  /**
   * 形状分类（基础版，用于降级）
   */
  private classifyShape(
    linearity: number,
    planarity: number,
    scattering: number,
    sphericity: number,
    fillFactor: number
  ): ShapeCategory {
    if (linearity > 5) return 'line'
    if (planarity > 5) return 'plane'
    if (scattering > 0.4 && sphericity > 0.6 && fillFactor > 0.7) {
      if (sphericity > 0.85 && fillFactor > 0.85) return 'sphere'
      return 'box'
    }
    if (scattering > 0.2 && scattering < 0.5 && fillFactor > 0.5 && fillFactor < 0.85) return 'cylinder'
    if (fillFactor < 0.5) return 'irregular'
    if (fillFactor > 0.3 && fillFactor < 0.6 && sphericity < 0.5) return 'pyramid'
    return 'irregular'
  }

  /**
   * 增强形状分类（使用真实网格特征）
   * 关键改进：用 3D PCA 方差比和轮廓凹度做更精确的分类
   */
  private classifyShapeEnhanced(
    linearity: number,
    planarity: number,
    scattering: number,
    sphericity: number,
    fillFactor: number,
    linearity3D: number,
    planarity3D: number,
    footprintConvexity: number
  ): ShapeCategory {
    // 使用 3D PCA 做更可靠的判定
    // linearity3D = λ₁/(λ₁+λ₂+λ₃)，阈值 ~0.8 表示明显线状
    if (linearity3D > 0.8) return 'line'

    // planarity3D = (λ₁+λ₂)/(λ₁+λ₂+λ₃)，阈值 ~0.9 表示明显板状
    if (planarity3D > 0.9 && linearity3D < 0.6) return 'plane'

    // 轮廓凹度高 → 不规则
    if (footprintConvexity > 0.3) return 'irregular'

    // 实心度低 → 不规则
    if (fillFactor < 0.5) return 'irregular'

    // 散射度高 + 球度高 + 实心度高 → 立方体/球体
    if (scattering > 0.4 && sphericity > 0.5 && fillFactor > 0.7) {
      if (sphericity > 0.8 && fillFactor > 0.85) return 'sphere'
      return 'box'
    }

    // 散射度中等 + 实心度中等 → 圆柱体
    if (scattering > 0.2 && scattering < 0.5 && fillFactor > 0.5 && fillFactor < 0.85) {
      return 'cylinder'
    }

    // 锥形
    if (fillFactor > 0.25 && fillFactor < 0.6 && sphericity < 0.5) return 'pyramid'

    return 'irregular'
  }

  private emptyFeatures(): MeshFeatures {
    return {
      convexHullVolume: 0,
      surfaceArea: 0,
      convexHullSurfaceArea: 0,
      compactness: 0,
      footprintArea: 0,
      footprintPerimeter: 0,
      footprintConvexity: 0,
      obbExtents: [0, 0, 0],
      obbVolume: 0,
      solidity: 0,
      linearity3D: 0,
      planarity3D: 0,
      isConvex: false,
    }
  }

  private round(value: number): number {
    return Math.round(value * 10000) / 10000
  }
}
