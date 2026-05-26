<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { DisplayInfo } from '../../shared/display-types'
import type { AppSettings } from '../../shared/settings'
import type {
  ContentMatchDetail,
  ContentMatchSummary,
  Cs2IntegrationStatus,
  MockMatchStatus,
  ObsRuntimeInfo,
  RecordingPocStatus
} from '../../shared/recording-types'

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
  recordingMode: 'auto',
  gsiServerState: 'idle',
  gsiPort: 1340,
  cfgWritten: false,
  cfgNeedsCs2Restart: false,
  launchOptionStatus: 'unknown',
  requiredLaunchOption: '-allow_third_party_software',
  recordingPhase: 'idle',
  recordingMessage: '加载中…',
  obsReady: false
})

const manualBusy = ref(false)
const manualActionError = ref('')

const launchOptionRefreshing = ref(false)
const launchOptionActionMessage = ref('')

const settings = ref<AppSettings | null>(null)
const displays = ref<DisplayInfo[]>([])
const obsRuntime = ref<ObsRuntimeInfo | null>(null)
const matches = ref<ContentMatchSummary[]>([])
const selectedMatchId = ref<string | null>(null)
const matchDetail = ref<ContentMatchDetail | null>(null)

const bridgeReady = ref(false)
const pocBusy = ref(false)
const mockBusy = ref(false)
const settingsError = ref('')
const devToolsOpen = ref(false)

let unsubPoc: (() => void) | undefined
let unsubMock: (() => void) | undefined
let unsubCs2: (() => void) | undefined
let unsubSettings: (() => void) | undefined
let unsubObsRuntime: (() => void) | undefined
let unsubMatches: (() => void) | undefined
let cs2PollTimer: ReturnType<typeof setInterval> | undefined
let settingsHydrated = false
let settingsApplyTimer: ReturnType<typeof setTimeout> | undefined

function applyMatchesList(list: ContentMatchSummary[]): void {
  matches.value = list
}

async function refreshSelectedMatchDetail(): Promise<void> {
  if (!window.csHero || !selectedMatchId.value) return
  matchDetail.value = await window.csHero.getMatch(selectedMatchId.value)
}

async function refreshMatches(): Promise<void> {
  if (!window.csHero) return
  applyMatchesList(await window.csHero.listMatches())
  await refreshSelectedMatchDetail()
}

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
  settings.value = await window.csHero.getSettings()
  displays.value = await window.csHero.listDisplays()
  obsRuntime.value = await window.csHero.getObsRuntimeInfo()
  await refreshMatches()
}

async function applySettingsToMain(): Promise<void> {
  if (!window.csHero || !settings.value) return
  settingsError.value = ''
  try {
    settingsHydrated = false
    const next = await window.csHero.updateSettings({ ...settings.value })
    settings.value = next
  } catch (err) {
    settingsError.value = err instanceof Error ? err.message : String(err)
  } finally {
    await nextTick()
    settingsHydrated = true
  }
}

watch(
  settings,
  () => {
    if (!settingsHydrated || !settings.value) return
    if (settingsApplyTimer) clearTimeout(settingsApplyTimer)
    settingsApplyTimer = setTimeout(() => {
      void applySettingsToMain()
    }, 200)
  },
  { deep: true }
)

async function selectMatch(id: string): Promise<void> {
  selectedMatchId.value = id
  if (!window.csHero) return
  matchDetail.value = await window.csHero.getMatch(id)
}

async function openMatchDir(): Promise<void> {
  if (!window.csHero || !matchDetail.value?.dir) return
  await window.csHero.openPath(matchDetail.value.dir)
}

async function copyRequiredLaunchOption(): Promise<void> {
  const text = cs2Status.value.requiredLaunchOption ?? '-allow_third_party_software'
  try {
    await navigator.clipboard.writeText(text)
    launchOptionActionMessage.value = '已复制到剪贴板'
  } catch {
    launchOptionActionMessage.value = `请手动复制：${text}`
  }
}

async function refreshLaunchOptionStatus(): Promise<void> {
  if (!window.csHero || launchOptionRefreshing.value) return
  launchOptionRefreshing.value = true
  launchOptionActionMessage.value = ''
  try {
    cs2Status.value = await window.csHero.refreshCs2LaunchOption()
    launchOptionActionMessage.value = '已重新检测'
  } catch (err) {
    launchOptionActionMessage.value = err instanceof Error ? err.message : String(err)
  } finally {
    launchOptionRefreshing.value = false
  }
}

