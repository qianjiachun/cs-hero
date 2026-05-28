<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { TrendMetric, TrendPoint } from '../../lib/match-stats'
import {
  formatTrendTooltip,
  trendMetricLabel,
  trendMetricValue
} from '../../lib/match-stats'
import { buildMonotoneSmoothPath } from '../../lib/smooth-chart-path'
import { useMotion } from '../../motion/useMotion'

const props = withDefaults(
  defineProps<{
    series: TrendPoint[]
    metric: TrendMetric
    /** 主页数据概览内嵌时使用，压缩高度以匹配录制控制卡片 */
    compact?: boolean
  }>(),
  { compact: false }
)

const { run, reduced } = useMotion()
const chartRoot = ref<SVGSVGElement | null>(null)
const hoverIndex = ref<number | null>(null)

const padding = computed(() =>
  props.compact
    ? { top: 6, right: 6, bottom: 20, left: 6 }
    : { top: 12, right: 8, bottom: 28, left: 8 }
)
const viewW = 640
const viewH = computed(() => (props.compact ? 112 : 200))

const values = computed(() => props.series.map((p) => trendMetricValue(p, props.metric)))

const maxValue = computed(() => {
  const max = Math.max(...values.value, 0)
  if (max <= 0) return 1
  return max * 1.12
})

const points = computed(() => {
  const n = props.series.length
  if (n === 0) return []
  const pad = padding.value
  const innerW = viewW - pad.left - pad.right
  const innerH = viewH.value - pad.top - pad.bottom
  return props.series.map((item, i) => {
    const x = pad.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW)
    const v = trendMetricValue(item, props.metric)
    const y = pad.top + innerH - (v / maxValue.value) * innerH
    return { x, y, item, v }
  })
})

const linePath = computed(() => {
  const pad = padding.value
  const innerH = viewH.value - pad.top - pad.bottom
  const max = maxValue.value
  const vToY = (v: number) => pad.top + innerH - (Math.max(0, v) / max) * innerH
  return buildMonotoneSmoothPath(points.value, vToY)
})

const xLabels = computed(() => {
  const n = props.series.length
  if (n === 0) return []
  const step = n <= 8 ? 1 : Math.ceil(n / 6)
  return props.series
    .map((item, i) => ({ item, i }))
    .filter(({ i }) => i === 0 || i === n - 1 || i % step === 0)
})

const tooltip = computed(() => {
  if (hoverIndex.value === null) return null
  const p = points.value[hoverIndex.value]
  if (!p) return null
  return {
    x: p.x,
    y: p.y,
    title: formatTrendTooltip(p.item, props.metric)
  }
})

function clientToSvg(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
  const pt = svg.createSVGPoint()
  pt.x = clientX
  pt.y = clientY
  const ctm = svg.getScreenCTM()
  if (!ctm) return { x: 0, y: 0 }
  const { x, y } = pt.matrixTransform(ctm.inverse())
  return { x, y }
}

function indexAtSvgX(svgX: number): number | null {
  const pts = points.value
  if (pts.length === 0) return null

  const pad = padding.value
  const innerLeft = pad.left
  const innerRight = viewW - pad.right
  if (svgX < innerLeft - 1 || svgX > innerRight + 1) return null

  if (pts.length === 1) return 0

  if (svgX <= pts[0].x) return 0
  const last = pts.length - 1
  if (svgX >= pts[last].x) return last

  for (let i = 0; i < last; i++) {
    const mid = (pts[i].x + pts[i + 1].x) / 2
    if (svgX < mid) return i
  }
  return last
}

function animateChart(): void {
  const root = chartRoot.value
  if (!root || reduced.value) return
  const line = root.querySelector('.chart-line')
  if (line instanceof SVGPathElement) {
    const len = line.getTotalLength()
    line.style.strokeDasharray = `${len}`
    line.style.strokeDashoffset = `${len}`
    run(line, {
      strokeDashoffset: 0,
      duration: 520,
      ease: 'outCubic'
    })
  }
}

watch(
  () => [props.series, props.metric] as const,
  () => {
    hoverIndex.value = null
    requestAnimationFrame(() => animateChart())
  },
  { deep: true, immediate: true }
)

function onPointerMove(event: MouseEvent): void {
  const root = chartRoot.value
  if (!root || points.value.length === 0) return
  const { x: svgX } = clientToSvg(root, event.clientX, event.clientY)
  hoverIndex.value = indexAtSvgX(svgX)
}

function onPointerLeave(): void {
  hoverIndex.value = null
}
</script>

<template>
  <div class="trend-chart" :class="{ compact }">
    <svg
      ref="chartRoot"
      class="trend-svg"
      :viewBox="`0 0 ${viewW} ${viewH}`"
      preserveAspectRatio="none"
      role="img"
      :aria-label="`${trendMetricLabel(metric)}趋势图`"
      @mousemove="onPointerMove"
      @mouseleave="onPointerLeave"
    >
      <path
        class="chart-line"
        :d="linePath"
        fill="none"
        stroke="var(--accent-color)"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />

      <g v-if="tooltip" class="tooltip-group">
        <line
          :x1="tooltip.x"
          :x2="tooltip.x"
          :y1="padding.top"
          :y2="viewH - padding.bottom"
          stroke="rgba(148, 163, 184, 0.35)"
          stroke-dasharray="4 4"
        />
        <circle :cx="tooltip.x" :cy="tooltip.y" r="5" fill="var(--accent-color)" />
      </g>

      <g class="x-labels">
        <text
          v-for="tick in xLabels"
          :key="tick.item.dateKey"
          :x="points[tick.i]?.x ?? 0"
          :y="viewH - 6"
          text-anchor="middle"
          class="axis-label"
        >
          {{ tick.item.label }}
        </text>
      </g>
    </svg>

    <Transition name="tooltip-fade">
      <div v-if="tooltip" class="chart-tooltip" :style="{ left: `${(tooltip.x / viewW) * 100}%` }">
        {{ tooltip.title }}
      </div>
    </Transition>

    <p v-if="series.length === 0" class="chart-empty">暂无趋势数据</p>
  </div>
</template>

<style scoped>
.trend-chart {
  position: relative;
  width: 100%;
  min-height: 11rem;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.trend-chart.compact {
  min-height: 0;
  height: 100%;
}

.trend-svg {
  width: 100%;
  height: 100%;
  min-height: 11rem;
  flex: 1;
  display: block;
  cursor: crosshair;
}

.trend-chart.compact .trend-svg {
  min-height: 0;
  flex: 1;
}

.trend-chart.compact .axis-label {
  font-size: 9px;
}

.axis-label {
  fill: var(--text-muted);
  font-size: 11px;
}

.chart-tooltip {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.92);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  font-size: 12px;
  white-space: nowrap;
  pointer-events: none;
}

.chart-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  color: var(--text-muted);
  font-size: 13px;
}

.tooltip-fade-enter-active,
.tooltip-fade-leave-active {
  transition: opacity var(--motion-normal) var(--motion-ease);
}

.tooltip-fade-enter-from,
.tooltip-fade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .chart-line {
    stroke-dasharray: none !important;
    stroke-dashoffset: 0 !important;
  }
}
</style>
