import type { SpatialObject, SpatialObjectType } from '../types';

// 对象类型识别规则
interface RecognitionRule {
  type: SpatialObjectType;
  heightRange: [number, number];
  widthRange?: [number, number];
  aspectRatioRange?: [number, number];
  minConfidence: number;
}

export class ObjectRecognitionAgent {
  private rules: Map<SpatialObjectType, RecognitionRule> = new Map();

  constructor() {
    this.initRules();
  }

  private initRules(): void {
    // 门：高1.8~2.5m，宽0.6~1.5m
    this.rules.set('door', {
      type: 'door',
      heightRange: [1.8, 2.5],
      widthRange: [0.6, 1.5],
      minConfidence: 0.7,
    });

    // 建筑：高>3m
    this.rules.set('building', {
      type: 'building',
      heightRange: [3, 500],
      minConfidence: 0.6,
    });

    // 围栏：高1~3m，宽长比大（薄几何）
    this.rules.set('fence', {
      type: 'fence',
      heightRange: [1, 3],
      minConfidence: 0.6,
    });

    // 杆：高>3m，宽<0.5m
    this.rules.set('pole', {
      type: 'pole',
      heightRange: [3, 50],
      widthRange: [0, 0.5],
      minConfidence: 0.5,
    });

    // 树：高2~30m
    this.rules.set('tree', {
      type: 'tree',
      heightRange: [2, 30],
      minConfidence: 0.5,
    });

    // 窗：高0.8~2m，宽0.5~2m
    this.rules.set('window', {
      type: 'window',
      heightRange: [0.8, 2],
      widthRange: [0.5, 2],
      minConfidence: 0.5,
    });
  }

  // 识别对象类型
  recognizeObject(object: SpatialObject): { type: SpatialObjectType; confidence: number; alternatives: Array<{ type: SpatialObjectType; confidence: number }> } {
    const candidates: Array<{ type: SpatialObjectType; confidence: number }> = [];

    const height = this.estimateHeight(object);
    const width = this.estimateWidth(object);
    const bbox = object.bbox;

    this.rules.forEach((rule, type) => {
      let confidence = 0;

      // 高度匹配
      if (height !== null && height >= rule.heightRange[0] && height <= rule.heightRange[1]) {
        confidence += 0.4;
      }

      // 宽度匹配
      if (rule.widthRange && width !== null) {
        if (width >= rule.widthRange[0] && width <= rule.widthRange[1]) {
          confidence += 0.3;
        }
      }

      // 围栏特殊判断：长宽比大（薄几何）
      if (type === 'fence' && bbox) {
        const dx = bbox.max[0] - bbox.min[0];
        const dy = bbox.max[1] - bbox.min[1];
        const dz = bbox.max[2] - bbox.min[2];
        const minDim = Math.min(dx, dy, dz);
        const maxDim = Math.max(dx, dy, dz);
        if (maxDim > 0 && minDim / maxDim < 0.2) {
          confidence += 0.2;
        }
      }

      // 杆特殊判断：细长
      if (type === 'pole' && bbox) {
        const dx = bbox.max[0] - bbox.min[0];
        const dy = bbox.max[1] - bbox.min[1];
        const dz = bbox.max[2] - bbox.min[2];
        const horizontal = Math.sqrt(dx * dx + dy * dy);
        if (dz > 0 && horizontal / dz < 0.15) {
          confidence += 0.3;
        }
      }

      if (confidence > 0) {
        candidates.push({ type, confidence: Math.min(confidence, 0.99) });
      }
    });

    // 按置信度排序
    candidates.sort((a, b) => b.confidence - a.confidence);

    if (candidates.length === 0) {
      return {
        type: 'unknown',
        confidence: 0,
        alternatives: [],
      };
    }

    return {
      type: candidates[0].type,
      confidence: candidates[0].confidence,
      alternatives: candidates.slice(1, 3),
    };
  }

  // 估算高度
  private estimateHeight(object: SpatialObject): number | null {
    if (object.bbox) {
      return object.bbox.max[2] - object.bbox.min[2];
    }
    if (object.properties.height !== undefined) {
      return Number(object.properties.height);
    }
    return null;
  }

  // 估算宽度
  private estimateWidth(object: SpatialObject): number | null {
    if (object.bbox) {
      return Math.max(
        object.bbox.max[0] - object.bbox.min[0],
        object.bbox.max[1] - object.bbox.min[1]
      );
    }
    if (object.properties.width !== undefined) {
      return Number(object.properties.width);
    }
    return null;
  }

  // 获取所有可识别的类型
  getRecognizableTypes(): SpatialObjectType[] {
    return Array.from(this.rules.keys());
  }

  // 获取识别规则
  getRules(): RecognitionRule[] {
    return Array.from(this.rules.values());
  }
}
