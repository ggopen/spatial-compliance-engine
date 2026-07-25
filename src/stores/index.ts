import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  SpatialObject,
  MeasurementResult,
  ComplianceResult,
  SpatialAnnotation,
  AnalysisReport,
  AgentState,
  ComplianceRule,
} from '../types'

export const useAppStore = defineStore('app', () => {
  // ========== 3D Tiles 状态 ==========
  const tilesetUrl = ref('https://data.mars3d.cn/3dtiles/qx-simiao/tileset.json')
  const tilesetLoaded = ref(false)
  const tilesetLoading = ref(false)

  // ========== 拾取对象 ==========
  const pickedObjects = ref<SpatialObject[]>([])
  const selectedObjectId = ref<string | null>(null)

  // ========== 测量结果 ==========
  const measurements = ref<MeasurementResult[]>([])

  // ========== 合规规则 ==========
  const rules = ref<ComplianceRule[]>([])
  const customRules = ref<ComplianceRule[]>([])

  // ========== 合规结果 ==========
  const complianceResults = ref<ComplianceResult[]>([])

  // ========== 标注 ==========
  const annotations = ref<SpatialAnnotation[]>([])

  // ========== 报告 ==========
  const currentReport = ref<AnalysisReport | null>(null)

  // ========== Agent 状态 ==========
  const agentStates = ref<AgentState[]>([])

  // ========== UI 状态 ==========
  const isWorkflowRunning = ref(false)
  const activeTool = ref<string | null>(null) // 'pick' | 'measure_distance' | 'measure_height' | null
  const sidebarTab = ref<string>('rules') // 'rules' | 'results' | 'agents' | 'report'
  const statusMessage = ref('就绪')
  const cameraHeight = ref<string>('--')
  const mouseCoords = ref({ lng: '--', lat: '--' })

  // ========== 计算属性 ==========
  const totalObjects = computed(() => pickedObjects.value.length)
  const passCount = computed(() => complianceResults.value.filter(r => r.status === 'PASS').length)
  const failCount = computed(() => complianceResults.value.filter(r => r.status === 'FAIL').length)
  const warningCount = computed(() => complianceResults.value.filter(r => r.status === 'WARNING').length)
  const complianceRate = computed(() => {
    const total = complianceResults.value.length
    if (total === 0) return 0
    return Math.round((passCount.value / total) * 10000) / 100
  })

  // ========== Actions ==========
  function setTilesetLoaded(loaded: boolean) {
    tilesetLoaded.value = loaded
  }
  function setTilesetLoading(loading: boolean) {
    tilesetLoading.value = loading
  }

  function addPickedObject(obj: SpatialObject) {
    const exists = pickedObjects.value.find(o => o.id === obj.id)
    if (!exists) {
      pickedObjects.value.push(obj)
    }
  }

  function selectObject(id: string | null) {
    selectedObjectId.value = id
  }

  function addMeasurements(results: MeasurementResult[]) {
    measurements.value.push(...results)
  }

  function setComplianceResults(results: ComplianceResult[]) {
    complianceResults.value = results
  }

  function setAnnotations(anns: SpatialAnnotation[]) {
    annotations.value = anns
  }

  function setCurrentReport(report: AnalysisReport) {
    currentReport.value = report
  }

  function setAgentStates(states: AgentState[]) {
    agentStates.value = states
  }

  function setWorkflowRunning(running: boolean) {
    isWorkflowRunning.value = running
  }

  function setActiveTool(tool: string | null) {
    activeTool.value = tool
  }

  function setSidebarTab(tab: string) {
    sidebarTab.value = tab
  }

  function setStatusMessage(msg: string) {
    statusMessage.value = msg
  }

  function setCameraHeight(h: string) {
    cameraHeight.value = h
  }

  function setMouseCoords(lng: string, lat: string) {
    mouseCoords.value = { lng, lat }
  }

  function reset() {
    pickedObjects.value = []
    selectedObjectId.value = null
    measurements.value = []
    complianceResults.value = []
    annotations.value = []
    currentReport.value = null
    isWorkflowRunning.value = false
    activeTool.value = null
    statusMessage.value = '就绪'
  }

  return {
    // State
    tilesetUrl,
    tilesetLoaded,
    tilesetLoading,
    pickedObjects,
    selectedObjectId,
    measurements,
    rules,
    customRules,
    complianceResults,
    annotations,
    currentReport,
    agentStates,
    isWorkflowRunning,
    activeTool,
    sidebarTab,
    statusMessage,
    cameraHeight,
    mouseCoords,
    // Computed
    totalObjects,
    passCount,
    failCount,
    warningCount,
    complianceRate,
    // Actions
    setTilesetLoaded,
    setTilesetLoading,
    addPickedObject,
    selectObject,
    addMeasurements,
    setComplianceResults,
    setAnnotations,
    setCurrentReport,
    setAgentStates,
    setWorkflowRunning,
    setActiveTool,
    setSidebarTab,
    setStatusMessage,
    setCameraHeight,
    setMouseCoords,
    reset,
  }
})
