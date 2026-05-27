<script setup lang="ts">
import { CircleAlert, CircleCheck, Folder } from 'lucide-vue-next'
import { ref, watch } from 'vue'
import type { StorageAlertLevel } from '../../../shared/storage-types'
import type { ServiceHealthLevel } from '../../../shared/service-status-types'
import { useMotion } from '../motion/useMotion'

const props = defineProps<{
  title: string
  value: string
  icon?: 'folder'
  progress?: number
  alertLevel?: StorageAlertLevel
  statusLevel?: ServiceHealthLevel
  clickable?: boolean
}>()

const emit = defineEmits<{
  (e: 'click'): void
}>()

function handleClick(): void {
  if (props.clickable) emit('click')
}

const { animateProgress } = useMotion()
const displayProgress = ref(0)

watch(
  () => props.progress,
  (next) => {
    if (next === undefined) return
    const target = Math.min(100, Math.max(0, next))
    animateProgress(displayProgress.value, target, (value) => {
      displayProgress.value = value
    })
  },
  { immediate: true }
)
</script>

<template>
  <div
    class="status-card"
    :class="[
      { clickable },
      icon === 'folder' && alertLevel ? `storage-${alertLevel}` : ''
    ]"
    @click="handleClick"
  >
    <div class="card-row">
      <div class="card-title">
        <Folder v-if="icon === 'folder'" :size="14" :stroke-width="2" class="card-icon" />
        <span
          v-else-if="statusLevel"
          class="status-dot"
          :class="statusLevel"
        />
        <span class="card-label">{{ title }}</span>
        <CircleCheck
          v-if="icon === 'folder' && (!alertLevel || alertLevel === 'ok')"
          :size="12"
          :stroke-width="2.5"
          class="status-ok-icon"
        />
        <CircleAlert
          v-else-if="icon === 'folder' && alertLevel === 'warning'"
          :size="12"
          :stroke-width="2.5"
          class="status-warn-icon"
          aria-label="存储空间不足"
        />
        <CircleAlert
          v-else-if="icon === 'folder' && alertLevel === 'critical'"
          :size="12"
          :stroke-width="2.5"
          class="status-critical-icon"
          aria-label="存储空间严重不足"
        />
      </div>
      <span class="card-value">{{ value }}</span>
    </div>
    <div v-if="progress !== undefined" class="progress-bar">
      <div class="progress-fill" :style="{ width: `${displayProgress}%` }" />
    </div>
  </div>
</template>

<style scoped>
.status-card {
  background: var(--bg-status-card);
  border: 1px solid var(--border-status-card);
  border-radius: var(--radius-card);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: none;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease;
}

.status-card.clickable {
  cursor: pointer;
}

.status-card.clickable:hover {
  background: var(--bg-status-card-hover);
  border-color: rgba(255, 255, 255, 0.08);
}

.status-card.clickable:active {
  background: var(--bg-status-card);
}

.card-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 20px;
}

.card-title {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  flex: 1;
}

.card-icon {
  flex-shrink: 0;
  color: var(--accent-color);
}

.card-label {
  font-size: 12px;
  line-height: 1;
  color: var(--text-secondary);
  white-space: nowrap;
}

.status-ok-icon {
  flex-shrink: 0;
  color: var(--success);
}

.status-warn-icon {
  flex-shrink: 0;
  color: var(--warning);
}

.status-critical-icon {
  flex-shrink: 0;
  color: var(--danger);
}

.status-dot {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-muted);
}

.status-dot.ok {
  background-color: var(--success);
}

.status-dot.warning {
  background-color: var(--warning);
}

.status-dot.critical {
  background-color: var(--danger);
}

.status-dot.busy {
  background-color: var(--success);
  box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.25);
  animation: status-pulse 1.6s ease-in-out infinite;
}

@keyframes status-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}

@media (prefers-reduced-motion: reduce) {
  .status-dot.busy {
    animation: none;
  }
}

.card-value {
  flex-shrink: 0;
  font-size: 12px;
  line-height: 1;
  color: var(--text-secondary);
}

.progress-bar {
  height: 3px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #6366f1, #a855f7);
  border-radius: 999px;
  transition: background 0.2s ease;
}

.storage-warning .progress-fill {
  background: linear-gradient(90deg, #f59e0b, #fbbf24);
}

.storage-critical .progress-fill {
  background: linear-gradient(90deg, #ef4444, #f87171);
}
</style>
