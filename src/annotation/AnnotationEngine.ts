import * as Cesium from 'cesium';
import type { SpatialAnnotation, ComplianceResult, AnnotationColor } from '../types';

export class AnnotationEngine {
  private viewer: Cesium.Viewer;
  private annotations: Map<string, Cesium.Entity> = new Map();

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer;
  }

  // 创建标注
  createAnnotation(annotation: SpatialAnnotation): void {
    const entity = this.viewer.entities.add({
      id: annotation.id,
      position: Cesium.Cartesian3.fromDegrees(
        annotation.position.longitude,
        annotation.position.latitude,
        annotation.position.height
      ),
      billboard: {
        image: this.createMarkerImage(annotation.color),
        width: 32,
        height: 32,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: annotation.label,
        font: '12px sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -36),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    this.annotations.set(annotation.id, entity);
  }

  // 创建 SVG 标记图片（彩色圆点 + 边框）
  private createMarkerImage(color: AnnotationColor): string {
    const colorMap: Record<AnnotationColor, string> = {
      red: '#FF0000',
      yellow: '#FFD700',
      green: '#00FF00',
    };
    const c = colorMap[color];
    // 使用 Canvas 生成 data URL
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    // 外圈
    ctx.beginPath();
    ctx.arc(16, 16, 14, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 内圈
    ctx.beginPath();
    ctx.arc(16, 16, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();

    // 中心点
    ctx.beginPath();
    ctx.arc(16, 16, 5, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();

    return canvas.toDataURL();
  }

  // 从合规结果批量创建标注
  createComplianceAnnotations(results: ComplianceResult[], objectPositions: Map<string, { longitude: number; latitude: number; height: number }>): SpatialAnnotation[] {
    const createdAnnotations: SpatialAnnotation[] = [];

    for (const result of results) {
      const position = objectPositions.get(result.objectId);
      if (!position) continue;

      const color: AnnotationColor = result.status === 'FAIL' ? 'red'
        : result.status === 'WARNING' ? 'yellow' : 'green';

      const annotation: SpatialAnnotation = {
        id: `annotation_${result.objectId}`,
        objectId: result.objectId,
        position,
        color,
        label: `${result.objectType.toUpperCase()} [${result.status}]`,
        description: result.violations.length > 0
          ? result.violations.map(v => v.message).join('; ')
          : '合规',
      };

      this.createAnnotation(annotation);
      createdAnnotations.push(annotation);
    }

    return createdAnnotations;
  }

  // 移除标注
  removeAnnotation(annotationId: string): void {
    const entity = this.annotations.get(annotationId);
    if (entity) {
      this.viewer.entities.remove(entity);
      this.annotations.delete(annotationId);
    }
  }

  // 清除所有标注
  clearAnnotations(): void {
    this.annotations.forEach(entity => {
      this.viewer.entities.remove(entity);
    });
    this.annotations.clear();
  }

  // 获取标注数量
  getAnnotationCount(): number {
    return this.annotations.size;
  }

  // 高亮标注
  highlightAnnotation(annotationId: string): void {
    const entity = this.annotations.get(annotationId);
    if (entity && entity.billboard) {
      // 脉冲效果 - 通过修改 scale
      (entity.billboard as any).scale = 1.5;
    }
  }
}
