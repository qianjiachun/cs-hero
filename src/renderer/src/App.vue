<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import type { Cs2IntegrationStatus, MockMatchStatus, RecordingPocStatus } from '../../shared/recording-types'

const pocStatus = ref<RecordingPocStatus>({
  phase: 'idle',
  message: '加载中…',
  appDataRoot: '',
  obsReady: false
})

const mockStatus = ref<MockMatchStatus>({
  phase: 'idle',
  message: '加载中…',
  appDataRoot: '',
  obsReady: false
})

const cs2Status = ref<Cs2IntegrationStatus>({
  gsiServerState: 'idle',
  gsiPort: 1340,
  cfgWritten: false,
  cfgNeedsCs2Restart: false,
  recordingPhase: 'idle',
  recordingMessage: '加载中…',
  obsReady: false
})

const bridgeReady = ref(false)
const pocBusy = ref(false)
const mockBusy = ref(false)
let unsubPoc: (() => void) | undefined
let unsubMock: (() => void) | undefined
let unsubCs2: (() => void) | undefined
let cs2PollTimer: ReturnType<typeof setInterval> | undefined

async function refresh(): Promise<void> {
  if (!window.csHero) {
    bridgeReady.value = false
    const err =
      'window.csHero 不存在。请使用 pnpm dev 弹出的 Electron 窗口，不要用浏览器打开 localhost:5173。'
    pocStatus.value = { phase: 'failed', message: '未连接主进程', appDataRoot: '', error: err }
    mockStatus.value = { phase: 'failed', message: '未连接主进程', appDataRoot: '', obsReady: false, error: err }
    cs2Status.value = {
      ...cs2Status.value,
      recordingMessage: '未连接主进程',
      gsiServerState: 'failed'
    }
    return
  }
  bridgeReady.value = true
  pocStatus.value = await window.csHero.getRecordingStatus()
  mockStatus.value = await window.csHero.getMockMatchStatus()
  cs2Status.value = await window.csHero.getCs2IntegrationStatus()
  if (pocStatus.value.phase === 'idle' && pocStatus.value.message === '加载中…') {
    pocStatus.value = {
      ...pocStatus.value,
      message: pocStatus.value.obsReady ? '就绪' : '等待初始化 OBS…'
    }
  }
  if (mockStatus.value.phase === 'idle' && mockStatus.value.message === '加载中…') {
    mockStatus.value = {
      ...mockStatus.value,
      message: mockStatus.value.obsReady ? '就绪' : '等待初始化 OBS…'
    }
  }
}

const obsReady = () =>
  bridgeReady.value && (pocStatus.value.obsReady === true || mockStatus.value.obsReady === true)

const pocCanRecord = () =>
  bridgeReady.value && !pocBusy.value && !mockBusy.value && pocStatus.value.obsReady === true

const mockCanRun = () =>
  bridgeReady.value &&
  !pocBusy.value &&
  !mockBusy.value &&
  mockStatus.value.obsReady === true &&
  mockStatus.value.phase !== 'recording' &&
  mockStatus.value.phase !== 'finalizing' &&
  mockStatus.value.phase !== 'clipping'

async function runPoc(): Promise<void> {
  if (!window.csHero || pocBusy.value) return
  pocBusy.value = true
  try {
    pocStatus.value = await window.csHero.runRecordingPoc()
  } finally {
    pocBusy.value = false
  }
}

async function runMock(): Promise<void> {
  if (!window.csHero || mockBusy.value) return
  mockBusy.value = true
  try {
    mockStatus.value = await window.csHero.runMockMatch()
  } finally {
    mockBusy.value = false
  }
}

onMounted(async () => {
  unsubPoc = window.csHero?.onRecordingStatusChanged((s) => {
    pocStatus.value = s
  })
  unsubMock = window.csHero?.onMockMatchStatusChanged((s) => {
    mockStatus.value = s
  })
  unsubCs2 = window.csHero?.onCs2IntegrationStatusChanged((s) => {
    cs2Status.value = s
  })
  await refresh()

  cs2PollTimer = setInterval(() => {
    void window.csHero?.getCs2IntegrationStatus().then((s) => {
      cs2Status.value = s
    })
  }, 2000)
})