const launchOptionStatusLabel = () => {
  const s = cs2Status.value.launchOptionStatus
  if (s === 'ok') return '已配置'
  if (s === 'missing') return '未配置'
  return '未知'
}

async function openCs2SteamProperties(): Promise<void> {
  if (!window.csHero) return
  await window.csHero.openCs2InSteam()
}

const obsReady = () =>
  bridgeReady.value && (pocStatus.value.obsReady === true || mockStatus.value.obsReady === true)

const recorderSessionActive = () =>
  ['waiting_cs2', 'recording', 'finalizing', 'clipping'].includes(
    cs2Status.value.recordingPhase
  )

async function runManualAction(
  fn: () => Promise<Cs2IntegrationStatus>
): Promise<void> {
  if (!window.csHero || manualBusy.value) return
  manualBusy.value = true
  manualActionError.value = ''
  try {
    cs2Status.value = await fn()
  } catch (err) {
    manualActionError.value = err instanceof Error ? err.message : String(err)
  } finally {
    manualBusy.value = false
  }
}

async function startManualRecording(): Promise<void> {
  await runManualAction(() => window.csHero!.startManualRecording())
}

async function stopManualRecording(): Promise<void> {
  await runManualAction(() => window.csHero!.stopManualRecording())
}

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
  unsubSettings = window.csHero?.onSettingsChanged((s) => {
    settingsHydrated = false
    settings.value = s
    void nextTick(() => {
      settingsHydrated = true
    })
  })
  unsubObsRuntime = window.csHero?.onObsRuntimeChanged((info) => {
    obsRuntime.value = info
  })
  unsubMatches = window.csHero?.onMatchesChanged((list) => {
    applyMatchesList(list)
    void refreshSelectedMatchDetail()
  })
  await refresh()
  await nextTick()
  settingsHydrated = true

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
  unsubSettings?.()
  unsubObsRuntime?.()
  unsubMatches?.()
  if (cs2PollTimer) clearInterval(cs2PollTimer)
  if (settingsApplyTimer) clearTimeout(settingsApplyTimer)
})

const gsiStateLabel = () => {
  const s = cs2Status.value.gsiServerState
  if (s === 'listening') return `GSI 监听中 :${cs2Status.value.gsiPort}`
  if (s === 'port_conflict') return 'GSI 端口冲突'
  if (s === 'failed') return 'GSI 启动失败'
  return 'GSI 未启动'
}

const formatTime = (iso: string) => {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('zh-CN')
  } catch {
    return iso
  }
}
</script>

