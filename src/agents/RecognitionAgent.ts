/**
 * Agent 1: Object Recognition Agent（对象识别）
 *
 * 核心改进：多维特征评分 + 高斯隶属函数模糊匹配 + 形状分类
 *
 * 原先仅用 height/width/length 硬阈值判断，无法处理异形对象。
 * 现在使用 7 维特征评分：
 *   1. 尺寸匹配（height/width/length 模糊匹配）
 *   2. 形状分类匹配（box/cylinder/sphere/plane/line/pyramid/irregular）
 *   3. 线性度匹配（杆状物 e1/e2 趋近无穷大）
 *   4. 平面度匹配（板状物 e2/e3 趋近无穷大）
 *   5. 散射度匹配（立方体 e3/e1 趋近1）
 *   6. 填充率匹配（异形对象 fillFactor 偏低）
 *   7. 宽高比匹配
 *
 * 每种对象类型有独立的权重配置，最终给出置信度 + 候选列表 + 识别理由。
 */
import type { BoundingInfo, MeshFeatures, ObjectType, ShapeCategory, ShapeDescriptor } from '../core/types'

export interface RecognitionResult {
  type: ObjectType
  confidence: number
  /** 候选类型列表（按置信度降序） */
  alternatives: Array<{ type: ObjectType; confidence: number }>
  /** 识别理由 */
  reasons: string[]
}

/** 对象识别模板 */
interface ObjectTemplate {
  type: ObjectType
  heightRange: [number, number]
  widthRange?: [number, number]
  lengthRange?: [number, number]
  expectedShapes?: ShapeCategory[]
  linearityRange?: [number, number]
  planarityRange?: [number, number]
  scatteringRange?: [number, number]
  fillFactorRange?: [number, number]
  aspectRatioRange?: [number, number]
  description: string
  weights: {
    size: number
    shape: number
    linearity: number
    planarity: number
    scattering: number
    fillFactor: number
    aspectRatio: number
  }
}

export class RecognitionAgent {
  private templates: Map<ObjectType, ObjectTemplate> = new Map()

  constructor() {
    this.initTemplates()
  }

  /** 初始化对象识别模板 */
  private initTemplates(): void {
    // 门：竖直板状，高1.8~3m，宽0.4~2m，薄
    this.templates.set('door', {
      type: 'door',
      heightRange: [1.8, 3.0],
      widthRange: [0.4, 2.0],
      lengthRange: [0.05, 0.4],
      expectedShapes: ['plane', 'box'],
      planarityRange: [2, 50],
      fillFactorRange: [0.6, 1.0],
      aspectRatioRange: [0.2, 1.5],
      description: '门：竖直薄板状结构',
      weights: { size: 0.3, shape: 0.15, linearity: 0.05, planarity: 0.2, scattering: 0.05, fillFactor: 0.1, aspectRatio: 0.15 },
    })

    // 窗：薄板状，尺寸较小，高度通常低于门
    this.templates.set('window', {
      type: 'window',
      heightRange: [0.3, 1.8],
      widthRange: [0.4, 3.0],
      lengthRange: [0.05, 0.4],
      expectedShapes: ['plane', 'box'],
      planarityRange: [2, 50],
      fillFactorRange: [0.3, 1.0],
      aspectRatioRange: [0.3, 3.0],
      description: '窗：薄板状结构，尺寸较小',
      weights: { size: 0.25, shape: 0.15, linearity: 0.05, planarity: 0.2, scattering: 0.05, fillFactor: 0.15, aspectRatio: 0.15 },
    })

    // 建筑：大型立体结构
    this.templates.set('building', {
      type: 'building',
      heightRange: [2, 500],
      widthRange: [2, 200],
      expectedShapes: ['box', 'irregular', 'cylinder', 'pyramid'],
      scatteringRange: [0.1, 1.0],
      fillFactorRange: [0.3, 1.0],
      aspectRatioRange: [0.1, 10],
      description: '建筑：大型立体结构',
      weights: { size: 0.35, shape: 0.15, linearity: 0.05, planarity: 0.05, scattering: 0.1, fillFactor: 0.1, aspectRatio: 0.2 },
    })

    // 围栏：薄长平面
    this.templates.set('fence', {
      type: 'fence',
      heightRange: [0.5, 4],
      widthRange: [2, 100],
      lengthRange: [0.02, 0.3],
      expectedShapes: ['plane', 'line'],
      planarityRange: [3, 100],
      linearityRange: [1.5, 100],
      fillFactorRange: [0.2, 0.8],
      aspectRatioRange: [0.5, 50],
      description: '围栏：薄长平面结构',
      weights: { size: 0.2, shape: 0.15, linearity: 0.1, planarity: 0.25, scattering: 0.05, fillFactor: 0.1, aspectRatio: 0.15 },
    })

    // 杆：细长线状
    this.templates.set('pole', {
      type: 'pole',
      heightRange: [2, 60],
      widthRange: [0.05, 0.8],
      expectedShapes: ['line', 'cylinder'],
      linearityRange: [3, 1000],
      scatteringRange: [0, 0.3],
      fillFactorRange: [0.3, 1.0],
      aspectRatioRange: [0.01, 0.3],
      description: '杆：细长竖直结构',
      weights: { size: 0.25, shape: 0.2, linearity: 0.25, planarity: 0.05, scattering: 0.1, fillFactor: 0.05, aspectRatio: 0.1 },
    })

    // 树：不规则或球状
    this.templates.set('tree', {
      type: 'tree',
      heightRange: [1, 40],
      widthRange: [0.5, 15],
      expectedShapes: ['irregular', 'sphere', 'cylinder'],
      scatteringRange: [0.2, 1.0],
      fillFactorRange: [0.1, 0.6],
      aspectRatioRange: [0.2, 5],
      description: '树：不规则或球状结构',
      weights: { size: 0.25, shape: 0.25, linearity: 0.05, planarity: 0.05, scattering: 0.1, fillFactor: 0.2, aspectRatio: 0.1 },
    })

    // 道路：水平薄平面
    this.templates.set('road', {
      type: 'road',
      heightRange: [0, 0.5],
      widthRange: [2, 50],
      lengthRange: [10, 10000],
      expectedShapes: ['plane'],
      planarityRange: [10, 10000],
      linearityRange: [1, 1000],
      fillFactorRange: [0.7, 1.0],
      aspectRatioRange: [5, 10000],
      description: '道路：水平薄平面结构',
      weights: { size: 0.15, shape: 0.2, linearity: 0.15, planarity: 0.25, scattering: 0.05, fillFactor: 0.05, aspectRatio: 0.15 },
    })

    // 地面：水平面
    this.templates.set('ground', {
      type: 'ground',
      heightRange: [0, 0.3],
      widthRange: [1, 10000],
      expectedShapes: ['plane'],
      planarityRange: [5, 10000],
      fillFactorRange: [0.8, 1.0],
      aspectRatioRange: [1, 10000],
      description: '地面：水平平面',
      weights: { size: 0.2, shape: 0.25, linearity: 0.05, planarity: 0.2, scattering: 0.05, fillFactor: 0.1, aspectRatio: 0.15 },
    })
  }

