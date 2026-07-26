/**
 * Measurement Engine（测量引擎）
 *
 * 设计说明：
 * - 只消费 BoundingInfo（由场景采样工具提供真实几何数据），绝不臆造数值。
 * - 与 Cesium 解耦：所有计算基于纯数值，便于单元测试与替换渲染引擎。
 * - 按对象类型自动选择测量方法（对应文档第七节）。
 */
import type { BoundingInfo, Measurement, MeasurementKind, ObjectType } from '../core/types'
import { round3 } from '../utils/number'

/** 对象类型 → 需要的测量项映射（对应"自动测量 Prompt"） */
export const MEASUREMENT_PLAN: Record<ObjectType, MeasurementKind[]> = {
  door: ['width', 'height'],
  window: ['width', 'height'],
  building: ['height', 'volume', 'area'],
  fence: ['length', 'height'],
  pole: ['height', 'clearance'],
  road: ['width', 'length'],
  tree: ['height'],
  ground: ['area'],
  unknown: ['width', 'length', 'height', 'area']
}

export class MeasurementEngine {
  /** 为指定对象类型自动选择测量方法 */
  selectMeasurements(type: ObjectType): MeasurementKind[] {
    return MEASUREMENT_PLAN[type] ?? MEASUREMENT_PLAN.unknown
  }

  /**
   * 基于真实包围盒执行测量。
   * @param bbox 场景采样得到的几何信息
   * @param type 已识别的对象类型
   */
  measure(bbox: BoundingInfo, type: ObjectType): Measurement[] {
    const kinds = this.selectMeasurements(type)
    return kinds.map((kind) => this.measureOne(kind, bbox, type))
  }

  /**
   * 根据对象类型获取语义化的水平尺寸。
   *
   * BoundingInfo 中 width=短边、length=长边，但合规规则中的 "width" 语义因对象而异：
   * - 门/窗："width" 指洞口宽度（水平长边），厚度是短边
   * - 道路："width" 指路面宽度（水平短边），延伸方向是长边
   * - 其他：直接使用原始 width/length
   */
  private getSemanticDims(bbox: BoundingInfo, type: ObjectType): {
    sw: number
    sl: number
    sh: number
  } {
    const hShort = Math.min(bbox.width, bbox.length)
    const hLong = Math.max(bbox.width, bbox.length)
    switch (type) {
      case 'door':
      case 'window':
        return { sw: hLong, sl: hShort, sh: bbox.height }
      case 'road':
        return { sw: hShort, sl: hLong, sh: bbox.height }
      default:
        return { sw: bbox.width, sl: bbox.length, sh: bbox.height }
    }
  }

  /** 执行单项测量 */
  measureOne(kind: MeasurementKind, bbox: BoundingInfo, type: ObjectType = 'unknown'): Measurement {
    const { sw, sl, sh } = this.getSemanticDims(bbox, type)
    switch (kind) {
      case 'width':
        return { kind, value: round3(sw), unit: 'm' }
      case 'length':
        return { kind, value: round3(sl), unit: 'm' }
      case 'height':
        return { kind, value: round3(sh), unit: 'm' }
      case 'distance':
        // 对象尺度上的距离取对角线
        return { kind, value: round3(Math.hypot(sw, sl)), unit: 'm' }
      case 'area':
        // 占地面积 = 长 × 宽
        return { kind, value: round3(sw * sl), unit: 'm²' }
      case 'volume':
        // 体积近似 = 长 × 宽 × 高
        return { kind, value: round3(sw * sl * sh), unit: 'm³' }
      case 'angle':
        // 长轴方位角
        return { kind, value: round3(bbox.orientationDeg), unit: '°' }
      case 'clearance':
        // 净空 = 底部相对地面的净高（此处即底部距地高度）
        return { kind, value: round3(Math.max(0, bbox.center.height - bbox.groundHeight)), unit: 'm' }
      default: {
        const exhaustive: never = kind
        throw new Error(`未支持的测量类型: ${exhaustive as string}`)
      }
    }
  }
}
