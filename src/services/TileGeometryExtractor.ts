/**
 * TileGeometryExtractor — 从 Cesium 3D Tiles 提取真实顶点/三角形几何数据
 *
 * 核心能力：
 * 1. 通过 scene.pick() 获取点击位置的 Cesium3DTileFeature
 * 2. 通过内部 API (_gltfLoader.components) 遍历 Model 节点树，提取 POSITION 顶点和索引
 * 3. 将模型局部坐标变换为世界坐标（Cartesian3），再转为局部 ENU 坐标（米）
 * 4. 从 Batch Table 读取语义属性（如分类、名称、ID）
 *
 * 这是整个识别管线的"真实几何数据源"——不再依赖高度采样。
 */
import * as Cesium from 'cesium'
import type { MeshGeometry } from '../core/types'
import { toLocalXY } from '../utils/geo'

/** 拾取结果：包含几何数据和 Batch Table 属性 */
export interface PickedGeometry {
  /** 世界坐标系下的网格几何（已转换为局部 ENU 米坐标） */
  mesh: MeshGeometry
  /** 拾取点的地理坐标 */
  cartographic: Cesium.Cartographic
  /** Batch Table 属性 */
  batchProperties: Record<string, unknown>
  /** 原始 feature 引用（可用于高亮等） */
  feature: Cesium.Cesium3DTileFeature
}

export class TileGeometryExtractor {
  /**
   * 从屏幕拾取位置提取真实几何数据
   * @param scene Cesium 场景
   * @param position 屏幕坐标
   * @returns 几何数据，或 null（未命中 3D Tiles）
   */
  extractFromScreen(
    scene: Cesium.Scene,
    position: Cesium.Cartesian2
  ): PickedGeometry | null {
    const picked = scene.pick(position)
    if (!Cesium.defined(picked)) return null

    // 获取 Cesium3DTileFeature
    const feature = picked.id ?? picked.primitive
    if (!(feature instanceof Cesium.Cesium3DTileFeature)) {
      // 某些情况下 picked.primitive 可能是 content 而非 feature
      // 尝试从 content 获取
      return null
    }

    // Cesium 1.121 的类型定义中 content 可能在 prototype 上不在类型声明里
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content = (feature as any).content as Cesium.Cesium3DTileContent | undefined
    if (!content) return null

    // 获取拾取点的世界坐标
    const worldPos = scene.pickPosition(position)
    if (!worldPos) return null
    const cartographic = Cesium.Cartographic.fromCartesian(worldPos)

    // 提取 Batch Table 属性
    const batchProperties = this.extractBatchProperties(feature)

    // 提取网格几何数据
    const mesh = this.extractMeshFromContent(content, cartographic)
    if (!mesh || mesh.vertexCount === 0) return null

    return { mesh, cartographic, batchProperties, feature }
  }

  /**
   * 遍历已加载的瓦片，提取所有可见瓦片的几何数据
   * @param tileset Cesium3DTileset
   * @returns 所有瓦片的几何数据列表
   */
  extractAllFromTileset(
    tileset: Cesium.Cesium3DTileset
  ): Array<{ mesh: MeshGeometry; cartographic: Cesium.Cartographic; batchProperties: Record<string, unknown> }> {
    const results: Array<{ mesh: MeshGeometry; cartographic: Cesium.Cartographic; batchProperties: Record<string, unknown> }> = []

    // 遍历瓦片树
    const stack: Cesium.Cesium3DTile[] = []
    const root = (tileset as unknown as { _root: Cesium.Cesium3DTile })._root
    if (root) stack.push(root)

    while (stack.length > 0) {
      const tile = stack.pop()!
      const content = tile.content
      if (content && content.ready) {
        const center = tile.boundingSphere.center
        const cartographic = Cesium.Cartographic.fromCartesian(center)
        const mesh = this.extractMeshFromContent(content, cartographic)
        if (mesh && mesh.vertexCount > 0) {
          // 尝试获取 batch table 属性
          const batchProperties: Record<string, unknown> = {}
          const featuresLength = content.featuresLength
          if (featuresLength > 0) {
            const firstFeature = content.getFeature(0)
            if (firstFeature) {
              const propertyIds = firstFeature.getPropertyIds()
              for (const pid of propertyIds) {
                batchProperties[pid] = firstFeature.getProperty(pid)
              }
            }
          }
          results.push({ mesh, cartographic, batchProperties })
        }
      }

      // 遍历子瓦片
      if (tile.children && tile.children.length > 0) {
        for (const child of tile.children) {
          stack.push(child)
        }
      }
    }

    return results
  }

