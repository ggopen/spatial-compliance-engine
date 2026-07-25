import * as Cesium from 'cesium';
import type { MeasurementResult } from '../types';

export class MeasurementEngine {
  private viewer: Cesium.Viewer;
  private scene: Cesium.Scene;
  private measureEntities: Cesium.Entity[] = [];
  
  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer;
    this.scene = viewer.scene;
  }
  
  // 测量两点之间的距离
  measureDistance(start: Cesium.Cartesian3, end: Cesium.Cartesian3, objectId: string): MeasurementResult {
    const distance = Cesium.Cartesian3.distance(start, end);
    return {
      type: 'distance',
      value: Math.round(distance * 100) / 100,
      unit: 'm',
      timestamp: new Date(),
      objectId,
    };
  }
  
  // 测量高度
  measureHeight(point: Cesium.Cartesian3, objectId: string): MeasurementResult {
    const cartographic = Cesium.Cartographic.fromCartesian(point);
    const height = cartographic.height;
    return {
      type: 'height',
      value: Math.round(height * 100) / 100,
      unit: 'm',
      timestamp: new Date(),
      objectId,
    };
  }
  
  // 测量两点的高度差
  measureHeightDifference(start: Cesium.Cartesian3, end: Cesium.Cartesian3, objectId: string): MeasurementResult {
    const startCarto = Cesium.Cartographic.fromCartesian(start);
    const endCarto = Cesium.Cartographic.fromCartesian(end);
    const heightDiff = Math.abs(endCarto.height - startCarto.height);
    return {
      type: 'height',
      value: Math.round(heightDiff * 100) / 100,
      unit: 'm',
      timestamp: new Date(),
      objectId,
    };
  }
  
  // 测量面积（给定三个或更多点）
  measureArea(points: Cesium.Cartesian3[], objectId: string): MeasurementResult {
    if (points.length < 3) {
      throw new Error('At least 3 points are required for area measurement');
    }
    
    // 使用 Cesium 计算多边形面积
    const positions: Cesium.Cartographic[] = points.map(p => Cesium.Cartographic.fromCartesian(p));
    
    // 使用球面面积计算
    let area = 0;
    const n = positions.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const p1 = positions[i];
      const p2 = positions[j];
      // 使用简化的面积计算
      const lat1 = p1.latitude;
      const lat2 = p2.latitude;
      const dLon = p2.longitude - p1.longitude;
      area += (dLon) * (2 + Math.sin(lat1) + Math.sin(lat2));
    }
    area = Math.abs(area * 6378137 * 6378137 / 2);
    
    return {
      type: 'area',
      value: Math.round(area * 100) / 100,
      unit: 'm²',
      timestamp: new Date(),
      objectId,
    };
  }
  
  // 测量体积（简化：使用 bbox 的长宽高）
  measureVolume(length: number, width: number, height: number, objectId: string): MeasurementResult {
    const volume = length * width * height;
    return {
      type: 'volume',
      value: Math.round(volume * 100) / 100,
      unit: 'm³',
      timestamp: new Date(),
      objectId,
    };
  }
  
  // 测量角度（三个点）
  measureAngle(pointA: Cesium.Cartesian3, pointB: Cesium.Cartesian3, pointC: Cesium.Cartesian3, objectId: string): MeasurementResult {
    const vectorBA = Cesium.Cartesian3.subtract(pointA, pointB, new Cesium.Cartesian3());
    const vectorBC = Cesium.Cartesian3.subtract(pointC, pointB, new Cesium.Cartesian3());
    
    const dotProduct = Cesium.Cartesian3.dot(vectorBA, vectorBC);
    const magnitudeBA = Cesium.Cartesian3.magnitude(vectorBA);
    const magnitudeBC = Cesium.Cartesian3.magnitude(vectorBC);
    
    const angleRad = Math.acos(dotProduct / (magnitudeBA * magnitudeBC));
    const angleDeg = Cesium.Math.toDegrees(angleRad);
    
    return {
      type: 'angle',
      value: Math.round(angleDeg * 100) / 100,
      unit: '°',
      timestamp: new Date(),
      objectId,
    };
  }
  
  // 测量净空（点到地面的垂直距离）
  measureClearance(point: Cesium.Cartesian3, objectId: string): MeasurementResult {
    const cartographic = Cesium.Cartographic.fromCartesian(point);
    // 使用场景的地球椭球面高度作为地面参考
    const surfaceCartesian = Cesium.Cartesian3.fromRadians(
      cartographic.longitude,
      cartographic.latitude,
      0
    );
    const clearance = Cesium.Cartesian3.distance(point, surfaceCartesian);
    
    return {
      type: 'clearance',
      value: Math.round(clearance * 100) / 100,
      unit: 'm',
      timestamp: new Date(),
      objectId,
    };
  }
  
  // 在场景中绘制测量线
  drawMeasurementLine(start: Cesium.Cartesian3, end: Cesium.Cartesian3, label: string): void {
    const entity = this.viewer.entities.add({
      position: Cesium.Cartesian3.midpoint(start, end, new Cesium.Cartesian3()),
      polyline: {
        positions: [start, end],
        width: 2,
        material: Cesium.Color.CYAN,
        clampToGround: false,
      },
      label: {
        text: label,
        font: '14px sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -15),
      },
    });
    this.measureEntities.push(entity);
  }
  
  // 清除所有测量实体
  clearMeasurements(): void {
    for (const entity of this.measureEntities) {
      this.viewer.entities.remove(entity);
    }
    this.measureEntities = [];
  }
  
  // 交互式距离测量
  startDistanceMeasure(callback?: (result: MeasurementResult) => void): () => void {
    const positions: Cesium.Cartesian3[] = [];
    let tempEntity: Cesium.Entity | undefined;
    
    const handler = new Cesium.ScreenSpaceEventHandler(this.scene.canvas);
    
    handler.setInputAction((click: { position: Cesium.Cartesian2 }) => {
      const cartesian = this.scene.pickPosition(click.position);
      if (!cartesian) return;
      
      positions.push(cartesian);
      
      if (positions.length === 2) {
        const result = this.measureDistance(positions[0], positions[1], 'manual');
        const label = `${result.value} ${result.unit}`;
        this.drawMeasurementLine(positions[0], positions[1], label);
        if (tempEntity) {
          this.viewer.entities.remove(tempEntity);
          tempEntity = undefined;
        }
        callback?.(result);
        positions.length = 0;
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    
    handler.setInputAction((movement: { endPosition: Cesium.Cartesian2 }) => {
      if (positions.length === 1) {
        const cartesian = this.scene.pickPosition(movement.endPosition);
        if (cartesian && tempEntity) {
          // 更新临时线
        } else if (cartesian) {
          tempEntity = this.viewer.entities.add({
            polyline: {
              positions: new Cesium.CallbackProperty(() => [positions[0], cartesian], false),
              width: 2,
              material: Cesium.Color.YELLOW.withAlpha(0.7),
            },
          });
        }
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    
    // 返回清理函数
    return () => {
      handler.destroy();
      if (tempEntity) {
        this.viewer.entities.remove(tempEntity);
      }
    };
  }
  
  // 获取工具列表
  getAvailableTools(): string[] {
    return [
      'measure_distance',
      'measure_height',
      'measure_area',
      'measure_volume',
      'measure_angle',
      'measure_clearance',
    ];
  }
}
