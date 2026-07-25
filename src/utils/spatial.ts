import * as turf from '@turf/turf'

/**
 * 计算多边形面积
 */
export function calculatePolygonArea(coordinates: number[][]): number {
  if (coordinates.length < 3) return 0
  const polygon = turf.polygon([coordinates])
  return turf.area(polygon)
}

/**
 * 创建缓冲区域
 */
export function createBuffer(coordinates: number[][], radius: number, unit: turf.Units = 'meters'): any | null {
  if (coordinates.length < 3) return null
  const polygon = turf.polygon([coordinates])
  return turf.buffer(polygon, radius, { units: unit })
}

/**
 * 判断点是否在多边形内
 */
export function isPointInPolygon(point: [number, number], polygonCoordinates: number[][]): boolean {
  const pt = turf.point(point)
  const polygon = turf.polygon([polygonCoordinates])
  return turf.booleanPointInPolygon(pt, polygon)
}

/**
 * 计算两点间距离
 */
export function calculateDistance(from: [number, number], to: [number, number], unit: turf.Units = 'meters'): number {
  const fromPt = turf.point(from)
  const toPt = turf.point(to)
  return turf.distance(fromPt, toPt, { units: unit })
}
