// 空间对象类型
export type SpatialObjectType = 'door' | 'window' | 'building' | 'fence' | 'pole' | 'road' | 'tree' | 'unknown';

// 测量类型
export type MeasurementType = 'distance' | 'height' | 'area' | 'volume' | 'angle' | 'clearance' | 'width';

// 合规状态
export type ComplianceStatus = 'PASS' | 'FAIL' | 'WARNING';

// 标注颜色
export type AnnotationColor = 'red' | 'yellow' | 'green';

// Bounding Box
export interface BoundingBox {
  min: [number, number, number];
  max: [number, number, number];
}

// Oriented Bounding Box
export interface OrientedBoundingBox {
  center: [number, number, number];
  halfAxes: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ];
}

// 空间对象
export interface SpatialObject {
  id: string;
  type: SpatialObjectType;
  name: string;
  bbox?: BoundingBox;
  obb?: OrientedBoundingBox;
  position: { longitude: number; latitude: number; height: number };
  properties: Record<string, any>;
  confidence: number;
}

// 测量结果
export interface MeasurementResult {
  type: MeasurementType;
  value: number;
  unit: string;
  timestamp: Date;
  objectId: string;
}

// 合规规则
export interface ComplianceRule {
  id: string;
  name: string;
  objectType: SpatialObjectType;
  condition: string; // DSL 条件表达式
  description: string;
  severity: 'error' | 'warning' | 'info';
}

// 合规违规
export interface ComplianceViolation {
  ruleId: string;
  ruleName: string;
  actual: number;
  expected: string;
  message: string;
}

// 合规检查结果
export interface ComplianceResult {
  objectId: string;
  objectType: SpatialObjectType;
  status: ComplianceStatus;
  violations: ComplianceViolation[];
  timestamp: Date;
}

// 空间标注
export interface SpatialAnnotation {
  id: string;
  objectId: string;
  position: { longitude: number; latitude: number; height: number };
  color: AnnotationColor;
  label: string;
  description: string;
}

// 分析报告
export interface AnalysisReport {
  id: string;
  title: string;
  createdAt: Date;
  sceneUrl: string;
  objects: SpatialObject[];
  measurements: MeasurementResult[];
  complianceResults: ComplianceResult[];
  annotations: SpatialAnnotation[];
  summary: ReportSummary;
}

// 报告摘要
export interface ReportSummary {
  totalObjects: number;
  passCount: number;
  failCount: number;
  warningCount: number;
  complianceRate: number;
}

// Agent 工作流状态
export type AgentStatus = 'idle' | 'running' | 'completed' | 'error';

export interface AgentState {
  id: string;
  name: string;
  status: AgentStatus;
  progress: number;
  message: string;
  startTime?: Date;
  endTime?: Date;
}

// 工具调用
export interface ToolCall {
  tool: string;
  args: Record<string, any>;
  result?: any;
  timestamp: Date;
}