  /**
   * 识别对象类型 - 多维特征评分
   * @param bbox 包围盒信息（含形状描述子和可选的真实网格特征）
   */
  classify(bbox: BoundingInfo): RecognitionResult {
    const shape = bbox.shape
    const meshFeatures = bbox.meshFeatures
    const { width, length, height } = bbox
    const thin = Math.min(width, length)
    const long = Math.max(width, length)

    const candidates: Array<{ type: ObjectType; confidence: number; reasons: string[] }> = []

    // 遍历所有模板进行评分
    this.templates.forEach((template) => {
      const scores = this.scoreTemplate(template, height, long, thin, shape, meshFeatures)
      if (scores.total > 0.1) {
        candidates.push({
          type: template.type,
          confidence: Math.min(scores.total, 0.99),
          reasons: scores.reasons,
        })
      }
    })

    // 按置信度排序
    candidates.sort((a, b) => b.confidence - a.confidence)

    if (candidates.length === 0) {
      return {
        type: 'unknown',
        confidence: 0.3,
        alternatives: [],
        reasons: ['无匹配模板，对象可能为未知类型'],
      }
    }

    // 如果有 Batch Table 属性中的类型信息，提升对应类型的置信度
    const batchProps = bbox.batchProperties
    if (batchProps) {
      const batchType = this.inferTypeFromBatchProperties(batchProps)
      if (batchType) {
        const batchCandidate = candidates.find((c) => c.type === batchType)
        if (batchCandidate) {
          batchCandidate.confidence = Math.min(0.99, batchCandidate.confidence + 0.2)
          batchCandidate.reasons.unshift(`Batch Table 属性匹配: ${batchType}`)
        }
      }
    }

    return {
      type: candidates[0].type,
      confidence: candidates[0].confidence,
      alternatives: candidates.slice(1, 4).map((c) => ({
        type: c.type,
        confidence: c.confidence,
      })),
      reasons: candidates[0].reasons,
    }
  }

