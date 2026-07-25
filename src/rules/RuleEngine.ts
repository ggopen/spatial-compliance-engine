import type { ComplianceRule, ComplianceResult, ComplianceViolation, ComplianceStatus, SpatialObject, MeasurementResult } from '../types';

// DSL 比较运算符
type ComparisonOperator = '>' | '>=' | '<' | '<=' | '==' | '!=' | 'between';

// 解析后的条件
interface ParsedCondition {
  field: string;
  operator: ComparisonOperator;
  value: number;
  value2?: number; // 用于 between
}

export class RuleEngine {
  private rules: ComplianceRule[] = [];

  // 添加规则
  addRule(rule: ComplianceRule): void {
    this.rules.push(rule);
  }

  // 批量添加规则
  addRules(rules: ComplianceRule[]): void {
    this.rules.push(...rules);
  }

  // 移除规则
  removeRule(ruleId: string): void {
    this.rules = this.rules.filter(r => r.id !== ruleId);
  }

  // 获取所有规则
  getRules(): ComplianceRule[] {
    return [...this.rules];
  }

  // 清空规则
  clearRules(): void {
    this.rules = [];
  }

  // 解析 DSL 条件表达式
  parseCondition(condition: string): ParsedCondition | null {
    // 支持 "field > value", "field >= value", "field < value", "field <= value", "field == value", "field != value"
    // 支持 "field between value1 and value2"
    const betweenRegex = /^(\w+(?:\.\w+)*)\s+between\s+(\d+(?:\.\d+)?)\s+and\s+(\d+(?:\.\d+)?)$/i;
    const comparisonRegex = /^(\w+(?:\.\w+)*)\s*(>=|<=|!=|>|<|==)\s*(\d+(?:\.\d+)?)$/;

    let match = condition.match(betweenRegex);
    if (match) {
      return {
        field: match[1].trim(),
        operator: 'between',
        value: parseFloat(match[2]),
        value2: parseFloat(match[3]),
      };
    }

    match = condition.match(comparisonRegex);
    if (match) {
      return {
        field: match[1].trim(),
        operator: match[2] as ComparisonOperator,
        value: parseFloat(match[3]),
      };
    }

    console.warn(`Failed to parse condition: ${condition}`);
    return null;
  }

  // 评估单个条件
  evaluateCondition(condition: ParsedCondition, measurements: MeasurementResult[]): boolean {
    // 从测量结果中获取字段值
    const measurement = measurements.find(m => m.type === condition.field);
    const actualValue = measurement ? measurement.value : undefined;

    if (actualValue === undefined) {
      console.warn(`Measurement '${condition.field}' not found`);
      return false;
    }

    switch (condition.operator) {
      case '>': return actualValue > condition.value;
      case '>=': return actualValue >= condition.value;
      case '<': return actualValue < condition.value;
      case '<=': return actualValue <= condition.value;
      case '==': return actualValue === condition.value;
      case '!=': return actualValue !== condition.value;
      case 'between': return actualValue >= condition.value && actualValue <= (condition.value2 ?? 0);
      default: return false;
    }
  }

  // 对单个对象执行合规检查
  evaluateCompliance(
    object: SpatialObject,
    measurements: MeasurementResult[]
  ): ComplianceResult {
    const violations: ComplianceViolation[] = [];

    // 筛选适用于此对象类型的规则
    const applicableRules = this.rules.filter(r => r.objectType === object.type || r.objectType === 'unknown');

    for (const rule of applicableRules) {
      const condition = this.parseCondition(rule.condition);
      if (!condition) continue;

      const passed = this.evaluateCondition(condition, measurements);

      if (!passed) {
        const measurement = measurements.find(m => m.type === condition.field);
        violations.push({
          ruleId: rule.id,
          ruleName: rule.name,
          actual: measurement?.value ?? 0,
          expected: condition.operator === 'between'
            ? `${condition.value}~${condition.value2}`
            : `${condition.operator} ${condition.value}`,
          message: `${rule.name}: 实际值 ${measurement?.value ?? '未知'} 不满足 ${rule.condition}`,
        });
      }
    }

    const status: ComplianceStatus = violations.length === 0
      ? 'PASS'
      : violations.some(v => {
          const rule = this.rules.find(r => r.id === v.ruleId);
          return rule?.severity === 'error';
        })
        ? 'FAIL'
        : 'WARNING';

    return {
      objectId: object.id,
      objectType: object.type,
      status,
      violations,
      timestamp: new Date(),
    };
  }

  // 批量合规检查
  evaluateBatch(
    objects: SpatialObject[],
    measurementsMap: Map<string, MeasurementResult[]>
  ): ComplianceResult[] {
    return objects.map(obj => {
      const measurements = measurementsMap.get(obj.id) || [];
      return this.evaluateCompliance(obj, measurements);
    });
  }

  // 加载预设规则
  loadPresetRules(): void {
    this.rules = [
      {
        id: 'door_width',
        name: '门宽度标准',
        objectType: 'door',
        condition: 'width >= 0.9',
        description: '门宽度不应小于0.9m（GB 50352-2019）',
        severity: 'error',
      },
      {
        id: 'door_height',
        name: '门高度标准',
        objectType: 'door',
        condition: 'height >= 2.0',
        description: '门高度不应小于2.0m',
        severity: 'error',
      },
      {
        id: 'fence_height',
        name: '围栏高度标准',
        objectType: 'fence',
        condition: 'height between 1.0 and 2.2',
        description: '围栏高度应在1.0~2.2m之间',
        severity: 'warning',
      },
      {
        id: 'building_height_residential',
        name: '住宅建筑高度',
        objectType: 'building',
        condition: 'height >= 3',
        description: '住宅建筑层高不应小于3m',
        severity: 'info',
      },
      {
        id: 'pole_height',
        name: '杆体高度检查',
        objectType: 'pole',
        condition: 'height >= 3',
        description: '杆体高度不应小于3m',
        severity: 'warning',
      },
    ];
  }
}
