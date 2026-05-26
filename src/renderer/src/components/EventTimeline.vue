<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import type { BookmarkType } from '../../../shared/recording-types'

export interface TimelineMarkerView {
  type: BookmarkType
  time: number
  index: number
}

const DRAG_THRESHOLD_PX = 3

const props = defineProps<{
  duration: number
  currentTime: number
  markers: TimelineMarkerView[]
  trimStart?: number
  trimEnd?: number
  disabled?: boolean
  showMarkers?: boolean
}>()

const emit = defineEmits<{
  scrubStart: [time: number]
  scrubPreview: [time: number]
  scrubCommit: [time: number]
  markerClick: [marker: TimelineMarkerView]
}>()

const trackRef = ref<HTMLDivElement | null>(null)
const dragging = ref(false)
const dragStartX = ref(0)
const didDrag = ref(false)
let activePointerId: number | null = null
let previewRafId: number | null = null
let pendingPreviewClientX = 0

const showMarkersOnTrack = computed(
  () => (props.showMarkers ?? true) && props.duration > 0 && props.markers.length > 0
)

const playheadRatio = computed(() => {
  if (props.duration <= 0) return 0
  return Math.min(1, Math.max(0, props.currentTime / props.duration))
})

const trimStartRatio = computed(() => {
  if (props.duration <= 0 || props.trimStart === undefined) return 0
  return Math.min(1, Math.max(0, props.trimStart / props.duration))
})

const trimEndRatio = computed(() => {
  if (props.duration <= 0 || props.trimEnd === undefined) return 0
  return Math.min(1, Math.max(0, props.trimEnd / props.duration))
})

function markerLeft(time: number): string {
  if (props.duration <= 0) return '0%'
  const ratio = Math.min(1, Math.max(0, time / props.duration))
  return `${ratio * 100}%`
}

function markerLabel(type: BookmarkType): string {
  return type === 'kill' ? '击杀' : '死亡'
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function timeFromClientX(clientX: number): number {
  const el = trackRef.value
  if (!el || props.duration <= 0) return 0
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0) return 0
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  return ratio * props.duration
}

function markerNearClientX(clientX: number): TimelineMarkerView | null {
  const el = trackRef.value
  if (!el || props.duration <= 0 || !showMarkersOnTrack.value) return null
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0) return null
  const x = clientX - rect.left
  const hitPx = 10
  let best: TimelineMarkerView | null = null
  let bestDist = hitPx + 1
  for (const m of props.markers) {
    const mx = (m.time / props.duration) * rect.width
    const d = Math.abs(mx - x)
    if (d <= hitPx && d < bestDist) {
      bestDist = d
      best = m
    }
  }
  return best
}

function emitScrubPreview(clientX: number): void {
  emit('scrubPreview', timeFromClientX(clientX))
}

function scheduleScrubPreview(clientX: number): void {
  pendingPreviewClientX = clientX
  if (previewRafId !== null) return
  previewRafId = requestAnimationFrame(() => {
    previewRafId = null
    emitScrubPreview(pendingPreviewClientX)
  })
}

function cancelScheduledPreview(): void {
  if (previewRafId !== null) {
    cancelAnimationFrame(previewRafId)
    previewRafId = null
  }
}

function onWindowPointerMove(e: PointerEvent): void {
  if (!dragging.value || e.pointerId !== activePointerId) return
  if (Math.abs(e.clientX - dragStartX.value) > DRAG_THRESHOLD_PX) {
    didDrag.value = true
  }
  scheduleScrubPreview(e.clientX)
}

function endDrag(e: PointerEvent): void {
  if (e.pointerId !== activePointerId) return

  cancelScheduledPreview()

  const time = timeFromClientX(e.clientX)
  const marker = !didDrag.value ? markerNearClientX(e.clientX) : null
  const commitTime = marker ? marker.time : time

  dragging.value = false
  activePointerId = null
  trackRef.value?.releasePointerCapture(e.pointerId)

  window.removeEventListener('pointermove', onWindowPointerMove)
  window.removeEventListener('pointerup', endDrag)
  window.removeEventListener('pointercancel', endDrag)

  emit('scrubCommit', commitTime)

  if (marker) {
    emit('markerClick', marker)
  }
}

