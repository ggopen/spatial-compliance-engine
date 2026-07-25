<template>
  <div class="app-container">
    <!-- 顶部工具栏 -->
    <header class="toolbar">
      <div class="toolbar-left">
        <span class="app-title">Spatial Compliance Engine</span>
      </div>
      <div class="toolbar-center">
        <button
          class="toolbar-btn"
          :class="{ active: activeTool === 'pick' }"
          @click="toggleTool('pick')"
          title="拾取对象"
        >
          <span class="btn-icon">&#128269;</span> 拾取
        </button>
        <button
          class="toolbar-btn"
          :class="{ active: activeTool === 'measure_distance' }"
          @click="toggleTool('measure_distance')"
          title="测距"
        >
          <span class="btn-icon">&#128207;</span> 测距
        </button>
        <span class="toolbar-divider"></span>
        <button
          class="toolbar-btn primary"
          :disabled="isWorkflowRunning || pickedObjects.length === 0"
          @click="runWorkflow"
          title="执行完整分析工作流"
        >
          <span class="btn-icon">&#9881;</span> {{ isWorkflowRunning ? '分析中...' : '执行分析' }}
        </button>
        <button class="toolbar-btn" @click="handleReset" title="重置">
          <span class="btn-icon">&#128260;</span> 重置
        </button>
        <span class="toolbar-divider"></span>
        <button class="toolbar-btn" @click="loadTileset" :disabled="tilesetLoading" title="加载3D Tiles">
          <span class="btn-icon">&#127758;</span> {{ tilesetLoading ? '加载中...' : '加载3D Tiles' }}
        </button>
      </div>
      <div class="toolbar-right">
        <span class="toolbar-info">{{ mouseCoords.lng }}, {{ mouseCoords.lat }}</span>
      </div>
    </header>

    <!-- 主内容区 -->
    <div class="main-content">
      <!-- 左侧地图区域 -->
      <div class="map-area">
        <div id="cesiumContainer" class="cesium-container"></div>
        <!-- 地图上的统计浮层 -->
        <div v-if="complianceResults.length > 0" class="map-overlay-stats">
          <div class="stat-badge pass">合规 {{ passCount }}</div>
          <div class="stat-badge fail">违规 {{ failCount }}</div>
          <div class="stat-badge warning">警告 {{ warningCount }}</div>
          <div class="stat-badge rate">合规率 {{ complianceRate }}%</div>
        </div>
      </div>

      <!-- 右侧控制面板 -->
      <aside class="control-panel">
        <!-- Tab 切换 -->
        <div class="panel-tabs">
          <button
            class="tab-btn"
            :class="{ active: sidebarTab === 'rules' }"
            @click="setSidebarTab('rules')"
          >规则</button>
          <button
            class="tab-btn"
            :class="{ active: sidebarTab === 'objects' }"
            @click="setSidebarTab('objects')"
          >对象 ({{ pickedObjects.length }})</button>
          <button
            class="tab-btn"
            :class="{ active: sidebarTab === 'results' }"
            @click="setSidebarTab('results')"
          >结果</button>
          <button
            class="tab-btn"
            :class="{ active: sidebarTab === 'agents' }"
            @click="setSidebarTab('agents')"
          >Agent</button>
          <button
            class="tab-btn"
            :class="{ active: sidebarTab === 'report' }"
            @click="setSidebarTab('report')"
          >报告</button>
        </div>

        <!-- 规则 Tab -->
        <div v-show="sidebarTab === 'rules'" class="tab-content">
          <div class="panel-section">
            <h3 class="panel-title">预设合规规则</h3>
            <div class="panel-body">
              <div v-if="presetRules.length === 0" class="result-empty">
                加载 3D Tiles 后自动加载预设规则
              </div>
              <div v-for="rule in presetRules" :key="rule.id" class="rule-card">
                <div class="rule-header">
                  <span class="rule-name">{{ rule.name }}</span>
                  <span class="rule-severity" :class="rule.severity">{{ severityLabel(rule.severity) }}</span>
                </div>
                <div class="rule-condition">{{ rule.condition }}</div>
                <div class="rule-desc">{{ rule.description }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- 对象 Tab -->
        <div v-show="sidebarTab === 'objects'" class="tab-content">
          <div class="panel-section">
            <h3 class="panel-title">已拾取对象</h3>
            <div class="panel-body">
              <div v-if="pickedObjects.length === 0" class="result-empty">
                点击"拾取"按钮后在 3D 场景中点击对象进行拾取
              </div>
              <div
                v-for="obj in pickedObjects"
                :key="obj.id"
                class="object-card"
                :class="{ selected: selectedObjectId === obj.id }"
                @click="selectObject(obj.id)"
              >
                <div class="obj-header">
                  <span class="obj-type-badge">{{ obj.type }}</span>
                  <span class="obj-name">{{ obj.name }}</span>
                </div>
                <div class="obj-info">
                  <span>置信度: {{ (obj.confidence * 100).toFixed(0) }}%</span>
                  <span>{{ obj.position.longitude.toFixed(4) }}, {{ obj.position.latitude.toFixed(4) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 结果 Tab -->
        <div v-show="sidebarTab === 'results'" class="tab-content">
          <div class="panel-section">
            <h3 class="panel-title">合规检查结果</h3>
            <div class="panel-body">
              <div v-if="complianceResults.length === 0" class="result-empty">
                执行分析后将显示合规检查结果
              </div>
              <div
                v-for="result in complianceResults"
                :key="result.objectId"
                class="result-card"
                :class="result.status.toLowerCase()"
              >
                <div class="result-header">
                  <span class="status-badge" :class="result.status.toLowerCase()">
                    {{ statusLabel(result.status) }}
                  </span>
                  <span class="result-type">{{ result.objectType }}</span>
                </div>
                <div v-if="result.violations.length > 0" class="violations">
                  <div v-for="v in result.violations" :key="v.ruleId" class="violation-item">
                    {{ v.message }}
                  </div>
                </div>
                <div v-else class="no-violation">无违规项</div>
              </div>
            </div>
          </div>

          <!-- 测量结果 -->
          <div class="panel-section" v-if="measurements.length > 0">
            <h3 class="panel-title">测量数据</h3>
            <div class="panel-body">
              <div v-for="m in measurements" :key="m.objectId + m.type" class="measurement-item">
                <span class="m-type">{{ m.type }}</span>
                <span class="m-value">{{ m.value }} {{ m.unit }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Agent Tab -->
        <div v-show="sidebarTab === 'agents'" class="tab-content">
          <div class="panel-section">
            <h3 class="panel-title">多 Agent 工作流</h3>
            <div class="panel-body">
              <div class="workflow-diagram">
                <div
                  v-for="(agent, idx) in agentStates"
                  :key="agent.id"
                  class="agent-node"
                  :class="agent.status"
                >
                  <div class="agent-icon">{{ agentIcon(agent.name) }}</div>
                  <div class="agent-name">{{ agent.name }}</div>
                  <div class="agent-progress" v-if="agent.status === 'running'">
                    <div class="progress-bar" :style="{ width: agent.progress + '%' }"></div>
                  </div>
                  <div class="agent-status">{{ agent.message }}</div>
                  <div v-if="idx < agentStates.length - 1" class="agent-arrow">&#8595;</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 报告 Tab -->
        <div v-show="sidebarTab === 'report'" class="tab-content">
          <div class="panel-section">
            <h3 class="panel-title">分析报告</h3>
            <div class="panel-body">
              <div v-if="!currentReport" class="result-empty">
                执行分析后自动生成报告
              </div>
              <div v-else class="report-summary">
                <h4>{{ currentReport.title }}</h4>
                <p class="report-meta">生成时间: {{ formatDate(currentReport.createdAt) }}</p>

                <div class="summary-grid">
                  <div class="summary-card total">
                    <div class="summary-number">{{ currentReport.summary.totalObjects }}</div>
                    <div class="summary-label">总对象</div>
                  </div>
                  <div class="summary-card pass">
                    <div class="summary-number">{{ currentReport.summary.passCount }}</div>
                    <div class="summary-label">合规</div>
                  </div>
                  <div class="summary-card fail">
                    <div class="summary-number">{{ currentReport.summary.failCount }}</div>
                    <div class="summary-label">违规</div>
                  </div>
                  <div class="summary-card warning">
                    <div class="summary-number">{{ currentReport.summary.warningCount }}</div>
                    <div class="summary-label">警告</div>
                  </div>
                </div>

                <div class="compliance-bar">
                  <div class="bar-label">合规率: {{ currentReport.summary.complianceRate }}%</div>
                  <div class="bar-track">
                    <div class="bar-fill" :style="{ width: currentReport.summary.complianceRate + '%' }"></div>
                  </div>
                </div>

                <div class="report-actions">
                  <button class="action-btn" @click="downloadHTML">下载 HTML 报告</button>
                  <button class="action-btn secondary" @click="downloadJSON">下载 JSON 数据</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>

    <!-- 底部状态栏 -->
    <footer class="statusbar">
      <div class="statusbar-left">
        <span>{{ statusMessage }}</span>
      </div>
      <div class="statusbar-center">
        <span>相机高度: {{ cameraHeight }}m | 对象: {{ pickedObjects.length }} | 测量: {{ measurements.length }}</span>
      </div>
      <div class="statusbar-right">
        <span>Spatial Compliance Engine v0.1.0</span>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import * as Cesium from 'cesium'
import { useAppStore } from './stores'
import { CesiumViewer } from './core/CesiumViewer'
import { ObjectPicker } from './core/ObjectPicker'
import { MeasurementEngine } from './measurement'
import { RuleEngine } from './rules'
import { ReportEngine } from './services'
import { ObjectRecognitionAgent } from './agents/ObjectRecognitionAgent'
import { WorkflowOrchestrator } from './agents/WorkflowOrchestrator'
import type { ComplianceRule } from './types'

const store = useAppStore()

// 解构 store
const {
  tilesetLoading, pickedObjects, selectedObjectId,
  measurements, complianceResults, currentReport, agentStates,
  isWorkflowRunning, activeTool, sidebarTab, statusMessage,
  cameraHeight, mouseCoords,
  passCount, failCount, warningCount, complianceRate,
} = store

// 预设规则
const presetRules = ref<ComplianceRule[]>([])

// 引擎实例引用
let cesiumViewer: CesiumViewer | null = null
let objectPicker: ObjectPicker | null = null
let measurementEngine: MeasurementEngine | null = null
let measurementCleanup: (() => void) | null = null
let workflowOrchestrator: WorkflowOrchestrator | null = null

// 方法
const setSidebarTab = (tab: string) => store.setSidebarTab(tab)
const selectObject = (id: string) => store.selectObject(id)

function severityLabel(s: string): string {
  const map: Record<string, string> = { error: '错误', warning: '警告', info: '信息' }
  return map[s] || s
}

function statusLabel(s: string): string {
  const map: Record<string, string> = { PASS: '合规', FAIL: '违规', WARNING: '警告' }
  return map[s] || s
}

function agentIcon(name: string): string {
  const icons: Record<string, string> = {
    'Object Recognition': '\uD83D\uDD0D',
    'Measurement': '\uD83D\uDCCF',
    'Compliance': '\u2705',
    'Annotation': '\uD83C\uDFA8',
    'Report': '\uD83D\uDCC4',
  }
  return icons[name] || '\uD83D\uDD27'
}

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleString('zh-CN')
}

// 切换工具
function toggleTool(tool: string) {
  if (store.activeTool === tool) {
    // 取消选中
    store.setActiveTool(null)
    cleanupTool()
  } else {
    cleanupTool()
    store.setActiveTool(tool)

    if (tool === 'measure_distance' && measurementEngine && cesiumViewer) {
      const cleanup = measurementEngine.startDistanceMeasure((result) => {
        store.addMeasurements([result])
        store.setStatusMessage(`测量完成: ${result.value} ${result.unit}`)
      })
      measurementCleanup = cleanup
      store.setStatusMessage('点击两点测量距离')
    } else if (tool === 'pick') {
      store.setStatusMessage('点击 3D 场景中的对象进行拾取')
    }
  }
}

function cleanupTool() {
  if (measurementCleanup) {
    measurementCleanup()
    measurementCleanup = null
  }
}

// 加载 3D Tiles
async function loadTileset() {
  if (!cesiumViewer) return
  store.setTilesetLoading(true)
  store.setStatusMessage('正在加载 3D Tiles...')

  const tileset = await cesiumViewer.load3DTiles(store.tilesetUrl)
  if (tileset) {
    store.setTilesetLoaded(true)
    store.setStatusMessage('3D Tiles 加载成功')

    // 初始化工作流编排器（需要在 viewer 创建后）
    const viewer = cesiumViewer.getViewer()
    workflowOrchestrator = new WorkflowOrchestrator(viewer, store.tilesetUrl)

    // 加载预设规则
    const ruleEngine = new RuleEngine()
    ruleEngine.loadPresetRules()
    presetRules.value = ruleEngine.getRules()
  } else {
    store.setStatusMessage('3D Tiles 加载失败')
  }
  store.setTilesetLoading(false)
}

// 执行工作流
async function runWorkflow() {
  if (!workflowOrchestrator || pickedObjects.length === 0) return

  store.setWorkflowRunning(true)
  store.setSidebarTab('agents')
  store.setStatusMessage('开始执行多 Agent 分析工作流...')

  try {
    const clickPoints = new Map<string, Cesium.Cartesian3[]>()

    // 为每个对象生成模拟点击点（基于对象位置）
    for (const obj of pickedObjects) {
      clickPoints.set(obj.id, [
        Cesium.Cartesian3.fromDegrees(obj.position.longitude, obj.position.latitude, obj.position.height),
        Cesium.Cartesian3.fromDegrees(obj.position.longitude + 0.001, obj.position.latitude, obj.position.height),
      ])
    }

    // 执行工作流
    const report = await workflowOrchestrator.executeWorkflow(
      pickedObjects,
      clickPoints,
      store.tilesetUrl,
      (agent, _status, _progress, message) => {
        const states = workflowOrchestrator!.getAgentStates()
        store.setAgentStates([...states])
        store.setStatusMessage(`[${agent}] ${message}`)
      }
    )

    // 更新 store - 直接从 report 中获取数据
    store.setComplianceResults(report.complianceResults)
    store.setAnnotations(report.annotations)
    store.addMeasurements(report.measurements)
    store.setCurrentReport(report)

    const finalStates = workflowOrchestrator.getAgentStates()
    store.setAgentStates([...finalStates])

    store.setSidebarTab('results')
    store.setStatusMessage(`分析完成: ${report.summary.passCount} 合规, ${report.summary.failCount} 违规, ${report.summary.warningCount} 警告`)
  } catch (error) {
    console.error('Workflow error:', error)
    store.setStatusMessage('分析工作流执行失败: ' + (error as Error).message)
  }

  store.setWorkflowRunning(false)
}

// 重置
function handleReset() {
  cleanupTool()
  store.reset()
  workflowOrchestrator?.reset()
  measurementEngine?.clearMeasurements()
  store.setAgentStates([])
  store.setStatusMessage('已重置')
}

// 下载报告
function downloadHTML() {
  if (!store.currentReport) return
  const engine = new ReportEngine()
  engine.downloadHTMLReport(store.currentReport)
}

function downloadJSON() {
  if (!store.currentReport) return
  const engine = new ReportEngine()
  engine.downloadJSONReport(store.currentReport)
}

// 生命周期
onMounted(() => {
  // 创建 Cesium Viewer
  cesiumViewer = new CesiumViewer('cesiumContainer', {
    terrain: undefined,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: true,
    sceneModePicker: true,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    vrButton: false,
    selectionIndicator: true,
    infoBox: true,
  })

  const viewer = cesiumViewer.getViewer()

  // 飞到默认位置
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(116.4, 39.9, 5000000),
    duration: 0,
  })

  // 初始化模块
  objectPicker = new ObjectPicker(viewer)
  measurementEngine = new MeasurementEngine(viewer)

  // 监听鼠标移动
  const mouseHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
  mouseHandler.setInputAction((movement: any) => {
    const cartesian = viewer.camera.pickEllipsoid(movement.endPosition, viewer.scene.globe.ellipsoid)
    if (cartesian) {
      const carto = Cesium.Cartographic.fromCartesian(cartesian)
      store.setMouseCoords(
        Cesium.Math.toDegrees(carto.longitude).toFixed(6),
        Cesium.Math.toDegrees(carto.latitude).toFixed(6)
      )
    }
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

  // 监听相机变化
  const updateCameraHeight = () => {
    const h = viewer.camera.positionCartographic.height
    store.setCameraHeight(Math.round(h).toLocaleString())
  }
  viewer.scene.preRender.addEventListener(updateCameraHeight)
  updateCameraHeight()

  // 设置拾取处理器
  cesiumViewer.setPickHandler((feature, position) => {
    if (store.activeTool === 'pick' && feature) {
      const spatialObj = objectPicker!.extractSpatialObject(feature)
      // 使用识别 Agent 增强对象类型
      const recognitionAgent = new ObjectRecognitionAgent()
      const recognition = recognitionAgent.recognizeObject(spatialObj)
      spatialObj.type = recognition.type
      spatialObj.confidence = recognition.confidence
      store.addPickedObject(spatialObj)
      objectPicker!.highlightObject(feature, Cesium.Color.YELLOW)
      store.setStatusMessage(`拾取对象: ${spatialObj.name} (类型: ${spatialObj.type}, 置信度: ${(recognition.confidence * 100).toFixed(0)}%)`)
    } else if (feature) {
      // 非拾取模式，显示对象信息
      const carto = Cesium.Cartographic.fromCartesian(position)
      const lng = Cesium.Math.toDegrees(carto.longitude).toFixed(6)
      const lat = Cesium.Math.toDegrees(carto.latitude).toFixed(6)
      store.setStatusMessage(`选中要素 | 坐标: ${lng}, ${lat} | 高度: ${carto.height.toFixed(2)}m`)
    }
  })
})

onBeforeUnmount(() => {
  cleanupTool()
  cesiumViewer?.destroy()
})
</script>

<style scoped>
.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  font-family: 'Microsoft YaHei', 'PingFang SC', -apple-system, sans-serif;
}

/* ========== 顶部工具栏 ========== */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
  padding: 0 16px;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  color: #e0e6ed;
  flex-shrink: 0;
  z-index: 100;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
}

.app-title {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 1.5px;
  background: linear-gradient(90deg, #4fc3f7, #81d4fa);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.toolbar-center {
  display: flex;
  align-items: center;
  gap: 6px;
}

.toolbar-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 14px;
  font-size: 12px;
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 6px;
  background: rgba(255,255,255,0.08);
  color: #c0c8d4;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.toolbar-btn:hover {
  background: rgba(79, 195, 247, 0.3);
  color: #fff;
  border-color: rgba(79, 195, 247, 0.5);
}

.toolbar-btn.active {
  background: rgba(79, 195, 247, 0.4);
  color: #fff;
  border-color: #4fc3f7;
}

.toolbar-btn.primary {
  background: rgba(76, 175, 80, 0.3);
  border-color: rgba(76, 175, 80, 0.5);
  color: #a5d6a7;
}

.toolbar-btn.primary:hover:not(:disabled) {
  background: rgba(76, 175, 80, 0.5);
}

.toolbar-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-icon {
  font-size: 14px;
}

.toolbar-divider {
  width: 1px;
  height: 24px;
  background: rgba(255,255,255,0.15);
  margin: 0 4px;
}

.toolbar-info {
  font-size: 11px;
  color: #8899aa;
  font-family: 'Consolas', 'SF Mono', monospace;
}

/* ========== 主内容区 ========== */
.main-content {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.map-area {
  flex: 7;
  position: relative;
  overflow: hidden;
}

.cesium-container {
  width: 100%;
  height: 100%;
}

/* 地图浮层统计 */
.map-overlay-stats {
  position: absolute;
  top: 12px;
  left: 12px;
  display: flex;
  gap: 8px;
  z-index: 50;
}

.stat-badge {
  padding: 4px 12px;
  border-radius: 16px;
  font-size: 12px;
  font-weight: 600;
  backdrop-filter: blur(8px);
}

.stat-badge.pass { background: rgba(76,175,80,0.85); color: #fff; }
.stat-badge.fail { background: rgba(244,67,54,0.85); color: #fff; }
.stat-badge.warning { background: rgba(255,152,0,0.85); color: #fff; }
.stat-badge.rate { background: rgba(33,150,243,0.85); color: #fff; }

/* ========== 控制面板 ========== */
.control-panel {
  flex: 3;
  min-width: 320px;
  max-width: 420px;
  background: #f8f9fb;
  border-left: 1px solid #e0e3e8;
  overflow-y: auto;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
}

/* Tab 切换 */
.panel-tabs {
  display: flex;
  background: #eaedf1;
  border-bottom: 1px solid #d0d5dd;
  flex-shrink: 0;
}

.tab-btn {
  flex: 1;
  padding: 10px 4px;
  font-size: 12px;
  border: none;
  background: transparent;
  color: #5a6a7a;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.tab-btn:hover {
  background: rgba(79, 195, 247, 0.1);
}

.tab-btn.active {
  background: #f8f9fb;
  color: #1976d2;
  font-weight: 600;
  border-bottom: 2px solid #1976d2;
}

.tab-content {
  flex: 1;
  overflow-y: auto;
}

.panel-section {
  border-bottom: 1px solid #e8eaed;
}

.panel-title {
  margin: 0;
  padding: 12px 16px;
  font-size: 13px;
  font-weight: 600;
  color: #1e2a3a;
  background: #f0f2f5;
  border-bottom: 1px solid #e8eaed;
}

.panel-body {
  padding: 12px 16px;
}

.result-empty {
  text-align: center;
  color: #99a3ae;
  font-size: 12px;
  padding: 20px 10px;
  line-height: 1.6;
}

/* 规则卡片 */
.rule-card {
  padding: 10px 12px;
  margin-bottom: 8px;
  border: 1px solid #e0e3e8;
  border-radius: 6px;
  background: #fff;
  transition: box-shadow 0.2s;
}

.rule-card:hover {
  box-shadow: 0 1px 4px rgba(0,0,0,0.08);
}

.rule-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.rule-name {
  font-size: 13px;
  font-weight: 600;
  color: #1e2a3a;
}

.rule-severity {
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
}

.rule-severity.error { background: #ffebee; color: #c62828; }
.rule-severity.warning { background: #fff8e1; color: #f57f17; }
.rule-severity.info { background: #e3f2fd; color: #1565c0; }

.rule-condition {
  font-family: 'Consolas', monospace;
  font-size: 12px;
  color: #4caf50;
  background: #f5f5f5;
  padding: 2px 6px;
  border-radius: 3px;
  margin-bottom: 4px;
}

.rule-desc {
  font-size: 11px;
  color: #8899aa;
}

/* 对象卡片 */
.object-card {
  padding: 10px 12px;
  margin-bottom: 6px;
  border: 1px solid #e0e3e8;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  transition: all 0.15s;
}

.object-card:hover {
  border-color: #4fc3f7;
}

.object-card.selected {
  border-color: #1976d2;
  background: #e3f2fd;
}

.obj-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.obj-type-badge {
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  background: #e3f2fd;
  color: #1565c0;
}

.obj-name {
  font-size: 13px;
  color: #333;
}

.obj-info {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #8899aa;
}

/* 结果卡片 */
.result-card {
  padding: 10px 12px;
  margin-bottom: 8px;
  border-radius: 6px;
  border-left: 4px solid #ccc;
  background: #fff;
}

.result-card.pass { border-left-color: #4caf50; }
.result-card.fail { border-left-color: #f44336; }
.result-card.warning { border-left-color: #ff9800; }

.result-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.status-badge {
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
}

.status-badge.pass { background: #4caf50; }
.status-badge.fail { background: #f44336; }
.status-badge.warning { background: #ff9800; }

.result-type {
  font-size: 12px;
  color: #5a6a7a;
}

.violations {
  margin-top: 4px;
}

.violation-item {
  font-size: 12px;
  color: #c62828;
  padding: 2px 0;
}

.no-violation {
  font-size: 12px;
  color: #4caf50;
}

/* 测量数据 */
.measurement-item {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px solid #f0f0f0;
  font-size: 12px;
}

.m-type {
  color: #5a6a7a;
  text-transform: capitalize;
}

.m-value {
  font-weight: 600;
  color: #1e2a3a;
  font-family: 'Consolas', monospace;
}

/* Agent 工作流 */
.workflow-diagram {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.agent-node {
  width: 100%;
  text-align: center;
  padding: 10px;
  border-radius: 8px;
  border: 2px solid #e0e3e8;
  background: #fff;
  position: relative;
}

.agent-node.running {
  border-color: #2196f3;
  background: #e3f2fd;
}

.agent-node.completed {
  border-color: #4caf50;
  background: #e8f5e9;
}

.agent-node.error {
  border-color: #f44336;
  background: #ffebee;
}

.agent-icon {
  font-size: 20px;
}

.agent-name {
  font-size: 12px;
  font-weight: 600;
  color: #1e2a3a;
  margin: 2px 0;
}

.agent-progress {
  width: 100%;
  height: 4px;
  background: #e0e0e0;
  border-radius: 2px;
  margin: 4px 0;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  background: linear-gradient(90deg, #2196f3, #4fc3f7);
  border-radius: 2px;
  transition: width 0.3s;
}

.agent-status {
  font-size: 11px;
  color: #5a6a7a;
}

.agent-arrow {
  font-size: 16px;
  color: #bdbdbd;
  line-height: 1;
}

/* 报告摘要 */
.report-summary h4 {
  margin: 0 0 4px;
  font-size: 14px;
  color: #1e2a3a;
}

.report-meta {
  font-size: 11px;
  color: #8899aa;
  margin-bottom: 12px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-bottom: 12px;
}

.summary-card {
  text-align: center;
  padding: 12px 8px;
  border-radius: 8px;
}

.summary-card.total { background: #e3f2fd; }
.summary-card.pass { background: #e8f5e9; }
.summary-card.fail { background: #ffebee; }
.summary-card.warning { background: #fff8e1; }

.summary-number {
  font-size: 24px;
  font-weight: 700;
}

.summary-card.total .summary-number { color: #1565c0; }
.summary-card.pass .summary-number { color: #2e7d32; }
.summary-card.fail .summary-number { color: #c62828; }
.summary-card.warning .summary-number { color: #ef6c00; }

.summary-label {
  font-size: 11px;
  color: #5a6a7a;
  margin-top: 2px;
}

.compliance-bar {
  margin-bottom: 12px;
}

.bar-label {
  font-size: 12px;
  font-weight: 600;
  color: #1e2a3a;
  margin-bottom: 4px;
}

.bar-track {
  width: 100%;
  height: 8px;
  background: #e0e0e0;
  border-radius: 4px;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #4caf50, #8bc34a);
  border-radius: 4px;
  transition: width 0.5s;
}

.report-actions {
  display: flex;
  gap: 8px;
}

.action-btn {
  flex: 1;
  padding: 8px 12px;
  font-size: 12px;
  border: none;
  border-radius: 6px;
  background: #1976d2;
  color: #fff;
  cursor: pointer;
  transition: background 0.2s;
}

.action-btn:hover {
  background: #1565c0;
}

.action-btn.secondary {
  background: #546e7a;
}

.action-btn.secondary:hover {
  background: #37474f;
}

/* ========== 底部状态栏 ========== */
.statusbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 28px;
  padding: 0 16px;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  color: #7a8a9a;
  font-size: 11px;
  flex-shrink: 0;
  z-index: 100;
}
</style>
