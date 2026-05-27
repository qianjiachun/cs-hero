<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type {
  Cs2IntegrationStatus,
  RecordingPocStatus
} from '../../../shared/recording-types'
import type { ServiceStatusAction } from '../../../shared/service-status-types'
import { buildServiceStatus } from '../lib/build-service-status'
import StatusCard from './StatusCard.vue'
import ServiceStatusDetail from './ServiceStatusDetail.vue'

const cs2Status = ref<Cs2IntegrationStatus | null>(null)
const pocStatus = ref<RecordingPocStatus | null>(null)
const panelOpen = ref(false)
const wrapRef = ref<HTMLElement | null>(null)

let unsubCs2: (() => void) | undefined
let unsubPoc: (() => void) | undefined
let pollTimer: ReturnType<typeof setInterval> | undefined

const snapshot = computed(() => buildServiceStatus(cs2Status.value, pocStatus.value))

const emit = defineEmits<{
  (e: 'navigate', view: string): void
}>()

async function refresh(): Promise<void> {
  if (!window.csHero) return
  try {
    const [cs2, poc] = await Promise.all([
      window.csHero.getCs2IntegrationStatus(),
      window.csHero.getRecordingStatus()
    ])
    cs2Status.value = cs2
    pocStatus.value = poc
  } catch (err) {
    console.error(err)
  }
}

function togglePanel(): void {
  panelOpen.value = !panelOpen.value
}

function closePanel(): void {
  panelOpen.value = false
}

async function handleAction(action: ServiceStatusAction): Promise<void> {
  if (!window.csHero) return

  switch (action.type) {
    case 'navigate':
      if (action.target) emit('navigate', action.target)
      closePanel()
      break
    case 'open-steam':
      await window.csHero.openCs2InSteam()
      break
    case 'refresh-launch-option':
      cs2Status.value = await window.csHero.refreshCs2LaunchOption()
      break
    case 'open-cfg-folder': {
      const cfgPath = cs2Status.value?.cfgPath
      if (cfgPath) {
        const normalized = cfgPath.replace(/\\/g, '/')
        const dir = normalized.includes('/')
          ? normalized.slice(0, normalized.lastIndexOf('/'))
          : cfgPath
        await window.csHero.openPath(dir || cfgPath)
      }
      break
    }
    default:
      break
  }
}

function onDocumentPointerDown(e: PointerEvent): void {
  if (!panelOpen.value || !wrapRef.value) return
  if (!wrapRef.value.contains(e.target as Node)) {
    closePanel()
  }
}

watch(panelOpen, (open) => {
  if (open) {
    document.addEventListener('pointerdown', onDocumentPointerDown, true)
  } else {
    document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  }
})

onMounted(() => {
  unsubCs2 = window.csHero?.onCs2IntegrationStatusChanged((s) => {
    cs2Status.value = s
  })
  unsubPoc = window.csHero?.onRecordingStatusChanged((s) => {
    pocStatus.value = s
  })
  void refresh()
  pollTimer = setInterval(() => {
    void refresh()
  }, 5000)
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  unsubCs2?.()
  unsubPoc?.()
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<template>
  <div ref="wrapRef" class="service-status-wrap">
    <ServiceStatusDetail
      v-if="panelOpen"
      :snapshot="snapshot"
      @action="handleAction"
      @close="closePanel"
    />

    <StatusCard
      title="服务状态"
      :value="snapshot.summary"
      :status-level="snapshot.level"
      clickable
      @click="togglePanel"
    />
  </div>
</template>

<style scoped>
.service-status-wrap {
  position: relative;
}
</style>