  /** 从 Batch Table 属性推断对象类型 */
  private inferTypeFromBatchProperties(props: Record<string, unknown>): ObjectType | null {
    const checkValue = (val: unknown): string => {
      if (typeof val === 'string') return val.toLowerCase()
      return String(val ?? '').toLowerCase()
    }

    for (const key of Object.keys(props)) {
      const val = checkValue(props[key])
      if (val.includes('door') || val.includes('门')) return 'door'
      if (val.includes('window') || val.includes('窗')) return 'window'
      if (val.includes('building') || val.includes('建筑') || val.includes('楼')) return 'building'
      if (val.includes('fence') || val.includes('围栏') || val.includes('墙')) return 'fence'
      if (val.includes('pole') || val.includes('杆') || val.includes('柱')) return 'pole'
      if (val.includes('road') || val.includes('路') || val.includes('道')) return 'road'
      if (val.includes('tree') || val.includes('树')) return 'tree'
    }
    return null
  }

  /** 对单个模板进行多维评分 */
  private scoreTemplate(
    template: ObjectTemplate,
    height: number,
    long: number,
    thin: number,
    shape?: ShapeDescriptor,
    meshFeatures?: MeshFeatures
  ): { total: number; reasons: string[] } {
    const w = template.weights
    let totalScore = 0
    const reasons: string[] = []

    // 1. 尺寸匹配（使用模糊隶属函数）
    const heightScore = this.fuzzyMatch(height, template.heightRange)
    const widthScore = template.widthRange ? this.fuzzyMatch(long, template.widthRange) : 0.5
    const lengthScore = template.lengthRange ? this.fuzzyMatch(thin, template.lengthRange) : 0.5
    const sizeScore = heightScore * 0.4 + widthScore * 0.4 + lengthScore * 0.2
    totalScore += sizeScore * w.size
    if (sizeScore > 0.6) reasons.push(`尺寸匹配度高(${(sizeScore * 100).toFixed(0)}%)`)

    // 如果没有形状描述子，仅用尺寸评分（兼容旧数据）
    if (!shape) {
      return { total: totalScore, reasons }
    }

    // 2. 形状分类匹配
    let shapeScore = 0.3
    if (template.expectedShapes && template.expectedShapes.includes(shape.category)) {
      shapeScore = 1.0
      reasons.push(`形状分类匹配: ${shape.category}`)
    } else if (template.expectedShapes) {
      for (const expected of template.expectedShapes) {
        if (this.isShapeSimilar(shape.category, expected)) {
          shapeScore = 0.6
          reasons.push(`形状近似匹配: ${shape.category} ≈ ${expected}`)
          break
        }
      }
    }
    totalScore += shapeScore * w.shape

    // 3. 线性度匹配
    if (template.linearityRange) {
      const linearityScore = this.fuzzyMatch(shape.linearity, template.linearityRange)
      totalScore += linearityScore * w.linearity
      if (linearityScore > 0.7) reasons.push(`线性度匹配: ${shape.linearity.toFixed(2)}`)
    }

    // 4. 平面度匹配
    if (template.planarityRange) {
      const planarityScore = this.fuzzyMatch(shape.planarity, template.planarityRange)
      totalScore += planarityScore * w.planarity
      if (planarityScore > 0.7) reasons.push(`平面度匹配: ${shape.planarity.toFixed(2)}`)
    }

    // 5. 散射度匹配
    if (template.scatteringRange) {
      const scatteringScore = this.fuzzyMatch(shape.scattering, template.scatteringRange)
      totalScore += scatteringScore * w.scattering
      if (scatteringScore > 0.7) reasons.push(`散射度匹配: ${shape.scattering.toFixed(2)}`)
    }

    // 6. 填充率匹配 - 关键的异形判断指标
    if (template.fillFactorRange) {
      const fillScore = this.fuzzyMatch(shape.fillFactor, template.fillFactorRange)
      totalScore += fillScore * w.fillFactor
      if (fillScore > 0.7) {
        reasons.push(`填充率匹配: ${shape.fillFactor.toFixed(2)}`)
      } else if (fillScore < 0.3 && shape.fillFactor < 0.5) {
        reasons.push(`对象为异形(填充率${shape.fillFactor.toFixed(2)})`)
      }
    }

    // 7. 宽高比匹配
    if (template.aspectRatioRange) {
      const aspectScore = this.fuzzyMatch(shape.aspectRatio, template.aspectRatioRange)
      totalScore += aspectScore * w.aspectRatio
      if (aspectScore > 0.7) reasons.push(`宽高比匹配: ${shape.aspectRatio.toFixed(2)}`)
    }

    // 8. 真实网格特征增强评分（如果可用）
    if (meshFeatures) {
      // 实心度：低实心度 → 异形对象
      // 对期望"规则"形状的模板（box/sphere/cylinder）施加惩罚
      // 对期望"不规则"形状的模板（irregular/tree）施加奖励
      if (meshFeatures.solidity < 0.5) {
        reasons.push(`实心度低(${meshFeatures.solidity.toFixed(2)})→异形对象`)
        // 惩罚期望规则形状的模板
        if (template.expectedShapes?.some((s) => ['box', 'sphere', 'cylinder'].includes(s)) &&
            !template.expectedShapes.includes('irregular')) {
          totalScore -= 0.15
          reasons.push(`低实心度与${template.type}的规则形状期望不符`)
        }
        // 奖励期望不规则形状的模板
        if (template.expectedShapes?.includes('irregular')) {
          totalScore += 0.1
          reasons.push(`低实心度与${template.type}的不规则形状期望一致`)
        }
      } else if (meshFeatures.solidity > 0.85) {
        // 高实心度 → 规则形状，惩罚期望不规则的模板
        if (template.expectedShapes?.includes('irregular') &&
            !template.expectedShapes.some((s) => ['box', 'sphere', 'cylinder'].includes(s))) {
          totalScore -= 0.1
          reasons.push(`高实心度与${template.type}的不规则形状期望不符`)
        }
      }

      // 3D PCA 线性度
      if (meshFeatures.linearity3D > 0.8 && template.expectedShapes?.includes('line')) {
        totalScore += 0.1
        reasons.push(`3D PCA线状特征明显(${meshFeatures.linearity3D.toFixed(2)})`)
      }
      // 如果明显是线状但模板不期望线状，惩罚
      if (meshFeatures.linearity3D > 0.8 && !template.expectedShapes?.includes('line') &&
          !template.expectedShapes?.includes('cylinder')) {
        totalScore -= 0.08
      }

      // 3D PCA 平面度
      if (meshFeatures.planarity3D > 0.9 && template.expectedShapes?.includes('plane')) {
        totalScore += 0.1
        reasons.push(`3D PCA板状特征明显(${meshFeatures.planarity3D.toFixed(2)})`)
      }
      // 如果明显是板状但模板不期望板状/平面，惩罚
      if (meshFeatures.planarity3D > 0.9 && meshFeatures.linearity3D < 0.5 &&
          !template.expectedShapes?.includes('plane') &&
          !template.expectedShapes?.includes('irregular')) {
        totalScore -= 0.08
      }

      // 紧凑度：高紧凑度 → 球状
      if (meshFeatures.compactness > 0.7 && template.expectedShapes?.includes('sphere')) {
        totalScore += 0.1
        reasons.push(`紧凑度高(${meshFeatures.compactness.toFixed(2)})→球状`)
      }

      // 轮廓凹度：高凹度 → 不规则
      if (meshFeatures.footprintConvexity > 0.3) {
        reasons.push(`轮廓凹度高(${meshFeatures.footprintConvexity.toFixed(2)})→不规则形状`)
        // 惩罚期望规则形状的模板
        if (template.expectedShapes?.some((s) => ['box', 'sphere'].includes(s)) &&
            !template.expectedShapes.includes('irregular')) {
          totalScore -= 0.1
          reasons.push(`高凹度与${template.type}的规则轮廓期望不符`)
        }
        // 奖励期望不规则形状的模板
        if (template.expectedShapes?.includes('irregular')) {
          totalScore += 0.08
        }
      }
    }

    return { total: Math.max(0, totalScore), reasons }
  }

