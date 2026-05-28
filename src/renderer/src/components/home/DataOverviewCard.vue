<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronDown, Clock, Crosshair, Film } from 'lucide-vue-next'
import type { HomeStatsSummary, StatsRangeDays, TrendMetric, TrendPoint } from '../../lib/match-stats'
import { formatDurationSeconds } from '../../lib/time-format'
import TrendAreaChart from './TrendAreaChart.vue'

const props = defineProps<{
  stats: HomeStatsSummary
  series: TrendPoint[]
  loading: boolean
}>()

const rangeOpen = ref(false)
const rangeDays = defineModel<StatsRangeDays>('rangeDays', { required: true })
const activeMetric = ref<TrendMetric>('clips')

const rangeLabel = computed(() => {
  if (rangeDays.value === 7) return '近 7 天'
  if (rangeDays.value === 90) return '近 90 天'
  return '近 30 天'
})

const metricTabs: {
  id: TrendMetric
  label: string
  icon: typeof Film
}[] = [
  { id: 'clips', label: '片段数', icon: Film },
  { id: 'duration', label: '录制时长', icon: Clock },
  { id: 'kills', label: '击杀片段', icon: Crosshair }
]

const metricGliderIndex = computed(() =>
  Math.max(
    0,
    metricTabs.findIndex((t) => t.id === activeMetric.value)
  )
)

function selectRange(days: StatsRangeDays): void {
  rangeDays.value = days
  rangeOpen.value = false
}

const recordingLabel = computed(() => formatDurationSeconds(props.stats.recordingSeconds))
</script>

<template>
  <section class="panel-card">
    <header class="card-header">
      <h2 class="card-title">数据概览</h2>
      <div class="range-wrap">
        <button
          type="button"
          class="range-trigger"
          :aria-expanded="rangeOpen"
          @click="rangeOpen = !rangeOpen"
        >
          <span>{{ rangeLabel }}</span>
          <ChevronDown :size="14" class="chevron" :class="{ open: rangeOpen }" />
        </button>
        <Transition name="menu-fade">
          <div v-if="rangeOpen" class="range-menu">
            <button type="button" class="menu-item" @click="selectRange(7)">近 7 天</button>
            <button type="button" class="menu-item" @click="selectRange(30)">近 30 天</button>
            <button type="button" class="menu-item" @click="selectRange(90)">近 90 天</button>
          </div>
        </Transition>
      </div>
    </header>

    <div class="overview-body">
      <div class="metrics-col" :class="{ loading }">
        <div class="metric-card metric-card--duration">
          <Clock class="metric-icon metric-icon--duration" :size="15" :stroke-width="1.75" />
          <div class="metric-body">
            <span class="metric-value">{{ recordingLabel }}</span>
            <span class="metric-label">录制时长</span>
          </div>
        </div>
        <div class="metric-card metric-card--clips">
          <Film class="metric-icon metric-icon--clips" :size="15" :stroke-width="1.75" />
          <div class="metric-body">
            <span class="metric-value">{{ stats.clipCount }}</span>
            <span class="metric-label">生成片段</span>
          </div>
        </div>
        <div class="metric-card metric-card--kills">
          <Crosshair class="metric-icon metric-icon--kills" :size="15" :stroke-width="1.75" />
          <div class="metric-body">
            <span class="metric-value">{{ stats.killClipCount }}</span>
            <span class="metric-label">击杀片段</span>
          </div>
        </div>
      </div>

      <div class="chart-block">
        <div class="metric-switch-row">
          <div
            class="metric-switch"
            role="tablist"
            aria-label="图表指标"
            :style="{ '--metric-glider-index': metricGliderIndex }"
          >
            <span class="metric-glider" aria-hidden="true" />
            <button
              v-for="tab in metricTabs"
              :key="tab.id"
              type="button"
              role="tab"
              class="metric-switch-btn"
              :class="[
                `metric-switch-btn--${tab.id}`,
                { active: activeMetric === tab.id }
              ]"
              :aria-selected="activeMetric === tab.id"
              @click="activeMetric = tab.id"
            >
              <component
                :is="tab.icon"
                class="metric-switch-icon"
                :size="11"
                :stroke-width="2"
                aria-hidden="true"
              />
              <span class="metric-switch-label">{{ tab.label }}</span>
            </button>
          </div>
        </div>
        <TrendAreaChart :series="series" :metric="activeMetric" compact />
      </div>
    </div>
  </section>
