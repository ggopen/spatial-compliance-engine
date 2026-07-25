import { ReportEngine } from '../services';
import type { AnalysisReport, SpatialObject, MeasurementResult, ComplianceResult, SpatialAnnotation } from '../types';

export class ReportAgent {
  private reportEngine: ReportEngine;
  
  constructor(reportEngine: ReportEngine) {
    this.reportEngine = reportEngine;
  }
  
  // 生成报告
  generateReport(params: {
    sceneUrl: string;
    objects: SpatialObject[];
    measurements: MeasurementResult[];
    complianceResults: ComplianceResult[];
    annotations: SpatialAnnotation[];
  }): AnalysisReport {
    return this.reportEngine.generateReport(params);
  }
  
  // 导出 HTML
  exportHTML(report: AnalysisReport): string {
    return this.reportEngine.exportHTML(report);
  }
  
  // 导出 JSON
  exportJSON(report: AnalysisReport): string {
    return this.reportEngine.exportJSON(report);
  }
  
  // 下载 HTML
  downloadHTML(report: AnalysisReport): void {
    this.reportEngine.downloadHTMLReport(report);
  }
  
  // 下载 JSON
  downloadJSON(report: AnalysisReport): void {
    this.reportEngine.downloadJSONReport(report);
  }
}
