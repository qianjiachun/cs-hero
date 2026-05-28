<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import type { KillClipView } from '../../lib/kill-clip-strip-layout'
import { formatDurationClock } from '../../lib/time-format'
import { layoutKillClipStrip } from '../../lib/kill-clip-strip-layout'

const props = defineProps<{
  rowId: string
  clips: KillClipView[]
}>()

const cellRef = ref<HTMLElement | null>(null)
const layout = ref(layoutKillClipStrip([], 0))
const clipDurLabels = reactive<Record<string, string>>({})
let resizeObserver: ResizeObserver | null = null

function clipDurKey(file: string): string {
  return `${props.rowId}:${file}`
}

function clipDurLabel(file: string): string {
  return clipDurLabels[clipDurKey(file)] ?? ''
}

function onClipMeta(file: string, event: Event): void {
  const video = event.target as HTMLVideoElement
  if (!video.duration || !Number.isFinite(video.duration)) return
  clipDurLabels[clipDurKey(file)] = formatDurationClock(video.duration)
}

function remeasure(): void {
  const cell = cellRef.value
  if (!cell) return
  layout.value = layoutKillClipStrip(props.clips, cell.clientWidth)
}

watch(() => props.clips, remeasure, { deep: true })

onMounted(async () => {
  await nextTick()
  remeasure()
  resizeObserver = new ResizeObserver(() => remeasure())
  if (cellRef.value) resizeObserver.observe(cellRef.value)
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})
</script>

<template>
  <div ref="cellRef" class="clip-cell">
    <span v-if="clips.length === 0" class="clips-empty">—</span>
    <div v-else class="clip-strip">
      <div
        v-for="clip in layout.visible"
        :key="clip.file"
        class="clip-thumb"
        :title="clip.file"
      >
        <video
          :src="clip.mediaUrl"
          muted
          preload="metadata"
          playsinline
          @loadedmetadata="onClipMeta(clip.file, $event)"
        />
        <span v-if="clipDurLabel(clip.file)" class="clip-dur">
          {{ clipDurLabel(clip.file) }}
        </span>
      </div>
      <div
        v-if="layout.showMask"
        class="clip-thumb clip-thumb-overflow"
        :title="`还有 ${layout.extraCount} 个击杀片段`"
      >
        <video
          v-if="layout.overflow"
          :src="layout.overflow.mediaUrl"
          muted
          preload="metadata"
          playsinline
          class="overflow-video"
          @loadedmetadata="layout.overflow && onClipMeta(layout.overflow.file, $event)"
        />
        <span class="clip-overflow-mask" aria-hidden="true" />
        <span class="clip-overflow-count">+{{ layout.extraCount }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.clip-cell {
  width: 100%;
  min-width: 0;
  overflow: hidden;
}

.clip-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: nowrap;
}

.clip-thumb {
  position: relative;
  width: 76px;
  aspect-ratio: 4 / 3;
  border-radius: 8px;
  overflow: hidden;
  background: #0c0f18;
  flex: 0 0 76px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.clip-thumb video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
  display: block;
}

.clip-dur {
  position: absolute;
  left: 50%;
  bottom: 5px;
  transform: translateX(-50%);
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.78);
  color: #f8fafc;
  font-size: 10px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
  white-space: nowrap;
  pointer-events: none;
}

.clip-thumb-overflow .overflow-video {
  filter: brightness(0.45);
}

.clip-overflow-mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.58);
  pointer-events: none;
}

.clip-overflow-count {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  color: #f1f5f9;
  letter-spacing: 0.02em;
  pointer-events: none;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
}

.clips-empty {
  color: var(--text-muted);
  font-size: 13px;
}
</style>
