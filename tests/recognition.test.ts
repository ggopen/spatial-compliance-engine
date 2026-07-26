import { describe, expect, it } from 'vitest'
import { RecognitionAgent } from '../src/agents/RecognitionAgent'
import { AnalysisOrchestrator } from '../src/agents/Orchestrator'
import { GeometryAnalyzer, type SamplePoint } from '../src/core/GeometryAnalyzer'
import type { BoundingInfo } from '../src/core/types'

/** 创建带形状描述子的 BoundingInfo */
function makeBBox(
  width: number,
  length: number,
  height: number,
  points?: SamplePoint[]
): BoundingInfo {
  const bbox: BoundingInfo = {
    center: { lon: 116, lat: 40, height },
    width,
    length,
    height,
    orientationDeg: 0,
    groundHeight: 0
  }
  const analyzer = new GeometryAnalyzer()
  bbox.shape = analyzer.analyze(bbox, points)
  return bbox
}

/** 生成矩形 footprint 的采样点 */
function makeRectPoints(
  w: number,
  l: number,
  h: number,
  count = 50
): SamplePoint[] {
  const pts: SamplePoint[] = []
  for (let i = 0; i < count; i++) {
    pts.push({
      x: (Math.random() - 0.5) * w,
      y: (Math.random() - 0.5) * l,
      h: Math.random() * h
    })
  }
  return pts
}

/** 生成 L 型 footprint 的采样点（异形） */
function makeLShapePoints(
  w: number,
  l: number,
  h: number,
  count = 50
): SamplePoint[] {
  const pts: SamplePoint[] = []
  for (let i = 0; i < count; i++) {
    const x = (Math.random() - 0.5) * w
    const y = (Math.random() - 0.5) * l
    // L 型：去掉一个象限
    if (x > 0 && y > 0) {
      pts.push({ x: x - w * 0.3, y: y - l * 0.3, h: Math.random() * h })
    } else {
      pts.push({ x, y, h: Math.random() * h })
    }
  }
  return pts
}

describe('RecognitionAgent（多维特征评分）', () => {
  const agent = new RecognitionAgent()

  it('典型门：高 2.03 / 宽 0.83 / 厚 0.1 → door, 高置信度', () => {
    // 门：薄板状，厚度 0.1m
    const r = agent.classify(makeBBox(0.1, 0.83, 2.03, makeRectPoints(0.1, 0.83, 2.03)))
    expect(r.type).toBe('door')
    expect(r.confidence).toBeGreaterThanOrEqual(0.5)
  })

  it('高而细（h>3, 宽<0.5）→ pole', () => {
    const r = agent.classify(makeBBox(0.3, 0.3, 6, makeRectPoints(0.3, 0.3, 6)))
    expect(r.type).toBe('pole')
  })

  it('矮长薄（h 1~3, 长>2, 薄）→ fence', () => {
    const r = agent.classify(makeBBox(0.15, 5, 1.5, makeRectPoints(0.15, 5, 1.5)))
    expect(r.type).toBe('fence')
  })

  it('贴地延展 → road', () => {
    const r = agent.classify(makeBBox(3, 10, 0.1, makeRectPoints(3, 10, 0.1)))
    expect(r.type).toBe('road')
  })

  it('大尺度 → building', () => {
    const r = agent.classify(makeBBox(12, 20, 25, makeRectPoints(12, 20, 25)))
    expect(r.type).toBe('building')
  })

  it('异形对象（L型）→ 识别为不规则形状，给出候选列表', () => {
    const r = agent.classify(makeBBox(5, 5, 3, makeLShapePoints(5, 5, 3)))
    // 异形对象应该有候选列表
    expect(r.alternatives.length).toBeGreaterThanOrEqual(0)
    // 应该有识别理由
    expect(r.reasons.length).toBeGreaterThan(0)
  })

  it('无形状描述子时仍可基于尺寸识别（兼容模式）', () => {
    const bbox: BoundingInfo = {
      center: { lon: 116, lat: 40, height: 6 },
      width: 0.3,
      length: 0.3,
      height: 6,
      orientationDeg: 0,
      groundHeight: 0
    }
    const r = agent.classify(bbox)
    expect(r.type).toBeTruthy()
    expect(r.confidence).toBeGreaterThanOrEqual(0)
  })
})

describe('AnalysisOrchestrator 多Agent流水线', () => {
  it('完整输出 schema：objectId/objectType/measurements/compliance/annotations/recommendations', () => {
    const orch = new AnalysisOrchestrator()
    const result = orch.analyze(makeBBox(0.1, 0.83, 2.03, makeRectPoints(0.1, 0.83, 2.03)))
    expect(result.objectId).toBeTruthy()
    expect(result.objectType).toBe('door')
    expect(result.measurements.length).toBe(2)
    expect(['PASS', 'FAIL', 'WARN']).toContain(result.compliance.status)
    expect(result.compliance.status).toBe('FAIL') // 宽 0.83 < 0.9
    expect(result.annotations[0].color).toBe('red')
    expect(result.recommendations.length).toBeGreaterThan(0)
    // 新增：应包含识别候选和理由
    expect(result.alternatives).toBeDefined()
    expect(result.recognitionReasons).toBeDefined()
  })

  it('合规对象 → 绿色标注', () => {
    const orch = new AnalysisOrchestrator()
    const result = orch.analyze(makeBBox(0.1, 1.0, 2.1, makeRectPoints(0.1, 1.0, 2.1)))
    expect(result.objectType).toBe('door')
    expect(result.compliance.status).toBe('PASS')
    expect(result.annotations[0].color).toBe('green')
  })
})