<template>
  <main class="panel">
    <h1>CS Hero</h1>
    <p class="subtitle">竖切 4 · 设置 · 最近对局 · 自动录制状态</p>

    <section class="card">
      <h2 class="section-title">运行状态</h2>
      <div class="row">
        <span class="label">录制引擎</span>
        <span class="badge obs-badge" :data-ready="obsReady() ? 'yes' : 'no'">
          {{ obsReady() ? 'OBS 已就绪' : 'OBS 初始化中' }}
        </span>
      </div>
      <div class="row stats-row">
        <span class="stat">GSI: {{ gsiStateLabel() }}</span>
        <span class="stat">录制: {{ cs2Status.recordingPhase }}</span>
        <span v-if="obsRuntime" class="stat">
          {{ obsRuntime.recordingDisplayLabel }} · 输出 {{ obsRuntime.outputWidth }}×{{
            obsRuntime.outputHeight
          }}
          ({{ obsRuntime.recordingQuality }}) @{{ obsRuntime.recordingFps }}fps ·
          {{ Math.round(obsRuntime.videoBitrateKbps / 1000) }}Mbps
        </span>
        <span v-if="obsRuntime" class="stat">
          画布 {{ obsRuntime.baseWidth }}×{{ obsRuntime.baseHeight }} · 编码器:
          {{ obsRuntime.selectedEncoder }}
        </span>
        <span v-if="obsRuntime" class="stat">{{ obsRuntime.captureModeLabel }}</span>
        <p v-if="obsRuntime?.encoderWarning" class="message warn">{{ obsRuntime.encoderWarning }}</p>
      </div>
      <p class="message">{{ cs2Status.recordingMessage }}</p>
      <p v-if="cs2Status.gsiListenError" class="error">{{ cs2Status.gsiListenError }}</p>
      <p v-if="cs2Status.cfgNeedsCs2Restart || cs2Status.gsiPortAdjusted" class="message warn">
        <span v-if="cs2Status.cfgNeedsCs2Restart">GSI cfg 已更新，请重启 CS2。</span>
        <span v-if="cs2Status.gsiPortAdjusted"> 端口已调整，请重启 CS2。</span>
      </p>
      <div class="launch-option-box" :data-status="cs2Status.launchOptionStatus">
        <div class="row launch-option-header">
          <span class="label">CS2 启动项</span>
          <span class="launch-option-badge" :data-status="cs2Status.launchOptionStatus">
            {{ launchOptionStatusLabel() }}
          </span>
          <button
            type="button"
            class="link-btn"
            :disabled="launchOptionRefreshing"
            @click="refreshLaunchOptionStatus"
          >
            {{ launchOptionRefreshing ? '检测中…' : '再次检测' }}
          </button>
        </div>
        <p
          class="message"
          :class="cs2Status.launchOptionStatus === 'ok' ? 'subtle' : 'warn'"
        >
          {{ cs2Status.launchOptionMessage }}
        </p>
        <template v-if="cs2Status.launchOptionStatus !== 'ok'">
          <p class="message subtle">
            在 Steam → CS2 属性 → 启动选项中加入
            <code>{{ cs2Status.requiredLaunchOption }}</code>
            （与现有参数用空格分隔），保存后点击「再次检测」，并重启 CS2。
          </p>
          <p v-if="cs2Status.launchOptions !== undefined" class="message subtle">
            当前检测到：{{ cs2Status.launchOptions || '（空）' }}
          </p>
          <div class="row launch-option-actions">
            <button type="button" class="secondary-btn" @click="copyRequiredLaunchOption">
              复制启动项
            </button>
            <button type="button" class="secondary-btn" @click="openCs2SteamProperties">
              在 Steam 中打开 CS2
            </button>
          </div>
        </template>
        <p v-if="launchOptionActionMessage" class="message subtle">
          {{ launchOptionActionMessage }}
        </p>
      </div>
      <p class="label path-label">数据目录</p>
      <code class="path">{{ pocStatus.appDataRoot || '—' }}</code>
    </section>

    <section v-if="settings?.recordingMode === 'manual'" class="card manual-recording-card">
      <h2 class="section-title">手动录制 CS2</h2>
      <p class="message subtle">
        随时可点「开始录制」：CS2 未开时会等待游戏启动；已开则立即录制。不依赖 GSI，不生成击杀片段。目录名
        <code>manual_YYYYMMDD_HHMMSS</code>。
      </p>
      <div class="row manual-recording-actions">
        <button
          type="button"
          class="primary"
          :disabled="manualBusy || !obsReady() || recorderSessionActive()"
          @click="startManualRecording"
        >
          开始录制
        </button>
        <button
          type="button"
          class="secondary-btn"
          :disabled="manualBusy || !recorderSessionActive()"
          @click="stopManualRecording"
        >
          {{
            manualBusy && cs2Status.recordingPhase === 'finalizing'
              ? '处理中…'
              : cs2Status.recordingPhase === 'waiting_cs2'
                ? '取消'
                : '结束并保存'
          }}
        </button>
      </div>
      <p v-if="manualActionError" class="error">{{ manualActionError }}</p>
      <p v-if="cs2Status.matchId" class="message subtle">当前会话：{{ cs2Status.matchId }}</p>
    </section>

    <section v-else-if="settings" class="card">
      <h2 class="section-title">自动录制</h2>
      <p class="message subtle">
        进入对局后（GSI phase=warmup / live 等）自动开始录制，含热身；对局结束时自动停止并生成击杀片段。
      </p>
    </section>

    <section v-if="settings" class="card">
      <h2 class="section-title">录制设置</h2>
      <div class="form-grid">
        <label class="field">
          <span>录制模式</span>
          <select
            v-model="settings.recordingMode"
            :disabled="recorderSessionActive()"
          >
            <option value="auto">自动（GSI 开停）</option>
            <option value="manual">手动（开始 / 结束）</option>
          </select>
        </label>
        <p v-if="recorderSessionActive()" class="message warn">
          录制进行中，无法切换自动/手动模式。
        </p>
        <label class="field">
          <span>录制帧率</span>
          <select v-model.number="settings.recordingFps">
            <option :value="30">30</option>
            <option :value="60">60</option>
            <option :value="90">90</option>
            <option :value="120">120</option>
          </select>
        </label>
        <label class="field">
          <span>录制质量</span>
          <select v-model="settings.recordingQuality">
            <option value="720p">720p</option>
            <option value="1080p">1080p（默认）</option>
            <option value="1440p">1440p</option>
          </select>
        </label>
        <label class="field">
          <span>录制显示器</span>
          <select v-model.number="settings.recordingDisplayId">
            <option v-for="d in displays" :key="d.id" :value="d.id">
              {{ d.label }}
            </option>
          </select>
        </label>
        <p class="message subtle auto-hint">
          采集方式、WGC/DXGI 与 GPU/CPU 编码器均由程序自动选择最佳方案，无需手动配置。
        </p>
        <label class="field">
          <span>击杀片段前（秒）</span>
          <input v-model.number="settings.clipSecondsBefore" type="number" min="0" max="30" />
        </label>
        <label class="field">
          <span>击杀片段后（秒）</span>
          <input v-model.number="settings.clipSecondsAfter" type="number" min="0" max="30" />
        </label>
        <label class="field checkbox-field">
          <input v-model="settings.keepFullMatch" type="checkbox" />
          <span>保留整局录像（关闭则 clips 成功后删除 full_match）</span>
        </label>
      </div>
      <p v-if="settingsError" class="error">{{ settingsError }}</p>
      <p class="message subtle auto-hint">修改后立即生效；约 0.6 秒合并写入 settings.json。</p>
    </section>

    <section class="card">
      <div class="row">
        <h2 class="section-title">最近对局</h2>
        <button class="link-btn" type="button" @click="refreshMatches">刷新</button>
      </div>
      <p v-if="matches.length === 0" class="message">暂无对局，启动 CS2 或运行 Mock 对局后会出现在此。</p>
      <ul v-else class="match-list">
        <li
          v-for="m in matches"
          :key="m.id"
          class="match-item"
          :class="{ active: selectedMatchId === m.id }"
          @click="selectMatch(m.id)"
        >
          <span class="match-title">{{ m.map }} · {{ m.id }}</span>
          <span class="match-meta">
            {{ formatTime(m.start_time) }} · {{ m.clipCount }} clips · {{ m.status }}
            <span v-if="m.parseError" class="warn-inline">（{{ m.parseError }}）</span>
          </span>
        </li>
      </ul>
      <template v-if="matchDetail">
        <div class="detail-box">
          <p><strong>目录</strong> {{ matchDetail.dir }}</p>
          <p v-if="matchDetail.ended_reason"><strong>结束</strong> {{ matchDetail.ended_reason }}</p>
          <p v-if="matchDetail.capture_method"><strong>采集</strong> {{ matchDetail.capture_method }}</p>
          <p v-if="matchDetail.encoder"><strong>编码器</strong> {{ matchDetail.encoder }}</p>
          <p>
            <strong>片段</strong> {{ matchDetail.clipCount }} · <strong>书签</strong>
            {{ matchDetail.bookmarkCount }}
          </p>
          <ul v-if="matchDetail.clips.length" class="clip-list">
            <li v-for="c in matchDetail.clips" :key="c.file">{{ c.file }}</li>
          </ul>
          <button class="secondary-btn" type="button" @click="openMatchDir">打开对局文件夹</button>
        </div>
      </template>
    </section>

    <section class="card dev-card">
      <button class="dev-toggle" type="button" @click="devToolsOpen = !devToolsOpen">
        {{ devToolsOpen ? '▼' : '▶' }} 开发验证（竖切 1–3）
      </button>
      <template v-if="devToolsOpen">
        <div class="dev-block">
          <h3 class="dev-title">竖切 1 · PoC</h3>
          <span class="badge" :data-phase="pocStatus.phase">{{ pocStatus.phase }}</span>
          <p class="message">{{ pocStatus.message }}</p>
          <button class="primary" :disabled="!pocCanRecord()" @click="runPoc">
            {{ pocBusy ? '进行中…' : '录制 10 秒测试' }}
          </button>
        </div>
        <div class="dev-block">
          <h3 class="dev-title">竖切 2 · Mock</h3>
          <span class="badge" :data-phase="mockStatus.phase">{{ mockStatus.phase }}</span>
          <button class="primary secondary-btn" :disabled="!mockCanRun()" @click="runMock">
            {{ mockBusy ? '进行中…' : '运行 Mock 对局' }}
          </button>
        </div>
        <div class="dev-block">
          <h3 class="dev-title">竖切 3 · CS2 GSI</h3>
          <p v-if="cs2Status.lastMapName" class="message subtle">
            {{ cs2Status.lastMapName }} · K/D {{ cs2Status.lastKills ?? 0 }}/{{ cs2Status.lastDeaths ?? 0 }}
          </p>
          <template v-if="cs2Status.cfgPath">
            <code class="path">{{ cs2Status.cfgPath }}</code>
          </template>
        </div>
      </template>
    </section>
  </main>
