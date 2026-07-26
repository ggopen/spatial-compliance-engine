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

/** 真实网格几何数据（从 3D Tiles 提取的原始顶点/三角形） */
export interface MeshGeometry {
  /** 顶点坐标数组（局部 ENU，单位米），长度 = vertexCount × 3 */
  positions: Float32Array
  /** 三角形索引数组（可选），长度 = triangleCount × 3 */
  indices?: Uint32Array | Uint16Array
  /** 顶点数 */
  vertexCount: number
  /** 三角形数 */
  triangleCount: number
  /** 顶点法线（可选） */
  normals?: Float32Array
}

/** 高级几何特征（基于真实网格分析） */
export interface MeshFeatures {
  /** 实体体积（凸包体积，m³） */
  convexHullVolume: number
  /** 表面积（所有三角形面积之和，m²） */
  surfaceArea: number
  /** 凸包表面积（m²） */
  convexHullSurfaceArea: number
  /** 紧凑度 = 36π × V² / S³（1=球体，越小越不规则） */
  compactness: number
  /** 2D 轮廓面积（投影到 XY 平面的凸包面积，m²） */
  footprintArea: number
  /** 2D 轮廓周长（m） */
  footprintPerimeter: number
  /** 轮廓凹度 = 1 - 轮廓面积/凸包面积（0=凸形，越大越凹） */
  footprintConvexity: number
  /** OBB 三个半轴长度（米），降序排列 */
  obbExtents: [number, number, number]
  /** OBB 体积（m³） */
  obbVolume: number
  /** 实心度 = 凸包体积 / OBB 体积 [0,1]，低值表示异形 */
  solidity: number
  /** 主成分方差比 λ₁/(λ₁+λ₂+λ₃)，越大越线状 */
  linearity3D: number
  /** 平面度 (λ₁+λ₂)/(λ₁+λ₂+λ₃)，趋近1为板状 */
  planarity3D: number
  /** 是否为凸体 */
  isConvex: boolean
  /** PCL 点云分析特征（基于 PCL.js 第三方库计算） */
  pclFeatures?: PCLFeatures
}

/** PCL 点云分析特征 — 使用第三方库 PCL.js (WebAssembly) 计算 */
export interface PCLFeatures {
  /** 点云分辨率（平均点间距，米） */
  cloudResolution: number
  /** 下采样后点数 */
  downsampledPointCount: number
  /** 法线竖直度（法线z分量绝对值的平均值，0-1，1=水平面如地面/屋顶） */
  normalVerticality: number
  /** 法线水平度（法线在XY平面分量占比，0-1，1=竖直面如墙体/门） */
  normalHorizontality: number
  /** 检测到的平面数量（RANSAC 迭代提取） */
  planeCount: number
  /** 最大平面占比（inliers/total，0-1） */
  largestPlaneRatio: number
  /** 最大平面的法线方向 [nx, ny, nz] */
  largestPlaneNormal: [number, number, number]
  /** 最大平面是否为水平面（|nz| > 0.7） */
  largestPlaneIsHorizontal: boolean
  /** 是否检测到圆柱面 */
  hasCylinder: boolean
  /** 圆柱半径（米），若无则为 null */
  cylinderRadius: number | null
  /** 法线分布熵（0=高度集中=单一平面，越高越复杂/不规则） */
  normalEntropy: number
  /** 表面复杂度评分 [0,1]，综合法线熵、平面数、实心度 */
  surfaceComplexity: number
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
  /** 真实网格几何数据（从 3D Tiles 提取） */
  mesh?: MeshGeometry
  /** 高级网格特征（基于真实网格分析） */
  meshFeatures?: MeshFeatures
  /** Batch Table 属性（从 3D Tiles 读取的语义信息） */
  batchProperties?: Record<string, unknown>
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