  /**
   * 模糊匹配 - 使用高斯隶属函数
   * 返回 [0, 1] 的匹配度，在范围内为1，超出范围平滑衰减
   *
   * sigma 基于范围的参考值（min 或 max），避免宽范围时衰减太慢
   */
  private fuzzyMatch(value: number, range: [number, number]): number {
    const [min, max] = range

    if (value >= min && value <= max) {
      return 1.0
    }

    // 超出范围时使用高斯衰减
    const deviation = value < min ? min - value : value - max
    // sigma 基于范围端点的相对值，避免宽范围（如 [2, 100]）时衰减太慢
    const refValue = value < min ? Math.max(Math.abs(min), 0.1) : Math.max(Math.abs(max), 0.1)
    const sigma = refValue * 0.3 + 0.001
    const score = Math.exp(-(deviation * deviation) / (2 * sigma * sigma))

    return Math.max(score, 0)
  }

  /** 判断两种形状是否相似 */
  private isShapeSimilar(a: ShapeCategory, b: ShapeCategory): boolean {
    const similarGroups: ShapeCategory[][] = [
      ['box', 'irregular'],
      ['cylinder', 'sphere'],
      ['plane', 'irregular'],
      ['line', 'cylinder'],
      ['pyramid', 'irregular'],
    ]
    for (const group of similarGroups) {
      if (group.includes(a) && group.includes(b) && a !== b) {
        return true
      }
    }
    return false
  }
}