</template>

<style scoped>
.panel {
  max-width: 720px;
  margin: 0 auto;
  padding-bottom: 32px;
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
  flex-wrap: wrap;
  gap: 12px;
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

.warn-inline {
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

.manual-recording-actions {
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.manual-recording-card {
  border-color: rgba(59, 130, 246, 0.35);
}

.badge[data-phase='waiting_cs2'],
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
  margin-top: 12px;
  padding: 12px;
  font-size: 1rem;
  font-weight: 600;
  border: none;
  border-radius: 10px;
  background: #3b82f6;
  color: #fff;
  cursor: pointer;
}

.save-btn {
  margin-top: 16px;
}

.secondary-btn {
  background: #6366f1;
}

.launch-option-box {
  margin-top: 12px;
  padding: 12px;
  border-radius: 10px;
  background: rgba(148, 163, 184, 0.06);
  border: 1px solid rgba(148, 163, 184, 0.2);
}

.launch-option-box[data-status='missing'] {
  background: rgba(251, 191, 36, 0.08);
  border-color: rgba(251, 191, 36, 0.25);
}

.launch-option-box[data-status='ok'] {
  background: rgba(34, 197, 94, 0.06);
  border-color: rgba(34, 197, 94, 0.2);
}

.launch-option-header {
  align-items: center;
  gap: 10px;
}

.launch-option-badge {
  font-size: 0.8rem;
  padding: 2px 8px;
  border-radius: 6px;
  background: #334155;
  color: #94a3b8;
}

.launch-option-badge[data-status='ok'] {
  background: rgba(34, 197, 94, 0.2);
  color: #86efac;
}

.launch-option-badge[data-status='missing'] {
  background: rgba(251, 191, 36, 0.2);
  color: #fcd34d;
}

.launch-option-actions {
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.link-btn {
  background: transparent;
  border: none;
  color: #93c5fd;
  cursor: pointer;
  font-size: 0.85rem;
}

.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.form-grid {
  display: grid;
  gap: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.85rem;
  color: #94a3b8;
}

.field select,
.field input[type='number'] {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid #2f3b4a;
  background: #0f172a;
  color: #e2e8f0;
}

.checkbox-field {
  flex-direction: row;
  align-items: flex-start;
  gap: 8px;
}

.auto-hint {
  margin-top: 4px;
  line-height: 1.45;
}

.match-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 240px;
  overflow-y: auto;
}

.match-item {
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid transparent;
}

.match-item:hover {
  background: #0f172a;
}

.match-item.active {
  border-color: #3b82f6;
  background: #1e293b;
}

.match-title {
  display: block;
  font-weight: 600;
  color: #e2e8f0;
}

.match-meta {
  font-size: 0.8rem;
  color: #94a3b8;
}

.detail-box {
  margin-top: 12px;
  padding: 12px;
  background: #0f172a;
  border-radius: 8px;
  font-size: 0.85rem;
}

.detail-box p {
  margin: 0 0 8px;
}

.clip-list {
  margin: 8px 0;
  padding-left: 18px;
  color: #cbd5e1;
}

.dev-toggle {
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  font-size: 0.9rem;
  padding: 0;
}

.dev-block {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid #2f3b4a;
}

.dev-title {
  margin: 0 0 8px;
  font-size: 0.9rem;
}
</style>