  /**
   * 从 Cesium3DTileContent 提取网格几何数据
   * 通过内部 _model._gltfLoader.components API 访问顶点数据
   */
  private extractMeshFromContent(
    content: Cesium.Cesium3DTileContent,
    refCartographic: Cesium.Cartographic
  ): MeshGeometry | null {
    // 尝试通过内部 API 获取 Model
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contentAny = content as any
    const model = contentAny._model
    if (!model) return null

    // 获取 GltfLoader 的 components
    const loader = model._gltfLoader ?? model._loader
    if (!loader || !loader.components) return null

    const components = loader.components
    if (!components.nodes || components.nodes.length === 0) return null

    // 参考点：用瓦片中心作为局部 ENU 原点
    const refLonDeg = Cesium.Math.toDegrees(refCartographic.longitude)
    const refLatDeg = Cesium.Math.toDegrees(refCartographic.latitude)
    const refHeight = refCartographic.height

    // 收集所有顶点和索引
    const allPositions: number[] = []
    const allIndices: number[] = []
    let vertexOffset = 0
    let hasIndices = false

    const modelMatrix = model.modelMatrix ?? Cesium.Matrix4.IDENTITY

    for (const node of components.nodes) {
      const nodeTransform = node.transform ?? Cesium.Matrix4.IDENTITY
      const worldMatrix = Cesium.Matrix4.multiply(
        modelMatrix,
        nodeTransform,
        new Cesium.Matrix4()
      )

      if (!node.primitives) continue

      for (const primitive of node.primitives) {
        // 查找 POSITION 属性
        let posAttr = null
        if (primitive.attributes) {
          // attributes 可能是数组或对象
          if (Array.isArray(primitive.attributes)) {
            posAttr = primitive.attributes.find(
              (a: { semantic?: string }) => a.semantic === 'POSITION'
            )
          } else {
            posAttr = primitive.attributes.POSITION ?? null
          }
        }

        if (!posAttr) continue

        // 获取顶点 TypedArray
        const positions = posAttr.typedArray ?? posAttr.array
        if (!positions || positions.length === 0) continue

        const count = posAttr.count ?? positions.length / 3
        const tmpCartesian = new Cesium.Cartesian3()

        // 将模型局部坐标 → 世界坐标 → 局部 ENU
        for (let i = 0; i < count; i++) {
          const px = positions[i * 3]
          const py = positions[i * 3 + 1]
          const pz = positions[i * 3 + 2]

          tmpCartesian.x = px
          tmpCartesian.y = py
          tmpCartesian.z = pz

          // 应用节点+模型变换 → 世界坐标
          Cesium.Matrix4.multiplyByPoint(worldMatrix, tmpCartesian, tmpCartesian)

          // 世界坐标 → 地理坐标 → 局部 ENU
          const carto = Cesium.Cartographic.fromCartesian(tmpCartesian)
          const lonDeg = Cesium.Math.toDegrees(carto.longitude)
          const latDeg = Cesium.Math.toDegrees(carto.latitude)

          const localXY = toLocalXY(
            { lon: lonDeg, lat: latDeg },
            { lon: refLonDeg, lat: refLatDeg }
          )

          allPositions.push(localXY.x, localXY.y, carto.height - refHeight)
        }

        // 收集索引
        if (primitive.indices) {
          const indices = primitive.indices.typedArray ?? primitive.indices.array
          if (indices) {
            const idxCount = primitive.indices.count ?? indices.length
            for (let i = 0; i < idxCount; i++) {
              allIndices.push(indices[i] + vertexOffset)
            }
            hasIndices = true
          }
        }

        vertexOffset += count
      }
    }

    if (allPositions.length === 0) return null

    const positionsArray = new Float32Array(allPositions)
    const vertexCount = allPositions.length / 3

    let indicesArray: Uint32Array | Uint16Array | undefined
    let triangleCount = 0
    if (hasIndices && allIndices.length > 0) {
      const maxIndex = Math.max(...allIndices)
      if (maxIndex > 65535) {
        indicesArray = new Uint32Array(allIndices)
      } else {
        indicesArray = new Uint16Array(allIndices)
      }
      triangleCount = allIndices.length / 3
    } else {
      // 无索引时，每3个顶点构成一个三角形
      triangleCount = vertexCount / 3
    }

    return {
      positions: positionsArray,
      indices: indicesArray,
      vertexCount,
      triangleCount,
    }
  }

  /**
   * 提取 Batch Table 属性
   */
  private extractBatchProperties(feature: Cesium.Cesium3DTileFeature): Record<string, unknown> {
    const props: Record<string, unknown> = {}
    try {
      const propertyIds = feature.getPropertyIds()
      for (const pid of propertyIds) {
        props[pid] = feature.getProperty(pid)
      }
    } catch {
      // 忽略属性读取错误
    }
    return props
  }
}