onUnmounted(() => {
  unsubPoc?.()
  unsubMock?.()
  unsubCs2?.()
  if (cs2PollTimer) clearInterval(cs2PollTimer)
})

const gsiStateLabel = () => {
  const s = cs2Status.value.gsiServerState
  if (s === 'listening') return `GSI 监听中 :${cs2Status.value.gsiPort}`
  if (s === 'port_conflict') return 'GSI 端口冲突'
  if (s === 'failed') return 'GSI 启动失败'
  return 'GSI 未启动'
}
</script>

<template>
  <main class="panel">
    <h1>CS Hero</h1>
    <p class="subtitle">竖切 1 · PoC · 竖切 2 · Mock · 竖切 3 · 真实 CS2 GSI</p>

    <section class="card">
      <div class="row">
        <span class="label">录制引擎</span>
        <span class="badge obs-badge" :data-ready="obsReady() ? 'yes' : 'no'">
          {{ obsReady() ? 'OBS 已就绪' : 'OBS 初始化中' }}
        </span>
      </div>
      <p class="label path-label">数据目录</p>
      <code class="path">{{ pocStatus.appDataRoot || mockStatus.appDataRoot || '—' }}</code>
    </section>

    <section class="card">
      <h2 class="section-title">竖切 1 · 录制测试</h2>
      <div class="row">
        <span class="label">状态</span>
        <span class="badge" :data-phase="pocStatus.phase">{{ pocStatus.phase }}</span>
      </div>
      <p class="message">{{ pocStatus.message }}</p>
      <p v-if="pocStatus.error" class="error">{{ pocStatus.error }}</p>
      <template v-if="pocStatus.outputVideo">
        <p class="label path-label">输出视频</p>
        <code class="path">{{ pocStatus.outputVideo }}</code>
      </template>
      <button class="primary" :disabled="!pocCanRecord()" @click="runPoc">
        {{ pocBusy ? '进行中…' : pocStatus.obsReady ? '录制 10 秒测试' : 'OBS 初始化中…' }}
      </button>
    </section>

    <section class="card">
      <h2 class="section-title">竖切 2 · Mock 对局</h2>
      <div class="row">
        <span class="label">状态</span>
        <span class="badge" :data-phase="mockStatus.phase">{{ mockStatus.phase }}</span>
      </div>
      <div class="row stats-row">
        <span class="stat">Bookmarks: {{ mockStatus.bookmarkCount ?? 0 }}</span>
        <span class="stat">Clips: {{ mockStatus.clipCount ?? 0 }}</span>
      </div>
      <p class="message">{{ mockStatus.message }}</p>
      <p v-if="mockStatus.error" class="error">{{ mockStatus.error }}</p>
      <template v-if="mockStatus.outputDir">
        <p class="label path-label">输出目录</p>
        <code class="path">{{ mockStatus.outputDir }}</code>
      </template>
      <template v-if="mockStatus.outputVideo">
        <p class="label path-label">整局视频</p>
        <code class="path">{{ mockStatus.outputVideo }}</code>
      </template>
      <button class="primary secondary-btn" :disabled="!mockCanRun()" @click="runMock">
        {{ mockBusy ? '进行中…' : mockStatus.obsReady ? '运行 Mock 对局' : 'OBS 初始化中…' }}
      </button>
    </section>

    <section class="card">
      <h2 class="section-title">竖切 3 · 真实 CS2</h2>
      <div class="row">
        <span class="label">GSI 服务</span>
        <span
          class="badge"
          :data-phase="
            cs2Status.gsiServerState === 'listening'
              ? 'completed'
              : cs2Status.gsiServerState === 'failed' ||
                  cs2Status.gsiServerState === 'port_conflict'
                ? 'failed'
                : 'idle'
          "
        >
          {{ gsiStateLabel() }}
        </span>
      </div>
      <div class="row stats-row">
        <span class="stat">录制: {{ cs2Status.recordingPhase }}</span>
        <span class="stat">BK: {{ cs2Status.bookmarkCount ?? 0 }}</span>
        <span class="stat">Clips: {{ cs2Status.clipCount ?? 0 }}</span>
      </div>
      <p v-if="cs2Status.lastMapName" class="message">
        地图 {{ cs2Status.lastMapName }} · phase {{ cs2Status.lastMapPhase ?? '—' }}
        · K/D {{ cs2Status.lastKills ?? 0 }}/{{ cs2Status.lastDeaths ?? 0 }}
      </p>
      <p v-if="cs2Status.lastPayloadAt" class="message subtle">
        最近 GSI: {{ cs2Status.lastPayloadAt }}
      </p>
      <p class="message">{{ cs2Status.recordingMessage }}</p>
      <p v-if="cs2Status.gsiListenError" class="error">{{ cs2Status.gsiListenError }}</p>
      <p v-if="cs2Status.gsiPortAdjusted" class="message warn">
        端口已自动调整，请重启 CS2 使 cfg 生效
      </p>
      <p v-if="cs2Status.cfgNeedsCs2Restart" class="message warn">GSI cfg 已更新，请重启 CS2</p>
      <template v-if="cs2Status.cfgPath">
        <p class="label path-label">GSI cfg</p>
        <code class="path">{{ cs2Status.cfgPath }}</code>
      </template>
      <template v-if="cs2Status.outputDir">
        <p class="label path-label">输出目录</p>
        <code class="path">{{ cs2Status.outputDir }}</code>
      </template>
      <p v-if="cs2Status.recordingError" class="error">{{ cs2Status.recordingError }}</p>
    </section>
  </main>
