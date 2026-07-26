/**
 * 核心领域类型定义
 * 所有模块共享的统一数据模型，保证松散耦合。
 */

/** 三维向量（局部 ENU 坐标，单位：米） */
export interface Vec3 {
  x: number
  y: number
  z: number
}

/** 可识别的空间对象类型 */
export type ObjectType =
  | 'door'
  | 'window'
  | 'building'
  | 'fence'
  | 'pole'
  | 'road'
  | 'tree'
  | 'ground'
  | 'unknown'

/** 基础几何形状分类 */
export type ShapeCategory =
  | 'box'
  | 'cylinder'
  | 'sphere'
  | 'plane'
  | 'line'
  | 'pyramid'
  | 'irregular'

/**
 * 形状描述子 - 用于异形对象分析
 * 基于三个主轴尺寸 e1 ≥ e2 ≥ e3 计算
 */
export interface ShapeDescriptor {
  /** 线性度: e1/e2 — 杆状物趋近无穷大 */
  linearity: number
  /** 平面度: e2/e3 — 板状物趋近无穷大 */
  planarity: number
  /** 散射度: e3/e1 — 趋近1为立方体/球体，趋近0为扁平/细长 */
  scattering: number
  /** 球度: 三轴均匀程度 [0,1] */
  sphericity: number
  /** 填充率: 点云分布体积/包围盒体积 [0,1]，低值表示异形 */
  fillFactor: number
  /** 宽高比: 水平最大/垂直高度 */
  aspectRatio: number
  /** 形状分类 */
  category: ShapeCategory
}

/** 对象包围盒信息（OBB 的简化表达） */
export interface BoundingInfo {
  /** 中心点（地理坐标） */
  center: { lon: number; lat: number; height: number }
  /** 短边尺寸（米） */
  width: number
  /** 长边尺寸（米） */
  length: number
  /** 高度（相对地面基准，米） */
  height: number
  /** 长轴方位角（度，0=北，顺时针） */
  orientationDeg: number
  /** 地面基准高（米） */
  groundHeight: number
  /** 形状描述子（由 GeometryAnalyzer 计算） */
  shape?: ShapeDescriptor
}

/** 空间对象 */
export interface SpatialObject {
  id: string
  type: ObjectType
  /** 识别置信度 0~1 */
  confidence: number
  bbox: BoundingInfo
  properties: Record<string, number | string>
}

/** 测量类型 */
export type MeasurementKind =
  | 'distance'
  | 'width'
  | 'length'
  | 'height'
  | 'area'
  | 'volume'
  | 'angle'
  | 'clearance'

/** 单项测量结果 */
export interface Measurement {
  kind: MeasurementKind
  /** 数值（由测量工具得出，绝不允许臆造） */
  value: number
  unit: string
}

/** 合规状态 */
export type ComplianceStatus = 'PASS' | 'FAIL' | 'WARN'

/** 违规明细 */
export interface Violation {
  rule: string
  actual: number | string
  expected: string
  severity: 'error' | 'warning'
}

/** 合规审查结果 */
export interface ComplianceResult {
  status: ComplianceStatus
  violations: Violation[]
  /** IF...THEN 推导出的属性，例如 { fireLevel: 'Level1' } */
  derived: Record<string, string | number>
}

/** 空间标注规格 */
export interface AnnotationSpec {
  objectId: string
  label: string
  /** Red=违规 Yellow=警告 Green=合规 */
  color: 'red' | 'yellow' | 'green'
}

/** 单对象完整巡检报告项 */
export interface InspectionResult {
  objectId: string
  objectType: ObjectType
  confidence: number
  /** 识别候选列表（按置信度降序） */
  alternatives?: Array<{ type: ObjectType; confidence: number }>
  /** 识别理由 */
  recognitionReasons?: string[]
  measurements: Measurement[]
  compliance: ComplianceResult
  annotations: AnnotationSpec[]
  recommendations: string[]
  bbox: BoundingInfo
}

/** 合规规则定义（DSL） */
export interface Rule {
  name: string
  /** DSL 条件表达式，如 "door.width >= 0.9" */
  condition: string
  severity: 'error' | 'warning'
  /** 适用对象类型，缺省表示所有类型 */
  appliesTo?: ObjectType[]
  /** 期望值描述（用于报告展示） */
  expected: string
}