function onTrackPointerDown(e: PointerEvent): void {
  if (props.disabled || props.duration <= 0) return
  if (e.button !== 0) return

  e.preventDefault()
  dragging.value = true
  didDrag.value = false
  dragStartX.value = e.clientX
  activePointerId = e.pointerId

  const time = timeFromClientX(e.clientX)
  trackRef.value?.setPointerCapture(e.pointerId)

  emit('scrubStart', time)
  emitScrubPreview(e.clientX)

  window.addEventListener('pointermove', onWindowPointerMove)
  window.addEventListener('pointerup', endDrag)
  window.addEventListener('pointercancel', endDrag)
}

onUnmounted(() => {
  cancelScheduledPreview()
  window.removeEventListener('pointermove', onWindowPointerMove)
  window.removeEventListener('pointerup', endDrag)
  window.removeEventListener('pointercancel', endDrag)
})
</script>

<template>
  <div class="timeline" :class="{ disabled: disabled || duration <= 0 }">
    <div class="time-row">
      <span class="time-current">{{ formatTime(currentTime) }}</span>
      <span class="time-sep">/</span>
      <span class="time-total">{{ formatTime(duration) }}</span>
    </div>
    <div
      ref="trackRef"
      class="track"
      role="slider"
      aria-label="播放进度"
      :aria-valuemin="0"
      :aria-valuemax="duration"
      :aria-valuenow="currentTime"
      :aria-disabled="disabled || duration <= 0"
      @pointerdown.capture="onTrackPointerDown"
    >
      <div
        v-if="trimEnd !== undefined && trimStart !== undefined && trimEnd > trimStart"
        class="trim-range"
        :style="{
          left: `${trimStartRatio * 100}%`,
          width: `${(trimEndRatio - trimStartRatio) * 100}%`
        }"
      />
      <template v-if="showMarkersOnTrack">
        <span
          v-for="m in markers"
          :key="`${m.type}-${m.index}-${m.time}`"
          class="marker"
          :class="m.type"
          :data-marker-index="m.index"
          :style="{ left: markerLeft(m.time) }"
          :title="`${markerLabel(m.type)} ${m.time.toFixed(1)}s`"
        />
      </template>
      <div class="playhead" :style="{ left: `${playheadRatio * 100}%` }">
        <span class="playhead-knob" />
      </div>
    </div>
    <p v-if="duration <= 0" class="hint">无法读取视频时长，时间轴不可用</p>
    <p v-else-if="showMarkers === false" class="hint">当前为片段预览；事件节点仅在整局录像时间轴上显示</p>
  </div>
</template>

<style scoped>
.timeline {
  margin-top: 0;
}

.timeline.disabled .track {
  opacity: 0.45;
  cursor: not-allowed;
}

.time-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 6px;
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
  color: #94a3b8;
}

.time-current {
  color: #e2e8f0;
}

.track {
  position: relative;
  height: 32px;
  background: #0f172a;
  border: 1px solid #334155;
  border-radius: 6px;
  cursor: pointer;
  touch-action: none;
  user-select: none;
}

.trim-range {
  position: absolute;
  top: 4px;
  bottom: 4px;
  background: rgba(59, 130, 246, 0.28);
  border-radius: 4px;
  pointer-events: none;
}

.playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  margin-left: 0;
  pointer-events: none;
  z-index: 3;
  transform: translateX(-50%);
  will-change: left;
}

.playhead-knob {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 14px;
  height: 14px;
  margin: -7px 0 0 -7px;
  border-radius: 50%;
  background: #f8fafc;
  border: 2px solid #3b82f6;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
}

.marker {
  position: absolute;
  top: 50%;
  width: 10px;
  height: 10px;
  margin-left: -5px;
  margin-top: -5px;
  border: 2px solid #0f172a;
  border-radius: 50%;
  pointer-events: none;
  z-index: 2;
}

.marker.kill {
  background: #22c55e;
}

.marker.death {
  background: #ef4444;
}

.hint {
  margin: 6px 0 0;
  font-size: 0.75rem;
  color: #64748b;
}
</style>
