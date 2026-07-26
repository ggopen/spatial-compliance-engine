/**
 * GeometryAnalyzer - 3D 几何形状分析器
 *
 * 核心能力：
 * 1. 从 BoundingInfo 和采样点云计算多维形状描述子
 * 2. 基于点云数据计算填充率（区分实心/空心/异形）
 * 3. 形状分类（box/cylinder/sphere/plane/line/pyramid/irregular）
 *
 * 形状描述子原理：
 * - linearity = e1/e2: 杆状物（杆、柱）趋近无穷大
 * - planarity  = e2/e3: 板状物（墙、围栏、路面）趋近无穷大
 * - scattering = e3/e1: 趋近1为立方体/球体，趋近0为扁平/细长
 * - sphericity: 三轴均匀程度 [0,1]
 * - fillFactor: 点云实际分布体积/包围盒体积，区分异形
 */
import type { BoundingInfo, ShapeDescriptor, ShapeCategory } from './types'

/** 三维采样点（局部 ENU 坐标，单位米） */
export interface SamplePoint {
  x: number
  y: number
  h: number
}

export class GeometryAnalyzer {
  /**
   * 分析几何特征，计算形状描述子
   * @param bbox 包围盒信息
   * @param points 采样点云（可选，用于计算填充率）
   */
  analyze(bbox: BoundingInfo, points?: SamplePoint[]): ShapeDescriptor {
    return this.calculateShapeDescriptor(bbox, points)
  }

  /**
   * 计算形状描述子 - 核心方法
   */
  calculateShapeDescriptor(bbox: BoundingInfo, points?: SamplePoint[]): ShapeDescriptor {
    const { width, length, height } = bbox

    // 三个主轴尺寸降序排列
    const dims = [length, width, height].sort((a, b) => b - a)
    const [e1, e2, e3] = dims

    // 防止除零
    const safeE2 = e2 > 1e-10 ? e2 : 1e-10
    const safeE3 = e3 > 1e-10 ? e3 : 1e-10
    const safeE1 = e1 > 1e-10 ? e1 : 1e-10

    // 线性度: e1/e2
    const linearity = this.round(e1 / safeE2)

    // 平面度: e2/e3
    const planarity = this.round(e2 / safeE3)

    // 散射度: e3/e1
    const scattering = this.round(e3 / safeE1)

    // 球度: 基于三轴均匀程度
    const meanExtent = (e1 + e2 + e3) / 3
    const variance =
      ((e1 - meanExtent) ** 2 + (e2 - meanExtent) ** 2 + (e3 - meanExtent) ** 2) / 3
    const stdDev = Math.sqrt(variance)
    const sphericity = this.round(
      meanExtent > 1e-10 ? Math.max(0, 1 - stdDev / meanExtent) : 0
    )

    // 填充率: 如果有点云数据则通过点云分布体积计算
    let fillFactor = 1.0
    if (points && points.length >= 4) {
      const bboxVolume = length * width * height
      if (bboxVolume > 1e-10) {
        fillFactor = this.calculateFillFactor(points, bboxVolume)
      }
    }

    // 宽高比: 水平最大 / 垂直高度
    const horizontalMax = Math.max(length, width)
    const vertical = height
    const aspectRatio = this.round(vertical > 1e-10 ? horizontalMax / vertical : 0)

    // 形状分类
    const category = this.classifyShape(linearity, planarity, scattering, sphericity, fillFactor)

    return {
      linearity,
      planarity,
      scattering,
      sphericity,
      fillFactor,
      aspectRatio,
      category,
    }
  }

  /**
   * 形状分类 - 基于多维描述子判定基础几何形状
   */
  classifyShape(
    linearity: number,
    planarity: number,
    scattering: number,
    sphericity: number,
    fillFactor: number
  ): ShapeCategory {
    // 线状: 非常细长，e1 >> e2
    if (linearity > 5) {
      return 'line'
    }

    // 平面: 非常扁平，e2 >> e3
    if (planarity > 5) {
      return 'plane'
    }

    // 散射度高 + 球度高 + 填充率高 → 立方体/球体
    if (scattering > 0.4 && sphericity > 0.6 && fillFactor > 0.7) {
      // 如果三轴接近相等且填充率高 → 倾向球体
      if (sphericity > 0.85 && fillFactor > 0.85) {
        return 'sphere'
      }
      return 'box'
    }

    // 散射度中等 + 填充率中等 → 圆柱体
    if (scattering > 0.2 && scattering < 0.5 && fillFactor > 0.5 && fillFactor < 0.85) {
      return 'cylinder'
    }

    // 填充率低 → 不规则/异形
    if (fillFactor < 0.5) {
      return 'irregular'
    }

    // 锥形/金字塔: 底部大顶部小，填充率在 0.3~0.6 之间
    if (fillFactor > 0.3 && fillFactor < 0.6 && sphericity < 0.5) {
      return 'pyramid'
    }

    // 默认归为不规则
    return 'irregular'
  }

