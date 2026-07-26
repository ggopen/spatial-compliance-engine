import { describe, expect, it } from 'vitest'
import { MeshAnalyzer } from '../src/services/MeshAnalyzer'
import type { MeshGeometry } from '../src/core/types'

/** 生成立方体顶点数据 */
function makeBoxMesh(w: number, h: number, d: number): MeshGeometry {
  const hw = w / 2, hh = h / 2, hd = d / 2
  // 8 个顶点
  const positions = new Float32Array([
    -hw, -hh, -hd,  hw, -hh, -hd,  hw, hh, -hd, -hw, hh, -hd,
    -hw, -hh, hd,   hw, -hh, hd,   hw, hh, hd,  -hw, hh, hd,
  ])
  // 12 个三角形（6 面 × 2 三角形）
  const indices = new Uint32Array([
    0, 1, 2,  0, 2, 3,  // back
    4, 5, 6,  4, 6, 7,  // front
    0, 1, 5,  0, 5, 4,  // bottom
    2, 3, 7,  2, 7, 6,  // top
    0, 3, 7,  0, 7, 4,  // left
    1, 2, 6,  1, 6, 5,  // right
  ])
  return { positions, indices, vertexCount: 8, triangleCount: 12 }
}

/** 生成 L 型（异形）顶点数据 */
function makeLShapeMesh(): MeshGeometry {
  // L 型由两个长方体组成，合并顶点
  // 水平部分: 4×1×1
  // 垂直部分: 1×3×1
  const positions: number[] = []
  const indices: number[] = []

  // 简化：生成 L 型的 2D 轮廓点，然后挤出
  const footprint: Array<[number, number]> = [
    [0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4],
  ]
  const height = 1

  // 创建顶点（底部 + 顶部）
  for (const [x, y] of footprint) {
    positions.push(x, y, 0)
    positions.push(x, y, height)
  }

  // 创建侧面三角形
  const n = footprint.length
  let vIdx = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const bl = i * 2      // bottom left
    const br = j * 2      // bottom right
    const tl = i * 2 + 1  // top left
    const tr = j * 2 + 1  // top right
    indices.push(bl, br, tr, bl, tr, tl)
    vIdx++
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
  }
}

/** 生成细长杆状网格 */
function makePoleMesh(length: number, radius: number): MeshGeometry {
  const segments = 8
  const positions: number[] = []
  const indices: number[] = []

  // 底部圆环 + 顶部圆环
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2
    const x = Math.cos(angle) * radius
    const y = Math.sin(angle) * radius
    positions.push(x, y, 0)       // bottom
    positions.push(x, y, length)  // top
  }

  // 侧面三角形
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments
    const bl = i * 2
    const tl = i * 2 + 1
    const br = j * 2
    const tr = j * 2 + 1
    indices.push(bl, br, tr, bl, tr, tl)
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
  }
}

describe('MeshAnalyzer（真实网格几何分析）', () => {
  const analyzer = new MeshAnalyzer()

  it('立方体：实心度接近1，紧凑度合理', () => {
    const mesh = makeBoxMesh(2, 2, 2)
    const features = analyzer.analyze(mesh)
    // 立方体的凸包体积 = 8，OBB体积 = 8，实心度 = 1
    expect(features.solidity).toBeGreaterThan(0.95)
    expect(features.isConvex).toBe(true)
    expect(features.obbVolume).toBeCloseTo(8, 1)
    expect(features.convexHullVolume).toBeCloseTo(8, 1)
  })

  it('L型异形：实心度明显低于立方体，判定为不规则', () => {
    const mesh = makeLShapeMesh()
    const features = analyzer.analyze(mesh)
    // L 型的实心度应该明显低于 1（因为它不是凸体）
    expect(features.solidity).toBeLessThan(0.9)
    expect(features.isConvex).toBe(false)
    // 轮廓凹度应该大于 0（L 型是非凸形状）
    expect(features.footprintConvexity).toBeGreaterThan(0)
  })

  it('细长杆：3D PCA 线性度较高', () => {
    const mesh = makePoleMesh(10, 0.2)
    const features = analyzer.analyze(mesh)
    // 杆状物的 linearity3D 应该是三个主成分中最显著的
    expect(features.linearity3D).toBeGreaterThan(0.45)
    // OBB 最大轴应该接近杆长
    expect(features.obbExtents[0]).toBeGreaterThan(5)
  })

  it('表面积计算正确', () => {
    const mesh = makeBoxMesh(2, 2, 2)
    const features = analyzer.analyze(mesh)
    // 2×2×2 立方体表面积 = 6 × 4 = 24
    expect(features.surfaceArea).toBeCloseTo(24, 0)
  })

  it('增强形状描述子使用真实网格特征', () => {
    const mesh = makeLShapeMesh()
    const features = analyzer.analyze(mesh)
    const bbox = {
      center: { lon: 116, lat: 40, height: 0 },
      width: 1, length: 4, height: 1,
      orientationDeg: 0, groundHeight: 0,
      mesh, meshFeatures: features,
    }
    const shape = analyzer.computeEnhancedShapeDescriptor(bbox, features)
    // L 型应该被分类为不规则
    expect(shape.category).toBe('irregular')
    // 填充率应该反映低实心度
    expect(shape.fillFactor).toBeLessThan(0.9)
  })
})
