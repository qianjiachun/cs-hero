<script setup lang="ts">
import { CircleAlert, CircleCheck, Folder } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import type { StorageAlertLevel } from '../../../shared/storage-types'
import type { ServiceHealthLevel } from '../../../shared/service-status-types'
import { useMotion } from '../motion/useMotion'

const props = defineProps<{
  title: string
  value?: string
  icon?: 'folder'
  progress?: number
  alertLevel?: StorageAlertLevel
  statusLevel?: ServiceHealthLevel
  progressTone?: 'download'
  /** 服务状态卡：单行；OK 为「服务状态 + 正常」，否则用 statusLabel 替换标题 */
  valueLayout?: 'inline' | 'service'
  statusLabel?: string
  statusLabelPrefix?: string
  headline?: string
  valueTitle?: string
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

const primaryText = computed(() => props.statusLabel || props.title)
const primaryKey = computed(
  () =>
    props.statusLabelPrefix ??
    `${props.statusLabel ?? ''}|${props.title}`
)
const showDownloadLabel = computed(
  () => props.statusLabelPrefix !== undefined && props.statusLabelPrefix.length > 0
)

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
      { clickable, 'status-card-service': valueLayout === 'service' },
      icon === 'folder' && alertLevel ? `storage-${alertLevel}` : ''
    ]"
    :title="valueTitle"
    @click="handleClick"
  >
    <div
      v-if="valueLayout === 'service'"
      class="card-row card-row-service"
    >
      <div class="card-title">
        <span
          v-if="statusLevel"
          class="status-dot"
          :class="statusLevel"
        />
        <div class="text-slot label-slot">
          <span
            v-if="showDownloadLabel"
            class="card-label download-label"
            :class="statusLevel ? `tone-${statusLevel}` : undefined"
          >
            {{ statusLabelPrefix }}
          </span>
          <Transition
            v-else
            name="status-swap"
            mode="out-in"
          >
            <span
              :key="primaryKey"
              class="card-label"
              :class="statusLevel && statusLabel ? `tone-${statusLevel}` : undefined"
            >{{ primaryText }}</span>
          </Transition>
        </div>
      </div>
      <div class="text-slot headline-slot">
        <span
          v-if="headline && showDownloadLabel"
          class="card-headline card-percent"
          :class="statusLevel ? `tone-${statusLevel}` : undefined"
        >{{ headline }}</span>
        <Transition
          v-else
          name="status-swap"
          mode="out-in"
        >
          <span
            v-if="headline"
            :key="headline"
            class="card-headline"
            :class="statusLevel ? `tone-${statusLevel}` : undefined"
          >{{ headline }}</span>
        </Transition>
      </div>
    </div>

    <div
      v-else
      class="card-row"
    >
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
      <span
        v-if="value"
        class="card-value"
      >{{ value }}</span>
    </div>

    <div v-if="progress !== undefined" class="progress-bar">
      <div
        class="progress-fill"
        :class="{ 'progress-download': progressTone === 'download' }"
        :style="{ width: `${displayProgress}%` }"
      />
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
  font-size: var(--status-card-font-size, 12px);
  line-height: var(--status-card-line-height, 20px);
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
  line-height: 20px;
}

.card-row-service {
  min-height: 20px;
  gap: 6px;
}

.status-card:has(.card-row-service) {
  padding-right: 10px;
}

.card-title {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  flex: 1;
}

.text-slot {
  position: relative;
  height: 20px;
  min-width: 0;
  overflow: hidden;
}

.label-slot {
  flex: 1;
  display: flex;
  align-items: center;
}

.headline-slot {
  flex-shrink: 0;
  width: max-content;
  margin-left: 6px;
}

.text-slot :deep(.status-swap-enter-active),
.text-slot :deep(.status-swap-leave-active) {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  transition:
    opacity var(--motion-slow) var(--motion-ease),
    transform var(--motion-slow) var(--motion-ease);
}

.headline-slot :deep(.status-swap-enter-active),
.headline-slot :deep(.status-swap-leave-active),
.headline-slot .card-headline {
  left: auto;
  right: 0;
  width: max-content;
  text-align: right;
}

.text-slot :deep(.status-swap-enter-from) {
  opacity: 0;
  transform: translateY(8px);
}

.text-slot :deep(.status-swap-leave-to) {
  opacity: 0;
  transform: translateY(-8px);
}

.card-icon {
  flex-shrink: 0;
  color: var(--accent-color);
}

.card-label,
.card-headline,
.card-value {
  font-size: inherit;
  line-height: inherit;
}

.card-label {
  display: block;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-headline {
  display: block;
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
  background-color: var(--status-busy);
  box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.35);
  animation: status-busy-pulse 1.4s ease-in-out infinite;
}

@keyframes status-busy-pulse {
  0%,
  100% {
    opacity: 1;
    box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.35);
  }
  50% {
    opacity: 0.75;
    box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.12);
  }
}

@media (prefers-reduced-motion: reduce) {
  .status-dot.busy {
    animation: none;
  }

  .text-slot :deep(.status-swap-enter-active),
  .text-slot :deep(.status-swap-leave-active) {
    transition-duration: 0ms;
  }

  .text-slot :deep(.status-swap-enter-from),
  .text-slot :deep(.status-swap-leave-to) {
    transform: none;
  }
}

.card-label.download-label {
  display: inline-flex;
  align-items: center;
  height: 20px;
  line-height: 20px;
  max-width: 100%;
}

.card-title .status-dot {
  align-self: center;
  margin-top: 0;
}

.card-label.tone-busy,
.card-headline.tone-busy {
  color: var(--status-busy-muted);
}

.card-label.tone-warning,
.card-headline.tone-warning {
  color: var(--warning);
}

.card-label.tone-critical,
.card-headline.tone-critical {
  color: #fca5a5;
}

.card-value {
  flex-shrink: 1;
  min-width: 0;
  max-width: 58%;
  color: var(--text-secondary);
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-card-service .card-label,
.status-card-service .card-headline,
.status-card-service .card-percent,
.status-card-service :deep(.status-swap-enter-active),
.status-card-service :deep(.status-swap-leave-active) {
  font-size: inherit;
  line-height: inherit;
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

.progress-fill.progress-download {
  background: linear-gradient(
    90deg,
    var(--progress-download-from),
    var(--progress-download-to)
  );
  box-shadow: 0 0 6px rgba(34, 211, 238, 0.28);
}

.card-headline.card-percent {
  font-variant-numeric: tabular-nums;
}
</style>
