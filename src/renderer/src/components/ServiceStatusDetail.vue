<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import type {
  ServiceStatusAction,
  ServiceStatusIssue,
  ServiceStatusSnapshot
} from '../../../shared/service-status-types'
import { useMotion } from '../motion/useMotion'

const props = defineProps<{
  snapshot: ServiceStatusSnapshot
}>()

const visibleIssues = computed(() => props.snapshot.issues.filter((i) => i.title))

const emit = defineEmits<{
  (e: 'action', action: ServiceStatusAction): void
  (e: 'close'): void
}>()

const rootRef = ref<HTMLElement | null>(null)
const { run, staggerDelay, MOTION } = useMotion()

function issueActions(issue: ServiceStatusIssue): ServiceStatusAction[] {
  if (issue.actions?.length) return issue.actions
  if (issue.action) return [issue.action]
  return []
}

onMounted(async () => {
  await nextTick()
  const root = rootRef.value
  if (!root) return

  run(root, {
    opacity: [0, 1],
    translateY: [8, 0],
    duration: MOTION.panelEnter,
    ease: MOTION.ease
  })

  const items = root.querySelectorAll<HTMLElement>('.issue-item')
  if (items.length) {
    run(items, {
      opacity: [0, 1],
      translateY: [6, 0],
      delay: staggerDelay(MOTION.staggerStep),
      duration: MOTION.listItem,
      ease: MOTION.ease
    })
  }
})
</script>

<template>
  <div ref="rootRef" class="service-detail" role="dialog" aria-label="服务状态详情">
    <div class="service-detail-header">
      <span class="service-detail-title">服务状态</span>
      <button type="button" class="service-detail-close" aria-label="关闭" @click="emit('close')">
        ×
      </button>
    </div>

    <ul v-if="visibleIssues.length" class="issue-list">
      <li
        v-for="issue in visibleIssues"
        :key="issue.id"
        class="issue-item"
        :data-level="issue.level"
      >
        <div class="issue-main">
          <div class="issue-title-row">
            <span class="issue-dot" :data-level="issue.level" />
            <span class="issue-title">{{ issue.title }}</span>
          </div>
          <p v-if="issue.detail" class="issue-detail">{{ issue.detail }}</p>
        </div>
        <div v-if="issueActions(issue).length" class="issue-actions">
          <button
            v-for="(act, idx) in issueActions(issue)"
            :key="`${issue.id}-${idx}`"
            type="button"
            class="issue-action-btn"
            @click="emit('action', act)"
          >
            {{ act.label }}
          </button>
        </div>
      </li>
    </ul>

    <p v-else class="issue-empty">一切正常，暂无待处理事项</p>
  </div>
</template>

<style scoped>
.service-detail {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(100% + 8px);
  z-index: 20;
  background: var(--bg-card);
  border: 1px solid var(--border-status-card);
  border-radius: var(--radius-card);
  padding: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  max-height: min(320px, 45vh);
  overflow-y: auto;
}

.service-detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.service-detail-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.service-detail-close {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 4px;
  transition: background-color 0.2s ease;
}

.service-detail-close:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-primary);
}

.issue-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.issue-item {
  padding: 8px 0;
  border-bottom: 1px solid var(--border-status-card);
}

.issue-item:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.issue-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.issue-title-row {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 0;
}

.issue-dot {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-muted);
}

.issue-dot[data-level='warning'] {
  background: var(--warning);
}

.issue-dot[data-level='critical'] {
  background: var(--danger);
}

.issue-dot[data-level='info'] {
  background: var(--accent-color);
}

.issue-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  line-height: 1.3;
}

.issue-detail {
  margin: 0;
  padding-left: 16px;
  font-size: 11px;
  line-height: 1.45;
  color: var(--text-secondary);
  word-break: break-word;
}

.issue-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
  padding-left: 16px;
}

.issue-action-btn {
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-primary);
  background: rgba(99, 102, 241, 0.2);
  border: 1px solid rgba(99, 102, 241, 0.35);
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.issue-action-btn:hover {
  background: rgba(99, 102, 241, 0.32);
}

.issue-empty {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