</template>

<style scoped>
.panel-card {
  min-width: 0;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
  flex-shrink: 0;
}

.card-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.2;
}

.range-wrap {
  position: relative;
}

.range-trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    color 0.2s ease;
}

.range-trigger:hover {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.06);
}

.chevron {
  transition: transform 0.2s ease;
}

.chevron.open {
  transform: rotate(180deg);
}

.range-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 7.5rem;
  padding: 4px;
  border-radius: 10px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
  z-index: 20;
}

.menu-item {
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.menu-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.overview-body {
  display: grid;
  grid-template-columns: 118px 1fr;
  gap: 10px;
  flex: 1;
  min-height: 0;
  align-items: stretch;
}

.metrics-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
  transition: opacity 0.2s ease;
}

.metrics-col.loading {
  opacity: 0.65;
}

.metric-card {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border-color);
  min-width: 0;
  min-height: 0;
}

.metric-icon {
  flex-shrink: 0;
}

.metric-icon--duration {
  color: #38bdf8;
}

.metric-icon--clips {
  color: #a5b4fc;
}

.metric-icon--kills {
  color: #f87171;
}

.metric-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.metric-value {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.2;
}

.metric-label {
  font-size: 10px;
  color: var(--text-muted);
  line-height: 1.2;
}

.chart-block {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  padding: 0;
  background: transparent;
  border: none;
}

.metric-switch-row {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 6px;
  flex-shrink: 0;
}

.metric-switch {
  --metric-pad: 2px;
  --metric-spring: cubic-bezier(0.34, 1.22, 0.64, 1);
  position: relative;
  display: inline-flex;
  align-items: stretch;
  width: max-content;
  max-width: 100%;
  padding: var(--metric-pad);
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.32);
  border: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

.metric-glider {
  position: absolute;
  top: var(--metric-pad);
  bottom: var(--metric-pad);
  left: var(--metric-pad);
  width: calc((100% - 2 * var(--metric-pad)) / 3);
  border-radius: 999px;
  background: rgba(99, 102, 241, 0.35);
  box-shadow:
    0 1px 4px rgba(99, 102, 241, 0.25),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
  transform: translateX(calc(var(--metric-glider-index, 0) * 100%));
  transition: transform 0.28s var(--metric-spring);
  pointer-events: none;
}

.metric-switch-btn {
  position: relative;
  z-index: 1;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 22px;
  flex: 0 0 4.35rem;
  width: 4.35rem;
  padding: 0 4px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition:
    color 0.2s ease,
    transform 0.15s ease;
}

.metric-switch-btn:active {
  transform: scale(0.97);
}

.metric-switch-icon {
  flex-shrink: 0;
  opacity: 0.5;
  transition:
    opacity 0.2s ease,
    color 0.2s ease;
}

.metric-switch-label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.metric-switch-btn:hover:not(.active) {
  color: var(--text-secondary);
}

.metric-switch-btn:hover:not(.active) .metric-switch-icon {
  opacity: 0.72;
}

.metric-switch-btn.active {
  color: #e0e7ff;
}

.metric-switch-btn--clips .metric-switch-icon {
  color: #818cf8;
}

.metric-switch-btn--duration .metric-switch-icon {
  color: #38bdf8;
}

.metric-switch-btn--kills .metric-switch-icon {
  color: #f87171;
}

.metric-switch-btn.active.metric-switch-btn--clips .metric-switch-icon {
  color: #a5b4fc;
  opacity: 1;
}

.metric-switch-btn.active.metric-switch-btn--duration .metric-switch-icon {
  color: #38bdf8;
  opacity: 1;
}

.metric-switch-btn.active.metric-switch-btn--kills .metric-switch-icon {
  color: #f87171;
  opacity: 1;
}

.metric-switch-btn:focus-visible {
  outline: 2px solid var(--accent-color);
  outline-offset: 1px;
}

.menu-fade-enter-active,
.menu-fade-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.menu-fade-enter-from,
.menu-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (max-width: 800px) {
  .overview-body {
    grid-template-columns: 1fr;
  }

  .metrics-col {
    flex-direction: row;
  }
}

@media (prefers-reduced-motion: reduce) {
  .metric-glider {
    transition: none;
  }

  .metric-switch-btn:active {
    transform: none;
  }
}
</style>
