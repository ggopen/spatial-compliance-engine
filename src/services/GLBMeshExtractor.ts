/**
 * GLBMeshExtractor — 用 three.js GLTFLoader 解析 GLB 并提取网格几何数据
 *
 * 核心能力：
 * 1. 用 GLTFLoader.parse() 解析 GLB 二进制数据（无需 WebGL 上下文）
 * 2. 遍历场景图，收集所有顶点和三角形索引
 * 3. 应用节点变换矩阵和 RTC_CENTER 平移
 * 4. 支持 _BATCHID 属性，可按 batch 分离不同对象
 * 5. 支持 Draco 压缩（通过 DRACOLoader）
 *
 * 这是实体提取的核心：从 GLB 中提取真实的顶点/三角形数据，
 * 而非依赖 Cesium 内部 API（后者在 1.121 中静默失败）。
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import type { MeshGeometry } from '../core/types'

/** 单个对象的网格数据（可能含 batchId） */
export interface ExtractedMesh {
  /** 网格几何数据 */
  mesh: MeshGeometry
  /** Batch ID（如果 GLB 中有 _BATCHID 属性） */
  batchId: number | null
  /** 该网格的局部变换矩阵（相对于 GLB 根节点） */
  transform: THREE.Matrix4
}

export class GLBMeshExtractor {
  private loader: GLTFLoader
  private dracoLoader: DRACOLoader
  private initialized = false

  constructor() {
    this.loader = new GLTFLoader()
    this.dracoLoader = new DRACOLoader()
    // 使用 Google CDN 的 Draco 解码器
    this.dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/')
    this.loader.setDRACOLoader(this.dracoLoader)
    this.initialized = true
  }

  /**
   * 从 GLB ArrayBuffer 提取所有网格数据
   * @param glbBuffer GLB 二进制数据
   * @param rtcCenter RTC_CENTER（相对中心坐标），会作为平移叠加到根节点
   * @returns 提取的网格列表（每个 primitive 一个条目）
   */
  async extractFromGLB(
    glbBuffer: ArrayBuffer,
    rtcCenter: number[] | null = null
  ): Promise<ExtractedMesh[]> {
    if (!this.initialized) {
      throw new Error('GLBMeshExtractor not initialized')
    }

    return new Promise<ExtractedMesh[]>((resolve, reject) => {
      this.loader.parse(
        glbBuffer,
        '',
        (gltf) => {
          const meshes = this.extractMeshesFromScene(gltf.scene, rtcCenter)
          resolve(meshes)
        },
        (error) => {
          const msg = error instanceof Error ? error.message : String(error)
          reject(new Error(`GLTFLoader parse failed: ${msg}`))
        }
      )
    })
  }

  /**
   * 从 three.js Scene 中提取所有网格数据
   */
  private extractMeshesFromScene(
    scene: THREE.Group,
    rtcCenter: number[] | null
  ): ExtractedMesh[] {
    const meshes: ExtractedMesh[] = []
    const rtcOffset = rtcCenter
      ? new THREE.Vector3(rtcCenter[0], rtcCenter[1], rtcCenter[2])
      : new THREE.Vector3(0, 0, 0)

    scene.updateMatrixWorld(true)

    scene.traverse((obj) => {
      if (obj.type !== 'Mesh') return
      const mesh = obj as THREE.Mesh
      const geometry = mesh.geometry

      // 获取世界变换矩阵（含 RTC 偏移）
      const worldMatrix = mesh.matrixWorld.clone()
      // 叠加 RTC_CENTER
      worldMatrix.setPosition(
        worldMatrix.elements[12] + rtcOffset.x,
        worldMatrix.elements[13] + rtcOffset.y,
        worldMatrix.elements[14] + rtcOffset.z
      )

      const extracted = this.extractFromGeometry(geometry, mesh)
      for (const m of extracted) {
        meshes.push({
          mesh: m.mesh,
          batchId: m.batchId,
          transform: worldMatrix,
        })
      }
    })

    return meshes
  }