  /**
   * 计算填充率 - 使用点云的分布范围体积 / BBox体积
   * 填充率越低说明对象越"异形"（如L型、T型、不规则曲面等）
   *
   * 算法：
   * 1. 计算点云在水平面上的凸包面积占比（ footprint ratio ）
   * 2. 计算高度方向的密度分布
   * 3. 综合两者估算填充率
   */
  calculateFillFactor(points: SamplePoint[], bboxVolume: number): number {
    if (points.length < 4 || bboxVolume < 1e-10) return 1.0

    try {
      // 方法1: 基于点云在XY平面的分布面积与包围盒底面积之比
      const footprintRatio = this.calculateFootprintRatio(points)

      // 方法2: 基于高度方向的点密度分布
      const heightDensity = this.calculateHeightDensity(points)

      // 综合填充率: footprint × heightDensity
      // footprint ratio 反映水平面上点云覆盖范围占BBox的比例
      // height density 反映垂直方向上点的分布均匀程度
      const fillFactor = Math.min(1, footprintRatio * (0.5 + 0.5 * heightDensity))

      return this.round(Math.max(0, Math.min(1, fillFactor)))
    } catch {
      return 1.0
    }
  }

  /**
   * 计算点云在水平面上的凸包面积 / BBox底面积
   * 用于判断对象是否为异形（如L型、T型等非凸形状）
   */
  private calculateFootprintRatio(points: SamplePoint[]): number {
    if (points.length < 3) return 1.0

    // 计算 XY 平面的范围
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    for (const p of points) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }
    const bboxArea = (maxX - minX) * (maxY - minY)
    if (bboxArea < 1e-10) return 1.0

    // 计算凸包面积（使用 Graham Scan）
    const hullArea = this.convexHullArea(points.map((p) => ({ x: p.x, y: p.y })))

    // footprint ratio = 凸包面积 / BBox面积
    // 对于完整矩形/正方形，此比值接近1
    // 对于L型、T型等异形，此比值明显小于1
    return Math.min(1, hullArea / bboxArea)
  }

  /**
   * 计算高度方向的点密度分布
   * 用于区分实心（均匀分布）和空心/异形（集中分布）
   */
  private calculateHeightDensity(points: SamplePoint[]): number {
    if (points.length < 4) return 1.0

    // 将高度方向分成10层，统计每层的点数
    let minH = Infinity,
      maxH = -Infinity
    for (const p of points) {
      if (p.h < minH) minH = p.h
      if (p.h > maxH) maxH = p.h
    }
    const range = maxH - minH
    if (range < 1e-10) return 1.0

    const bins = 10
    const binSize = range / bins
    const counts = new Array(bins).fill(0)
    for (const p of points) {
      const bin = Math.min(bins - 1, Math.floor((p.h - minH) / binSize))
      counts[bin]++
    }

    // 计算熵作为均匀性的度量
    const total = points.length
    let entropy = 0
    for (const c of counts) {
      if (c > 0) {
        const prob = c / total
        entropy -= prob * Math.log2(prob)
      }
    }
    // 最大熵 = log2(bins)
    const maxEntropy = Math.log2(bins)
    return maxEntropy > 0 ? entropy / maxEntropy : 1.0
  }

  /**
   * Graham Scan 凸包算法，返回凸包面积
   */
  private convexHullArea(points: Array<{ x: number; y: number }>): number {
    if (points.length < 3) return 0

    // 找最下方的点（y最小，y相同取x最小）
    let pivot = 0
    for (let i = 1; i < points.length; i++) {
      if (
        points[i].y < points[pivot].y ||
        (points[i].y === points[pivot].y && points[i].x < points[pivot].x)
      ) {
        pivot = i
      }
    }
    ;[points[0], points[pivot]] = [points[pivot], points[0]]

    const pivotPoint = points[0]

    // 按极角排序
    const sorted = points.slice(1).sort((a, b) => {
      const angleA = Math.atan2(a.y - pivotPoint.y, a.x - pivotPoint.x)
      const angleB = Math.atan2(b.y - pivotPoint.y, b.x - pivotPoint.x)
      if (angleA !== angleB) return angleA - angleB
      // 极角相同，距离近的在前
      const distA = (a.x - pivotPoint.x) ** 2 + (a.y - pivotPoint.y) ** 2
      const distB = (b.x - pivotPoint.x) ** 2 + (b.y - pivotPoint.y) ** 2
      return distA - distB
    })

    // Graham Scan
    const hull: Array<{ x: number; y: number }> = [pivotPoint]
    for (const p of sorted) {
      while (hull.length >= 2) {
        const a = hull[hull.length - 2]
        const b = hull[hull.length - 1]
        // 叉积 > 0 表示左转（逆时针），保留；<= 0 表示右转或共线，弹出
        const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
        if (cross <= 0) {
          hull.pop()
        } else {
          break
        }
      }
      hull.push(p)
    }

    // 用鞋带公式计算凸包面积
    let area = 0
    for (let i = 0; i < hull.length; i++) {
      const j = (i + 1) % hull.length
      area += hull[i].x * hull[j].y - hull[j].x * hull[i].y
    }
    return Math.abs(area / 2)
  }

  /**
   * 获取形状分类的中文标签
   */
  static shapeLabel(category: ShapeCategory): string {
    const labels: Record<ShapeCategory, string> = {
      box: '立方体',
      cylinder: '圆柱体',
      sphere: '球体',
      plane: '平面',
      line: '线状',
      pyramid: '锥体',
      irregular: '不规则',
    }
    return labels[category] || category
  }

  /** 四舍五入到小数点后4位 */
  private round(value: number): number {
    return Math.round(value * 10000) / 10000
  }
}
