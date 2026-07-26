<script setup lang="ts">
import { useAppStore } from '../store/appStore'
import type { ShapeCategory } from '../core/types'

const props = defineProps<{ onFlyTo: (id: string) => void }>()
const store = useAppStore()

const TYPE_LABEL: Record<string, string> = {
  door: '门', window: '窗', building: '建筑', fence: '围栏',
  pole: '杆体', road: '道路', tree: '树木', ground: '地面', unknown: '未知'
}

const SHAPE_LABEL: Record<ShapeCategory, string> = {
  box: '立方体', cylinder: '圆柱体', sphere: '球体',
  plane: '平面', line: '线状', pyramid: '锥体', irregular: '不规则'
}

function statusClass(s: string): string {
  return s === 'FAIL' ? 'st-fail' : s === 'WARN' ? 'st-warn' : 'st-pass'
}
</script>

<template>
  <div class="panel">
    <h3>检测对象（{{ store.results.length }}）</h3>
    <div v-if="store.results.length === 0" class="empty">
      暂无结果。加载瓦片后，点击模型表面进行分析，或使用自动扫描。
    </div>
    <div
      v-for="r in store.results"
      :key="r.objectId"
      class="obj-item"
      :class="{ active: store.selectedId === r.objectId }"
      @click="store.select(r.objectId); props.onFlyTo(r.objectId)"
    >
      <div class="obj-head">
        <span class="badge" :class="statusClass(r.compliance.status)">{{ r.compliance.status }}</span>
        <b>{{ TYPE_LABEL[r.objectType] ?? r.objectType }}</b>
        <span v-if="r.bbox.shape" class="shape-badge">{{ SHAPE_LABEL[r.bbox.shape.category] }}</span>
        <span class="conf">{{ (r.confidence * 100).toFixed(0) }}%</span>
      </div>
      <div class="dims">
        {{ r.bbox.length.toFixed(2) }} × {{ r.bbox.width.toFixed(2) }} × {{ r.bbox.height.toFixed(2) }} m
      </div>
      <!-- 形状描述子详情 -->
      <div v-if="r.bbox.shape" class="shape-desc">
        <span class="shape-tag">线性度 {{ r.bbox.shape.linearity.toFixed(2) }}</span>
        <span class="shape-tag">平面度 {{ r.bbox.shape.planarity.toFixed(2) }}</span>
        <span class="shape-tag">散射度 {{ r.bbox.shape.scattering.toFixed(2) }}</span>
        <span class="shape-tag">球度 {{ r.bbox.shape.sphericity.toFixed(2) }}</span>
        <span class="shape-tag" :class="{ 'fill-low': r.bbox.shape.fillFactor < 0.5 }">
          填充率 {{ r.bbox.shape.fillFactor.toFixed(2) }}
        </span>
      </div>
      <!-- 识别候选 -->
      <div v-if="r.alternatives && r.alternatives.length > 0" class="alternatives">
        <span class="alt-label">候选：</span>
        <span
          v-for="alt in r.alternatives"
          :key="alt.type"
          class="alt-tag"
        >{{ TYPE_LABEL[alt.type] ?? alt.type }} ({{ (alt.confidence * 100).toFixed(0) }}%)</span>
      </div>
      <!-- 识别理由 -->
      <div v-if="r.recognitionReasons && r.recognitionReasons.length > 0" class="reasons">
        <span v-for="(reason, i) in r.recognitionReasons" :key="i" class="reason-item">{{ reason }}</span>
      </div>
      <ul v-if="r.compliance.violations.length" class="viol">
        <li v-for="(v, i) in r.compliance.violations" :key="i">
          {{ v.rule }}：实测 {{ v.actual }}，要求 {{ v.expected }}
        </li>
      </ul>
      <div v-if="Object.keys(r.compliance.derived).length" class="derived">
        推导：{{ Object.entries(r.compliance.derived).map(([k, v]) => `${k}=${v}`).join('，') }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel { padding: 10px; overflow-y: auto; flex: 1; }
h3 { margin: 4px 0 10px; font-size: 14px; color: #9ecbff; }
.empty { color: #7a8699; font-size: 12px; line-height: 1.8; }
.obj-item {
  background: #16202e; border: 1px solid #263449; border-radius: 6px;
  padding: 8px; margin-bottom: 8px; cursor: pointer; font-size: 12px;
}
.obj-item.active, .obj-item:hover { border-color: #4d9fff; }
.obj-head { display: flex; align-items: center; gap: 8px; }
.badge { padding: 1px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; }
.st-fail { background: #e53935; color: #fff; }
.st-warn { background: #fbc02d; color: #222; }
.st-pass { background: #43a047; color: #fff; }
.shape-badge {
  padding: 1px 6px; border-radius: 4px; font-size: 11px;
  background: #2a3f5f; color: #8ab4f8;
}
.conf { margin-left: auto; color: #7a8699; }
.dims { color: #aebdd1; margin-top: 4px; }
.shape-desc {
  margin-top: 4px; display: flex; flex-wrap: wrap; gap: 4px;
}
.shape-tag {
  font-size: 10px; padding: 1px 5px; border-radius: 3px;
  background: #1a2738; color: #7a8699;
}
.shape-tag.fill-low {
  background: #3d2a1a; color: #ffb74d;
}
.alternatives {
  margin-top: 4px; display: flex; flex-wrap: wrap; gap: 4px; align-items: center;
}
.alt-label { font-size: 10px; color: #7a8699; }
.alt-tag {
  font-size: 10px; padding: 1px 5px; border-radius: 3px;
  background: #1e2d3f; color: #64b5f6;
}
.reasons {
  margin-top: 4px;
}
.reason-item {
  display: block; font-size: 10px; color: #7a8699; line-height: 1.6;
}
.viol { margin: 6px 0 0; padding-left: 16px; color: #ff9d9d; }
.derived { margin-top: 4px; color: #ffd54f; }
</style>