</template>

<style scoped>
.panel {
  max-width: 640px;
  margin: 0 auto;
  padding-bottom: 24px;
}

h1 {
  margin: 0 0 4px;
  font-size: 1.75rem;
}

.subtitle {
  margin: 0 0 24px;
  color: #8b98a5;
}

.section-title {
  margin: 0 0 12px;
  font-size: 1rem;
  font-weight: 600;
}

.card {
  background: #1a2332;
  border: 1px solid #2f3b4a;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.stats-row {
  margin-top: 12px;
  justify-content: flex-start;
  gap: 16px;
}

.stat {
  font-size: 0.85rem;
  color: #94a3b8;
}

.label {
  font-size: 0.85rem;
  color: #8b98a5;
  margin: 0 0 6px;
}

.path-label {
  margin-top: 12px;
}

.message {
  margin: 12px 0 0;
}

.message.subtle {
  font-size: 0.85rem;
  color: #94a3b8;
}

.message.warn {
  color: #fcd34d;
}

.error {
  margin: 8px 0 0;
  color: #f87171;
  font-size: 0.9rem;
}

.badge {
  font-size: 0.75rem;
  padding: 4px 10px;
  border-radius: 999px;
  background: #2f3b4a;
  text-transform: uppercase;
}

.badge[data-phase='completed'] {
  background: #14532d;
  color: #86efac;
}

.badge[data-phase='failed'] {
  background: #450a0a;
  color: #fca5a5;
}

.badge[data-phase='recording'],
.badge[data-phase='finalizing'],
.badge[data-phase='clipping'],
.badge[data-phase='remuxing'],
.badge[data-phase='stopping'] {
  background: #1e3a5f;
  color: #93c5fd;
}

.obs-badge[data-ready='yes'] {
  background: #14532d;
  color: #86efac;
}

.obs-badge[data-ready='no'] {
  background: #422006;
  color: #fcd34d;
}

.path {
  display: block;
  font-size: 0.8rem;
  word-break: break-all;
  color: #cbd5e1;
}

.primary {
  width: 100%;
  margin-top: 16px;
  padding: 14px;
  font-size: 1rem;
  font-weight: 600;
  border: none;
  border-radius: 10px;
  background: #3b82f6;
  color: #fff;
  cursor: pointer;
}

.secondary-btn {
  background: #6366f1;
}

.secondary-btn:not(:disabled):hover {
  background: #4f46e5;
}

.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.primary:not(:disabled):hover {
  background: #2563eb;
}
</style>
