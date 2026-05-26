<script setup lang="ts">
import { computed, onMounted, ref, toRaw } from 'vue'
import type { EditorExportTrimResult, EditorOpenRequest, EditorSession } from '../../shared/recording-types'

/** IPC 只能传递可结构化克隆的纯对象，不能传 Vue reactive 代理 */
function plainOpenRequest(req: EditorOpenRequest): EditorOpenRequest {
  const raw = toRaw(req)
  return {
    matchId: String(raw.matchId),
    source: raw.source,
    ...(raw.clipFile ? { clipFile: String(raw.clipFile) } : {})
  }
}

function parseEditorRequestFromUrl(): EditorOpenRequest | null {
  const params = new URLSearchParams(window.location.search)
  if (params.get('window') !== 'editor') return null
  const matchId = params.get('matchId')
  const source = params.get('source')
  if (!matchId || (source !== 'full_match' && source !== 'clip')) return null
  const clipFile = params.get('clipFile') ?? undefined
  return { matchId, source, clipFile }
}

const openRequest = ref<EditorOpenRequest | null>(parseEditorRequestFromUrl())
const session = ref<EditorSession | null>(null)
const loadError = ref('')
const videoRef = ref<HTMLVideoElement | null>(null)

const startSeconds = ref(0)
const endSeconds = ref(10)
const exportBusy = ref(false)
const deleteBusy = ref(false)
const actionError = ref('')
const lastExport = ref<EditorExportTrimResult | null>(null)

const durationLabel = computed(() => {
  const d = endSeconds.value - startSeconds.value
  if (!Number.isFinite(d) || d <= 0) return '—'
  return `${d.toFixed(1)} 秒`
})

const canExport = computed(
  () =>
    !!session.value &&
    !exportBusy.value &&
    endSeconds.value > startSeconds.value &&
    startSeconds.value >= 0
)

async function waitForBridge(maxMs = 4000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    if (window.csHero) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return !!window.csHero
}

async function loadSession(): Promise<void> {
  const bridged = await waitForBridge()
  if (!bridged) {
    loadError.value = '未连接主进程，请使用 pnpm dev 启动 Electron 窗口。'
    return
  }
  if (!openRequest.value) {
    loadError.value = '无效的剪辑会话参数'
    return
  }

  loadError.value = ''
  actionError.value = ''
  lastExport.value = null

  try {
    session.value = await window.csHero.getEditorSession(plainOpenRequest(openRequest.value))
    startSeconds.value = 0
    const video = videoRef.value
    if (video && Number.isFinite(video.duration) && video.duration > 0) {
      endSeconds.value = Math.min(10, video.duration)
    } else {
      endSeconds.value = 10
    }
  } catch (err) {
    session.value = null
    loadError.value = err instanceof Error ? err.message : String(err)
  }
}

function onVideoLoadedMetadata(): void {
  const video = videoRef.value
  if (!video || !Number.isFinite(video.duration)) return
  if (endSeconds.value <= 0 || endSeconds.value > video.duration) {
    endSeconds.value = Math.min(10, video.duration)
  }
}

function onVideoError(): void {
  const video = videoRef.value
  const code = video?.error?.code
  const hint =
    code === 4
      ? '无法解码该视频（编码格式可能不受支持）'
      : '视频加载失败，请确认文件存在且未被占用'
  actionError.value = hint
}

function currentVideoTime(): number {
  return videoRef.value?.currentTime ?? 0
}

function setStartFromPlayhead(): void {
  startSeconds.value = Math.max(0, currentVideoTime())
}

function setEndFromPlayhead(): void {
  const t = currentVideoTime()
  const video = videoRef.value
  const max = video && Number.isFinite(video.duration) ? video.duration : t + 10
  endSeconds.value = Math.min(Math.max(t, startSeconds.value + 0.1), max)
}

async function runExport(): Promise<void> {
  if (!window.csHero || !session.value || !openRequest.value || exportBusy.value) return
  exportBusy.value = true
  actionError.value = ''
  try {
    const req = plainOpenRequest(openRequest.value)
    lastExport.value = await window.csHero.exportTrim({
      ...req,
      startSeconds: startSeconds.value,
      endSeconds: endSeconds.value
    })
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err)
  } finally {
    exportBusy.value = false
  }
}

async function runDeleteClip(): Promise<void> {
  if (!window.csHero || !session.value || !openRequest.value?.clipFile || deleteBusy.value) return
  if (!confirm(`确定删除片段 ${openRequest.value.clipFile}？此操作不可恢复。`)) return

  deleteBusy.value = true
  actionError.value = ''
  try {
    await window.csHero.deleteClip(openRequest.value.matchId, openRequest.value.clipFile)
    window.close()
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err)
  } finally {
    deleteBusy.value = false
  }
}

