import * as Cesium from 'cesium';

// Cartesian3 转 经纬度
export function cartesianToDegrees(cartesian: Cesium.Cartesian3): { longitude: number; latitude: number; height: number } {
  const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
  return {
    longitude: Cesium.Math.toDegrees(cartographic.longitude),
    latitude: Cesium.Math.toDegrees(cartographic.latitude),
    height: cartographic.height,
  };
}

// 经纬度转 Cartesian3
export function degreesToCartesian(longitude: number, latitude: number, height: number = 0): Cesium.Cartesian3 {
  return Cesium.Cartesian3.fromDegrees(longitude, latitude, height);
}

// 格式化距离
export function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`;
  }
  return `${meters.toFixed(2)} m`;
}

// 格式化面积
export function formatArea(squareMeters: number): string {
  if (squareMeters >= 10000) {
    return `${(squareMeters / 10000).toFixed(2)} ha`;
  }
  return `${squareMeters.toFixed(2)} m²`;
}

// 格式化体积
export function formatVolume(cubicMeters: number): string {
  if (cubicMeters >= 1000) {
    return `${(cubicMeters / 1000).toFixed(2)} ×10³ m³`;
  }
  return `${cubicMeters.toFixed(2)} m³`;
}
