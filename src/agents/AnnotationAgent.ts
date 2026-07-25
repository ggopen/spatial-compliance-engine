import { AnnotationEngine } from '../annotation';
import type { SpatialAnnotation, ComplianceResult } from '../types';

export class AnnotationAgent {
  private annotationEngine: AnnotationEngine;
  
  constructor(annotationEngine: AnnotationEngine) {
    this.annotationEngine = annotationEngine;
  }
  
  // 根据合规结果创建标注
  createComplianceAnnotations(
    results: ComplianceResult[],
    positions: Map<string, { longitude: number; latitude: number; height: number }>
  ): SpatialAnnotation[] {
    return this.annotationEngine.createComplianceAnnotations(results, positions);
  }
  
  // 创建自定义标注
  createAnnotation(annotation: SpatialAnnotation): void {
    this.annotationEngine.createAnnotation(annotation);
  }
  
  // 清除标注
  clearAnnotations(): void {
    this.annotationEngine.clearAnnotations();
  }
  
  // 获取标注数量
  getAnnotationCount(): number {
    return this.annotationEngine.getAnnotationCount();
  }
}