async function openExports(): Promise<void> {
  if (!window.csHero) return
  try {
    await window.csHero.openExportsDir()
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err)
  }
}

onMounted(() => {
  void loadSession()
})
</script>

<template>
  <main class="editor-panel">
    <header class="editor-header">
      <div>
        <h1>剪辑与导出</h1>
        <p v-if="session" class="subtitle">
          {{ session.map }} · {{ session.matchId }} · {{ session.displayName }}
        </p>
        <p v-else class="subtitle">加载中…</p>
      </div>
    </header>

    <p v-if="loadError" class="error">{{ loadError }}</p>

    <template v-else-if="session">
      <section class="card video-card">
        <video
          ref="videoRef"
          class="preview-video"
          :src="session.sourceVideoUrl"
          controls
          preload="metadata"
          @loadedmetadata="onVideoLoadedMetadata"
          @error="onVideoError"
        />
        <p class="path-hint">{{ session.sourceVideoPath }}</p>
      </section>

      <section class="card">
        <h2 class="section-title">裁剪区间</h2>
        <div class="trim-grid">
          <label class="field">
            <span>起点（秒）</span>
            <input v-model.number="startSeconds" type="number" min="0" step="0.1" />
          </label>
          <label class="field">
            <span>终点（秒）</span>
            <input v-model.number="endSeconds" type="number" min="0" step="0.1" />
          </label>
          <p class="duration-hint">时长：{{ durationLabel }}</p>
        </div>
        <div class="btn-row">
          <button class="secondary-btn" type="button" @click="setStartFromPlayhead">
            当前时间设为起点
          </button>
          <button class="secondary-btn" type="button" @click="setEndFromPlayhead">
            当前时间设为终点
          </button>
        </div>
      </section>

      <section class="card actions-card">
        <div class="btn-row primary-row">
          <button class="primary" type="button" :disabled="!canExport" @click="runExport">
            {{ exportBusy ? '导出中…' : '导出到 exports' }}
          </button>
          <button class="secondary-btn" type="button" @click="openExports">打开导出目录</button>
          <button
            v-if="session.canDelete && openRequest?.clipFile"
            class="danger-btn"
            type="button"
            :disabled="deleteBusy"
            @click="runDeleteClip"
          >
            {{ deleteBusy ? '删除中…' : '删除此片段' }}
          </button>
        </div>
        <p v-if="actionError" class="error">{{ actionError }}</p>
        <p v-if="lastExport" class="success">
          已导出：<code>{{ lastExport.outputPath }}</code>（约 {{ lastExport.durationSeconds.toFixed(1) }} 秒）
        </p>
      </section>
    </template>
  </main>
</template>

<style scoped>
.editor-panel {
  max-width: 960px;
  margin: 0 auto;
  padding: 20px 24px 32px;
}

.editor-header {
  margin-bottom: 16px;
}

h1 {
  margin: 0 0 4px;
  font-size: 1.5rem;
}

.subtitle {
  margin: 0;
  color: #8b98a5;
  font-size: 0.9rem;
}

.card {
  background: #1a2332;
  border: 1px solid #2f3b4a;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
}

.section-title {
  margin: 0 0 12px;
  font-size: 1rem;
  font-weight: 600;
}

.preview-video {
  width: 100%;
  max-height: 420px;
  border-radius: 8px;
  background: #000;
}

.path-hint {
  margin: 10px 0 0;
  font-size: 0.75rem;
  color: #64748b;
  word-break: break-all;
}

.trim-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  align-items: end;
}

.duration-hint {
  grid-column: 1 / -1;
  margin: 0;
  font-size: 0.85rem;
  color: #94a3b8;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.85rem;
  color: #94a3b8;
}

.field input {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid #2f3b4a;
  background: #0f172a;
  color: #e2e8f0;
}

.btn-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.primary-row {
  margin-top: 0;
}

.primary {
  padding: 10px 20px;
  font-size: 1rem;
  font-weight: 600;
  border: none;
  border-radius: 10px;
  background: #3b82f6;
  color: #fff;
  cursor: pointer;
}

.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.secondary-btn {
  padding: 10px 16px;
  border: none;
  border-radius: 10px;
  background: #6366f1;
  color: #fff;
  cursor: pointer;
  font-size: 0.9rem;
}

.danger-btn {
  padding: 10px 16px;
  border: none;
  border-radius: 10px;
  background: #b91c1c;
  color: #fff;
  cursor: pointer;
  font-size: 0.9rem;
}

.danger-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.error {
  color: #f87171;
  font-size: 0.9rem;
}

.success {
  margin-top: 12px;
  color: #86efac;
  font-size: 0.85rem;
}

.success code {
  display: block;
  margin-top: 4px;
  word-break: break-all;
  color: #cbd5e1;
}
</style>
