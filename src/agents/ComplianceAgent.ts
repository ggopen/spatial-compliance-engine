import { RuleEngine } from '../rules';
import type { SpatialObject, MeasurementResult, ComplianceResult } from '../types';

export class ComplianceAgent {
  private ruleEngine: RuleEngine;
  
  constructor(ruleEngine: RuleEngine) {
    this.ruleEngine = ruleEngine;
  }
  
  // 执行合规分析
  analyze(
    objects: SpatialObject[],
    measurementsMap: Map<string, MeasurementResult[]>
  ): ComplianceResult[] {
    return this.ruleEngine.evaluateBatch(objects, measurementsMap);
  }
  
  // 对单个对象分析
  analyzeSingle(
    object: SpatialObject,
    measurements: MeasurementResult[]
  ): ComplianceResult {
    return this.ruleEngine.evaluateCompliance(object, measurements);
  }
  
  // 获取违规统计
  getViolationStats(results: ComplianceResult[]): {
    total: number;
    errors: number;
    warnings: number;
    passRate: number;
  } {
    const total = results.length;
    const errors = results.filter(r => r.status === 'FAIL').length;
    const warnings = results.filter(r => r.status === 'WARNING').length;
    const passRate = total > 0 ? Math.round(((total - errors - warnings) / total) * 10000) / 100 : 0;
    
    return { total, errors, warnings, passRate };
  }
}
