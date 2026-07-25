import * as Cesium from 'cesium';
import { MeasurementEngine } from '../measurement';
import type { SpatialObject, MeasurementResult, MeasurementType } from '../types';

export class MeasurementAgent {
  private measurementEngine: MeasurementEngine;
  private results: Map<string, MeasurementResult[]> = new Map();
  
  constructor(measurementEngine: MeasurementEngine) {
    this.measurementEngine = measurementEngine;
  }
  
  // 根据对象类型自动选择测量方法
  selectMeasurements(objectType: string): MeasurementType[] {
    switch (objectType) {
      case 'door':
        return ['width', 'height'];
      case 'window':
        return ['width', 'height'];
      case 'building':
        return ['height', 'volume'];
      case 'fence':
        return ['height', 'distance'];
      case 'pole':
        return ['height'];
      case 'tree':
        return ['height'];
      case 'road':
        return ['width', 'distance'];
      default:
        return ['height', 'distance'];
    }
  }
  
  // 执行测量（模拟 - 基于场景中的点击点位和bbox估算）
  performMeasurements(
    object: SpatialObject,
    clickPoints: Cesium.Cartesian3[]
  ): MeasurementResult[] {
    const measurementTypes = this.selectMeasurements(object.type);
    const results: MeasurementResult[] = [];
    
    // 从bbox估算尺寸
    if (object.bbox) {
      const dx = object.bbox.max[0] - object.bbox.min[0];
      const dy = object.bbox.max[1] - object.bbox.min[1];
      const dz = object.bbox.max[2] - object.bbox.min[2];
      
      if (measurementTypes.includes('height')) {
        results.push({
          type: 'height',
          value: Math.round(dz * 100) / 100,
          unit: 'm',
          timestamp: new Date(),
          objectId: object.id,
        });
      }
      
      if (measurementTypes.includes('width')) {
        results.push({
          type: 'width',
          value: Math.round(Math.max(dx, dy) * 100) / 100,
          unit: 'm',
          timestamp: new Date(),
          objectId: object.id,
        });
      }
      
      if (measurementTypes.includes('volume')) {
        results.push(this.measurementEngine.measureVolume(dx, dy, dz, object.id));
      }
    }
    
    // 使用点击点位进行实际测量
    if (clickPoints.length >= 2) {
      for (let i = 0; i < clickPoints.length - 1; i++) {
        const result = this.measurementEngine.measureDistance(
          clickPoints[i],
          clickPoints[i + 1],
          object.id
        );
        results.push(result);
        this.measurementEngine.drawMeasurementLine(
          clickPoints[i],
          clickPoints[i + 1],
          `${result.value} ${result.unit}`
        );
      }
    }
    
    this.results.set(object.id, results);
    return results;
  }
  
  // 获取测量结果
  getResults(objectId?: string): MeasurementResult[] | Map<string, MeasurementResult[]> {
    if (objectId) {
      return this.results.get(objectId) || [];
    }
    return this.results;
  }
  
  // 获取所有工具
  getAvailableTools(): string[] {
    return [
      'measure_distance',
      'measure_height',
      'measure_area',
      'measure_volume',
      'measure_angle',
      'measure_clearance',
      'get_bbox',
      'get_obb',
      'get_properties',
    ];
  }
}
