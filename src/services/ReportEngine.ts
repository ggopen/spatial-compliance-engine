import type { AnalysisReport, ReportSummary, SpatialObject, MeasurementResult, ComplianceResult, SpatialAnnotation } from '../types';

export class ReportEngine {
  // 生成完整分析报告
  generateReport(params: {
    title?: string;
    sceneUrl: string;
    objects: SpatialObject[];
    measurements: MeasurementResult[];
    complianceResults: ComplianceResult[];
    annotations: SpatialAnnotation[];
  }): AnalysisReport {
    const summary = this.calculateSummary(
      params.objects,
      params.complianceResults
    );

    return {
      id: `report_${Date.now()}`,
      title: params.title || `空间合规分析报告 - ${new Date().toLocaleString('zh-CN')}`,
      createdAt: new Date(),
      sceneUrl: params.sceneUrl,
      objects: params.objects,
      measurements: params.measurements,
      complianceResults: params.complianceResults,
      annotations: params.annotations,
      summary,
    };
  }

  // 计算报告摘要
  private calculateSummary(objects: SpatialObject[], results: ComplianceResult[]): ReportSummary {
    const passCount = results.filter(r => r.status === 'PASS').length;
    const failCount = results.filter(r => r.status === 'FAIL').length;
    const warningCount = results.filter(r => r.status === 'WARNING').length;
    const total = results.length || objects.length;

    return {
      totalObjects: objects.length,
      passCount,
      failCount,
      warningCount,
      complianceRate: total > 0 ? Math.round((passCount / total) * 10000) / 100 : 0,
    };
  }

  // 导出为 JSON
  exportJSON(report: AnalysisReport): string {
    return JSON.stringify(report, null, 2);
  }

  // 导出为 HTML 报告
  exportHTML(report: AnalysisReport): string {
    const { summary } = report;

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${report.title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Microsoft YaHei', sans-serif; padding: 40px; background: #f5f5f5; }
    .report { max-width: 1000px; margin: 0 auto; background: #fff; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    h1 { text-align: center; color: #1a1a2e; margin-bottom: 10px; font-size: 24px; }
    .meta { text-align: center; color: #666; margin-bottom: 30px; font-size: 14px; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-bottom: 30px; }
    .stat-card { text-align: center; padding: 20px; border-radius: 8px; }
    .stat-card.total { background: #e3f2fd; }
    .stat-card.pass { background: #e8f5e9; }
    .stat-card.fail { background: #ffebee; }
    .stat-card.warning { background: #fff8e1; }
    .stat-number { font-size: 32px; font-weight: bold; }
    .stat-label { font-size: 14px; color: #666; margin-top: 5px; }
    .section { margin-bottom: 30px; }
    .section h2 { font-size: 18px; color: #1a1a2e; border-bottom: 2px solid #e0e0e0; padding-bottom: 10px; margin-bottom: 15px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #eee; }
    th { background: #f5f5f5; font-weight: 600; }
    .status-badge { padding: 3px 10px; border-radius: 12px; font-size: 12px; color: #fff; }
    .status-pass { background: #4caf50; }
    .status-fail { background: #f44336; }
    .status-warning { background: #ff9800; }
    .violation { color: #f44336; font-size: 13px; }
  </style>
</head>
<body>
  <div class="report">
    <h1>${report.title}</h1>
    <div class="meta">生成时间: ${report.createdAt.toLocaleString('zh-CN')} | 场景: ${report.sceneUrl}</div>

    <div class="summary">
      <div class="stat-card total">
        <div class="stat-number">${summary.totalObjects}</div>
        <div class="stat-label">总对象数</div>
      </div>
      <div class="stat-card pass">
        <div class="stat-number">${summary.passCount}</div>
        <div class="stat-label">合规</div>
      </div>
      <div class="stat-card fail">
        <div class="stat-number">${summary.failCount}</div>
        <div class="stat-label">违规</div>
      </div>
      <div class="stat-card warning">
        <div class="stat-number">${summary.warningCount}</div>
        <div class="stat-label">警告</div>
      </div>
    </div>

    <div class="section">
      <h2>合规率: ${summary.complianceRate}%</h2>
      <div style="background:#eee;height:20px;border-radius:10px;overflow:hidden;">
        <div style="width:${summary.complianceRate}%;height:100%;background:linear-gradient(90deg,#4caf50,#8bc34a);border-radius:10px;"></div>
      </div>
    </div>

    <div class="section">
      <h2>合规检查结果</h2>
      <table>
        <thead>
          <tr><th>对象ID</th><th>类型</th><th>状态</th><th>违规详情</th></tr>
        </thead>
        <tbody>
          ${report.complianceResults.map(r => `
            <tr>
              <td>${r.objectId}</td>
              <td>${r.objectType}</td>
              <td><span class="status-badge status-${r.status.toLowerCase()}">${r.status}</span></td>
              <td>${r.violations.length > 0 ? r.violations.map(v => `<div class="violation">${v.message}</div>`).join('') : '无'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div class="section">
      <h2>测量数据</h2>
      <table>
        <thead>
          <tr><th>对象ID</th><th>测量类型</th><th>数值</th><th>单位</th></tr>
        </thead>
        <tbody>
          ${report.measurements.map(m => `
            <tr>
              <td>${m.objectId}</td>
              <td>${m.type}</td>
              <td>${m.value}</td>
              <td>${m.unit}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>`;
  }

  // 下载 HTML 报告
  downloadHTMLReport(report: AnalysisReport): void {
    const html = this.exportHTML(report);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${report.title}.html`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // 下载 JSON 报告
  downloadJSONReport(report: AnalysisReport): void {
    const json = this.exportJSON(report);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${report.title}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
}
