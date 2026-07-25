import * as Cesium from 'cesium';
import type {
  SpatialObject, MeasurementResult, ComplianceResult,
  AnalysisReport, AgentState
} from '../types';
import { ObjectRecognitionAgent } from './ObjectRecognitionAgent';
import { MeasurementAgent } from './MeasurementAgent';
import { ComplianceAgent } from './ComplianceAgent';
import { AnnotationAgent } from './AnnotationAgent';
import { ReportAgent } from './ReportAgent';
import { MeasurementEngine } from '../measurement';
import { RuleEngine } from '../rules';
import { AnnotationEngine } from '../annotation';
import { ReportEngine } from '../services';

// 工作流进度回调
export type WorkflowProgressCallback = (agent: string, status: string, progress: number, message: string) => void;

export class WorkflowOrchestrator {
  private recognitionAgent: ObjectRecognitionAgent;
  private measurementAgent: MeasurementAgent;
  private complianceAgent: ComplianceAgent;
  private annotationAgent: AnnotationAgent;
  private reportAgent: ReportAgent;
  
  private agents: Map<string, AgentState> = new Map();
  private currentReport: AnalysisReport | null = null;
  
  constructor(viewer: Cesium.Viewer, _sceneUrl: string) {
    const measurementEngine = new MeasurementEngine(viewer);
    const ruleEngine = new RuleEngine();
    const annotationEngine = new AnnotationEngine(viewer);
    const reportEngine = new ReportEngine();
    
    this.measurementAgent = new MeasurementAgent(measurementEngine);
    this.recognitionAgent = new ObjectRecognitionAgent();
    this.complianceAgent = new ComplianceAgent(ruleEngine);
    this.annotationAgent = new AnnotationAgent(annotationEngine);
    this.reportAgent = new ReportAgent(reportEngine);
    
    // 初始化预设规则
    ruleEngine.loadPresetRules();
    
    // 初始化 Agent 状态
    this.initAgents();
  }
  
  private initAgents(): void {
    const agentNames = [
      'Object Recognition',
      'Measurement',
      'Compliance',
      'Annotation',
      'Report',
    ];
    
    for (const name of agentNames) {
      this.agents.set(name, {
        id: name.toLowerCase().replace(/\s+/g, '_'),
        name,
        status: 'idle',
        progress: 0,
        message: '等待执行',
      });
    }
  }
  
  // 执行完整工作流
  async executeWorkflow(
    objects: SpatialObject[],
    clickPoints: Map<string, Cesium.Cartesian3[]>,
    sceneUrl: string,
    onProgress?: WorkflowProgressCallback
  ): Promise<AnalysisReport> {
    const measurementsMap = new Map<string, MeasurementResult[]>();
    const complianceResults: ComplianceResult[] = [];
    
    // Step 1: 对象识别
    this.updateAgentState('Object Recognition', 'running', 0, '识别对象类型...');
    onProgress?.('Object Recognition', 'running', 0, '识别对象类型...');
    
    const recognizedObjects: SpatialObject[] = [];
    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i];
      const recognition = this.recognitionAgent.recognizeObject(obj);
      obj.type = recognition.type;
      obj.confidence = recognition.confidence;
      recognizedObjects.push(obj);
      
      this.updateAgentState('Object Recognition', 'running', 
        Math.round(((i + 1) / objects.length) * 100), 
        `已识别 ${i + 1}/${objects.length}`
      );
      onProgress?.('Object Recognition', 'running', 
        Math.round(((i + 1) / objects.length) * 100),
        `已识别 ${i + 1}/${objects.length}`
      );
      