  /**
   * 从 BufferGeometry 提取顶点和索引
   * 如果有 _BATCHID 属性，按 batchId 分离
   */
  private extractFromGeometry(
    geometry: THREE.BufferGeometry,
    _mesh: THREE.Mesh
  ): Array<{ mesh: MeshGeometry; batchId: number | null }> {
    const positionAttr = geometry.getAttribute('POSITION')
    if (!positionAttr) return []

    const index = geometry.getIndex()
    const vertexCount = positionAttr.count

    // 检查是否有 _BATCHID 属性
    const batchIdAttr = geometry.getAttribute('_BATCHID') as THREE.BufferAttribute | undefined

    if (batchIdAttr) {
      // 按 batchId 分离三角形
      return this.extractByBatchId(positionAttr as THREE.BufferAttribute, index, batchIdAttr)
    }

    // 无 batchId，整体提取
    const positions = new Float32Array(vertexCount * 3)
    for (let i = 0; i < vertexCount; i++) {
      positions[i * 3] = positionAttr.getX(i)
      positions[i * 3 + 1] = positionAttr.getY(i)
      positions[i * 3 + 2] = positionAttr.getZ(i)
    }

    let indices: Uint32Array | Uint16Array | undefined
    let triangleCount = 0
    if (index) {
      const indexCount = index.count
      if (vertexCount > 65535) {
        indices = new Uint32Array(indexCount)
      } else {
        indices = new Uint16Array(indexCount)
      }
      for (let i = 0; i < indexCount; i++) {
        indices[i] = index.getX(i)
      }
      triangleCount = indexCount / 3
    } else {
      triangleCount = vertexCount / 3
    }

    return [
      {
        mesh: { positions, indices, vertexCount, triangleCount },
        batchId: null,
      },
    ]
  }

  /**
   * 按 _BATCHID 属性分离三角形到不同对象
   */
  private extractByBatchId(
    positionAttr: THREE.BufferAttribute,
    index: THREE.BufferAttribute | null,
    batchIdAttr: THREE.BufferAttribute
  ): Array<{ mesh: MeshGeometry; batchId: number | null }> {
    // 收集每个 batchId 对应的三角形索引
    const batchTriangles = new Map<number, number[]>()

    if (index) {
      const triCount = index.count / 3
      for (let t = 0; t < triCount; t++) {
        const a = index.getX(t * 3)
        const b = index.getX(t * 3 + 1)
        const c = index.getX(t * 3 + 2)
        // 取第一个顶点的 batchId 作为该三角形的 batchId
        const bid = batchIdAttr.getX(a)
        if (!batchTriangles.has(bid)) {
          batchTriangles.set(bid, [])
        }
        const arr = batchTriangles.get(bid)!
        arr.push(a, b, c)
      }
    } else {
      // 无索引：每3个顶点一个三角形
      const triCount = positionAttr.count / 3
      for (let t = 0; t < triCount; t++) {
        const a = t * 3
        const bid = batchIdAttr.getX(a)
        if (!batchTriangles.has(bid)) {
          batchTriangles.set(bid, [])
        }
        const arr = batchTriangles.get(bid)!
        arr.push(a, a + 1, a + 2)
      }
    }

    const results: Array<{ mesh: MeshGeometry; batchId: number | null }> = []

    for (const [bid, triIndices] of batchTriangles) {
      // 收集该 batch 用到的顶点，建立旧索引→新索引映射
      const vertexMap = new Map<number, number>()
      const positionsList: number[] = []

      for (let i = 0; i < triIndices.length; i++) {
        const oldIdx = triIndices[i]
        if (!vertexMap.has(oldIdx)) {
          const newIdx = positionsList.length / 3
          vertexMap.set(oldIdx, newIdx)
          positionsList.push(
            positionAttr.getX(oldIdx),
            positionAttr.getY(oldIdx),
            positionAttr.getZ(oldIdx)
          )
        }
      }

      // 重映射索引
      const newIndices = new Uint32Array(triIndices.length)
      for (let i = 0; i < triIndices.length; i++) {
        newIndices[i] = vertexMap.get(triIndices[i])!
      }

      const positions = new Float32Array(positionsList)
      const vertexCount = positions.length / 3
      const triangleCount = newIndices.length / 3

      results.push({
        mesh: {
          positions,
          indices: vertexCount > 65535 ? newIndices : new Uint16Array(newIndices),
          vertexCount,
          triangleCount,
        },
        batchId: bid,
      })
    }

    return results
  }

  /**
   * 将模型局部坐标变换为世界坐标（ECEF）
   * @param positions 模型局部坐标
   * @param transform 模型→世界变换矩阵
   * @returns 世界坐标（ECEF Cartesian3 数组）
   */
  static transformToWorld(
    positions: Float32Array,
    transform: THREE.Matrix4
  ): Float32Array {
    const world = new Float32Array(positions.length)
    const v = new THREE.Vector3()
    for (let i = 0; i < positions.length / 3; i++) {
      v.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
      v.applyMatrix4(transform)
      world[i * 3] = v.x
      world[i * 3 + 1] = v.y
      world[i * 3 + 2] = v.z
    }
    return world
  }

  /** 释放资源 */
  dispose(): void {
    this.dracoLoader.dispose()
  }
}
