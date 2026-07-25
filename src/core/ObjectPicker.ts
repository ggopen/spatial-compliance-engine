import * as Cesium from 'cesium';
import type { SpatialObject } from '../types';

export class ObjectPicker {

  constructor(viewer: Cesium.Viewer) {
    void viewer;
  }

  extractSpatialObject(feature: any): SpatialObject {
    const id = feature.getProperty?.('id') || `obj_${Date.now()}`;
    const position = this.getFeaturePosition(feature);

    return {
      id: String(id),
      type: 'unknown', // 需要识别Agent后续处理
      name: feature.getProperty('name') || `Object ${id}`,
      position,
      properties: this.extractProperties(feature),
      confidence: 1.0,
      bbox: this.getFeatureBBox(feature),
    };
  }

  // 获取要素位置（经纬高）
  private getFeaturePosition(
    feature: Cesium.Cesium3DTileFeature,
  ): { longitude: number; latitude: number; height: number } {
    const content = (feature as any).content;
    // 尝试从模型矩阵获取中心点
    const modelMatrix = content.modelMatrix;
    const cartesian = new Cesium.Cartesian3();
    const position = Cesium.Matrix4.getTranslation(modelMatrix, cartesian);
    const cartographic = Cesium.Cartographic.fromCartesian(position);
    return {
      longitude: Cesium.Math.toDegrees(cartographic.longitude),
      latitude: Cesium.Math.toDegrees(cartographic.latitude),
      height: cartographic.height,
    };
  }

  // 提取属性
  private extractProperties(feature: Cesium.Cesium3DTileFeature): Record<string, any> {
    const props: Record<string, any> = {};
    const propertyIds = feature.getPropertyIds();
    for (const id of propertyIds) {
      props[id] = feature.getProperty(id);
    }
    return props;
  }

  // 获取包围盒
  private getFeatureBBox(feature: Cesium.Cesium3DTileFeature): any | undefined {
    try {
      const content = (feature as any).content;
      const tileTransform = content.tile?.transform;
      if (!tileTransform) return undefined;

      // 使用 Cesium3DTile 内容的包围盒
      const boundingVolume = (feature as any).content?.tile?.boundingVolume;
      if (!boundingVolume) return undefined;

      return {
        min: [0, 0, 0],
        max: [0, 0, 0],
      } as any;
    } catch {
      return undefined;
    }
  }

  highlightObject(feature: any, color: Cesium.Color = Cesium.Color.YELLOW): void {
    feature.color = Cesium.Color.clone(color);
  }

  resetHighlight(feature: any): void {
    feature.color = Cesium.Color.WHITE;
  }
}