      // 模拟异步处理延迟
      await this.delay(50);
    }
    
    this.updateAgentState('Object Recognition', 'completed', 100, `识别完成，共 ${objects.length} 个对象`);
    onProgress?.('Object Recognition', 'completed', 100, `识别完成`);
    
    // Step 2: 测量
    this.updateAgentState('Measurement', 'running', 0, '执行测量...');
    onProgress?.('Measurement', 'running', 0, '执行测量...');
    
    for (let i = 0; i < recognizedObjects.length; i++) {
      const obj = recognizedObjects[i];
      const points = clickPoints.get(obj.id) || [];
      const measurements = this.measurementAgent.performMeasurements(obj, points);
      measurementsMap.set(obj.id, measurements);
      
      this.updateAgentState('Measurement', 'running',
        Math.round(((i + 1) / recognizedObjects.length) * 100),
        `已测量 ${i + 1}/${recognizedObjects.length}`
      );
      onProgress?.('Measurement', 'running',
        Math.round(((i + 1) / recognizedObjects.length) * 100),
        `已测量 ${i + 1}/${recognizedObjects.length}`
      );
      
      await this.delay(50);
    }
    
    this.updateAgentState('Measurement', 'completed', 100, `测量完成`);
    onProgress?.('Measurement', 'completed', 100, '测量完成');
    
    // Step 3: 合规分析
    this.updateAgentState('Compliance', 'running', 0, '合规检查...');
    onProgress?.('Compliance', 'running', 0, '合规检查...');
    
    const results = this.complianceAgent.analyze(recognizedObjects, measurementsMap);
    complianceResults.push(...results);
    
    this.updateAgentState('Compliance', 'completed', 100, `检查完成`);
    onProgress?.('Compliance', 'completed', 100, '检查完成');
    
    // Step 4: 标注
    this.updateAgentState('Annotation', 'running', 0, '创建标注...');
    onProgress?.('Annotation', 'running', 0, '创建标注...');
    
    const positions = new Map<string, { longitude: number; latitude: number; height: number }>();
    for (const obj of recognizedObjects) {
      positions.set(obj.id, obj.position);
    }
    const annotations = this.annotationAgent.createComplianceAnnotations(complianceResults, positions);
    
    this.updateAgentState('Annotation', 'completed', 100, `标注完成，共 ${annotations.length} 个`);
    onProgress?.('Annotation', 'completed', 100, '标注完成');
    
    // Step 5: 报告生成
    this.updateAgentState('Report', 'running', 0, '生成报告...');
    onProgress?.('Report', 'running', 0, '生成报告...');
    
    // 收集所有测量结果
    const allMeasurements: MeasurementResult[] = [];
    measurementsMap.forEach(measurements => {
      allMeasurements.push(...measurements);
    });
    
    this.currentReport = this.reportAgent.generateReport({
      sceneUrl,
      objects: recognizedObjects,
      measurements: allMeasurements,
      complianceResults,
      annotations,
    });
    
    this.updateAgentState('Report', 'completed', 100, '报告生成完成');
    onProgress?.('Report', 'completed', 100, '报告生成完成');
    
    return this.currentReport;
  }
  
  // 获取当前报告
  getCurrentReport(): AnalysisReport | null {
    return this.currentReport;
  }
  
  // 获取所有 Agent 状态
  getAgentStates(): AgentState[] {
    return Array.from(this.agents.values());
  }
  
  // 更新 Agent 状态
  private updateAgentState(name: string, status: 'idle' | 'running' | 'completed' | 'error', progress: number, message: string): void {
    const agent = this.agents.get(name);
    if (agent) {
      agent.status = status;
      agent.progress = progress;
      agent.message = message;
      if (status === 'running') agent.startTime = new Date();
      if (status === 'completed' || status === 'error') agent.endTime = new Date();
    }
  }
  
  // 延迟工具
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  // 重置
  reset(): void {
    this.annotationAgent.clearAnnotations();
    this.currentReport = null;
    this.agents.forEach(agent => {
      agent.status = 'idle';
      agent.progress = 0;
      agent.message = '等待执行';
      agent.startTime = undefined;
      agent.endTime = undefined;
    });
  }
}
