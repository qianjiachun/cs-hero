<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, toRaw, watch } from 'vue'
import EventTimeline from './components/EventTimeline.vue'
import type { TimelineMarkerView } from './components/EventTimeline.vue'
import type {
  BookmarkType,
  EditorExportTrimResult,
  EditorOpenRequest,
  EditorSession,
  FfmpegJobStatus,
  MergeCandidates,
  MergeCreateRequest,
  MergeResult,
  MergeSelectionItem
} from '../../shared/recording-types'

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
const mergeCandidates = ref<MergeCandidates | null>(null)
const loadError = ref('')
const videoRef = ref<HTMLVideoElement | null>(null)
const mediaTime = ref(0)
const previewTime = ref(0)
const isScrubbing = ref(false)
const isSeeking = ref(false)
const pendingSeekTime = ref<number | null>(null)
const wasPlayingBeforeScrub = ref(false)
const seekHint = ref('')
/** 拖动预览时 fastSeek 节流，避免频繁精确 seek */
const FAST_SEEK_INTERVAL_MS = 120
let lastFastSeekAt = 0

const startSeconds = ref(0)
const endSeconds = ref(10)
const exportBusy = ref(false)
const deleteBusy = ref(false)
const actionError = ref('')
const lastExport = ref<EditorExportTrimResult | null>(null)
const lastMerge = ref<MergeResult | null>(null)

const activeJob = ref<FfmpegJobStatus | null>(null)
let unsubJob: (() => void) | undefined

const selectedClipFiles = ref<Set<string>>(new Set())
const selectedBookmarkIndices = ref<Set<number>>(new Set())
const mergeBusy = ref(false)

const durationSeconds = computed(() => {
  const meta = session.value?.metadata?.durationSeconds
  if (meta && meta > 0) return meta
  const v = videoRef.value
  if (v && Number.isFinite(v.duration) && v.duration > 0) return v.duration
  return 0
})

const timelineMarkers = computed((): TimelineMarkerView[] => {
  if (!session.value?.bookmarks?.length) return []
  return session.value.bookmarks.map((b, index) => ({
    type: b.type,
    time: b.time,
    index
  }))
})

const timelineScrubDisabled = computed(() => durationSeconds.value <= 0)

const showTimelineMarkers = computed(() => openRequest.value?.source === 'full_match')

const displayTime = computed(() => (isScrubbing.value ? previewTime.value : mediaTime.value))

const isPlaying = ref(false)

function clampTime(time: number): number {
  const max = durationSeconds.value
  if (max > 0) return Math.max(0, Math.min(time, max))
  return Math.max(0, time)
}

function applyVideoSeek(time: number, mode: 'fast' | 'precise'): void {
  const video = videoRef.value
  if (!video) return
  const t = clampTime(time)

  if (mode === 'fast') {
    const now = performance.now()
    if (now - lastFastSeekAt < FAST_SEEK_INTERVAL_MS) return
    lastFastSeekAt = now
    previewTime.value = t
    if (typeof video.fastSeek === 'function') {
      try {
        video.fastSeek(t)
      } catch {
        video.currentTime = t
      }
    } else {
      video.currentTime = t
    }
    return
  }

  if (Math.abs(video.currentTime - t) < 0.05) {
    mediaTime.value = t
    previewTime.value = t
    pendingSeekTime.value = null
    isScrubbing.value = false
    isSeeking.value = false
    return
  }

  pendingSeekTime.value = t
  previewTime.value = t
  isScrubbing.value = true
  video.currentTime = t
}

function commitSeek(time: number): void {
  applyVideoSeek(time, 'precise')
}

function togglePlay(): void {
  const video = videoRef.value
  if (!video) return
  if (video.paused) {
    void video.play()
  } else {
    video.pause()
  }
}

function onVideoPlay(): void {
  isPlaying.value = true
}

function onVideoPause(): void {
  isPlaying.value = false
}

const durationLabel = computed(() => {
  const d = endSeconds.value - startSeconds.value
  if (!Number.isFinite(d) || d <= 0) return '—'
  return `${d.toFixed(1)} 秒`
})

const selectedMergeCount = computed(
  () => selectedClipFiles.value.size + selectedBookmarkIndices.value.size
)

const estimatedMergeDuration = computed(() => {
  if (!mergeCandidates.value) return 0
  let total = 0
  for (const f of selectedClipFiles.value) {
    const c = mergeCandidates.value.clips.find((x) => x.file === f)
    if (c?.durationSeconds) total += c.durationSeconds
    else total += (session.value?.clipSecondsBefore ?? 5) + (session.value?.clipSecondsAfter ?? 5)
  }
  const perBm =
    (session.value?.clipSecondsBefore ?? 5) + (session.value?.clipSecondsAfter ?? 5)
  total += selectedBookmarkIndices.value.size * perBm
  return total
})

const canExport = computed(
  () =>
    !!session.value &&
    !exportBusy.value &&
    !mergeBusy.value &&
    endSeconds.value > startSeconds.value &&
    startSeconds.value >= 0
)

const canMerge = computed(
  () => !!session.value && !mergeBusy.value && !exportBusy.value && selectedMergeCount.value >= 2
)

async function waitForBridge(maxMs = 4000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    if (window.csHero) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return !!window.csHero
}

async function loadMergeCandidates(): Promise<void> {
  if (!window.csHero || !openRequest.value) return
  try {
    mergeCandidates.value = await window.csHero.getMergeCandidates(openRequest.value.matchId)
  } catch {
    mergeCandidates.value = null
  }
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
  lastMerge.value = null
  selectedClipFiles.value = new Set()
  selectedBookmarkIndices.value = new Set()

  try {
    session.value = await window.csHero.getEditorSession(plainOpenRequest(openRequest.value))
    startSeconds.value = 0
    const dur = session.value.metadata?.durationSeconds ?? 0
    endSeconds.value = dur > 0 ? Math.min(10, dur) : 10
    mediaTime.value = 0
    previewTime.value = 0
    isScrubbing.value = false
    pendingSeekTime.value = null
    seekHint.value = ''
    await loadMergeCandidates()
  } catch (err) {
    session.value = null
    loadError.value = err instanceof Error ? err.message : String(err)
  }
}

function onVideoTimeUpdate(): void {
  const video = videoRef.value
  if (!video || isScrubbing.value) return
  mediaTime.value = video.currentTime
}

function onVideoLoadedMetadata(): void {
  const video = videoRef.value
  if (!video || !Number.isFinite(video.duration)) return
  if (!isScrubbing.value) {
    mediaTime.value = video.currentTime
  }
  if (endSeconds.value <= 0 || endSeconds.value > video.duration) {
    endSeconds.value = Math.min(10, video.duration)
  }
}

function onVideoDurationChange(): void {
  const video = videoRef.value
  if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return
  if (endSeconds.value > video.duration) {
    endSeconds.value = video.duration
  }
}

function onVideoSeeking(): void {
  if (isScrubbing.value && pendingSeekTime.value === null) {
    return
  }
  isSeeking.value = true
}

function onVideoSeeked(): void {
  const video = videoRef.value
  if (!video) return
  isSeeking.value = false

  const pending = pendingSeekTime.value
  if (pending !== null) {
    mediaTime.value = video.currentTime
    previewTime.value = video.currentTime
    isScrubbing.value = false

    if (Math.abs(video.currentTime - pending) > 0.5) {
      seekHint.value = '定位可能存在偏差（关键帧间隔）'
    } else {
      seekHint.value = ''
    }
    pendingSeekTime.value = null

    if (wasPlayingBeforeScrub.value) {
      wasPlayingBeforeScrub.value = false
      void video.play()
    }
    return
  }

  if (isScrubbing.value) {
    mediaTime.value = video.currentTime
    return
  }

  mediaTime.value = video.currentTime
  previewTime.value = video.currentTime
}

function onScrubStart(time: number): void {
  const video = videoRef.value
  if (!video) return
  wasPlayingBeforeScrub.value = !video.paused
  if (wasPlayingBeforeScrub.value) {
    video.pause()
  }
  isScrubbing.value = true
  lastFastSeekAt = 0
  previewTime.value = clampTime(time)
  seekHint.value = ''
}

function onScrubPreview(time: number): void {
  const t = clampTime(time)
  previewTime.value = t
  if (isScrubbing.value) {
    applyVideoSeek(t, 'fast')
  }
}

function onScrubCommit(time: number): void {
  commitSeek(time)
}

function seekByDelta(delta: number): void {
  commitSeek(displayTime.value + delta)
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

function setStartFromPlayhead(): void {
  startSeconds.value = Math.max(0, displayTime.value)
}

function setEndFromPlayhead(): void {
  const t = displayTime.value
  const max = durationSeconds.value > 0 ? durationSeconds.value : t + 10
  endSeconds.value = Math.min(Math.max(t, startSeconds.value + 0.1), max)
}

function onMarkerClick(marker: TimelineMarkerView): void {
  if (!session.value) return
  const before = session.value.clipSecondsBefore
  const after = session.value.clipSecondsAfter
  const max = durationSeconds.value
  startSeconds.value = Math.max(0, marker.time - before)
  endSeconds.value = max > 0 ? Math.min(max, marker.time + after) : marker.time + after
}

function onEditorKeyDown(e: KeyboardEvent): void {
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

  if (e.code === 'Space') {
    e.preventDefault()
    togglePlay()
    return
  }

  if (e.code === 'ArrowLeft') {
    e.preventDefault()
    seekByDelta(e.shiftKey ? -5 : -1)
    return
  }

  if (e.code === 'ArrowRight') {
    e.preventDefault()
    seekByDelta(e.shiftKey ? 5 : 1)
  }
}

function toggleClip(file: string): void {
  const next = new Set(selectedClipFiles.value)
  if (next.has(file)) next.delete(file)
  else next.add(file)
  selectedClipFiles.value = next
}

function toggleBookmark(index: number): void {
  const next = new Set(selectedBookmarkIndices.value)
  if (next.has(index)) next.delete(index)
  else next.add(index)
  selectedBookmarkIndices.value = next
}

function bookmarkTypeLabel(type: BookmarkType): string {
  return type === 'kill' ? '击杀' : '死亡'
}

function buildMergeSelections(): MergeSelectionItem[] {
  if (!mergeCandidates.value) return []
  const withTime: Array<{ item: MergeSelectionItem; time: number }> = []
  for (const c of mergeCandidates.value.clips) {
    if (selectedClipFiles.value.has(c.file)) {
      withTime.push({
        item: { kind: 'clip', clipFile: c.file },
        time: c.time ?? 0
      })
    }
  }
  for (const b of mergeCandidates.value.bookmarks) {
    if (selectedBookmarkIndices.value.has(b.index)) {
      withTime.push({
        item: { kind: 'bookmark', bookmarkIndex: b.index },
        time: b.time
      })
    }
  }
  withTime.sort((a, b) => a.time - b.time)
  return withTime.map((x) => x.item)
}

function sortSelectionsByTime(): void {
  if (!mergeCandidates.value) return
  const clips = [...selectedClipFiles.value].sort((a, b) => {
    const ta = mergeCandidates.value!.clips.find((c) => c.file === a)?.time ?? 0
    const tb = mergeCandidates.value!.clips.find((c) => c.file === b)?.time ?? 0
    return ta - tb
  })
  const bms = [...selectedBookmarkIndices.value].sort((a, b) => {
    const ta = mergeCandidates.value!.bookmarks.find((x) => x.index === a)?.time ?? 0
    const tb = mergeCandidates.value!.bookmarks.find((x) => x.index === b)?.time ?? 0
    return ta - tb
  })
  selectedClipFiles.value = new Set(clips)
  selectedBookmarkIndices.value = new Set(bms)
}

async function runExport(): Promise<void> {
  if (!window.csHero || !session.value || !openRequest.value || exportBusy.value) return
  exportBusy.value = true
  actionError.value = ''
  activeJob.value = null
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

async function runMerge(exportOnly: boolean): Promise<void> {
  if (!window.csHero || !openRequest.value || mergeBusy.value) return
  const selections = buildMergeSelections()
  if (selections.length < 2) {
    actionError.value = '请至少选择 2 个片段'
    return
  }

  mergeBusy.value = true
  actionError.value = ''
  activeJob.value = null
  lastMerge.value = null

  const request: MergeCreateRequest = {
    matchId: openRequest.value.matchId,
    selections,
    exportOnly
  }

  try {
    lastMerge.value = exportOnly
      ? await window.csHero.exportMergedVideo(request)
      : await window.csHero.createMergedVideo(request)
    if (lastMerge.value.usedCompatMode) {
      actionError.value = ''
    }
    await loadMergeCandidates()
    if (session.value) {
      session.value = { ...session.value, hasMergedVideo: !exportOnly || session.value.hasMergedVideo }
    }
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err)
  } finally {
    mergeBusy.value = false
  }
}

async function cancelActiveJob(): Promise<void> {
  if (!window.csHero || !activeJob.value?.jobId) return
  try {
    await window.csHero.cancelFfmpegJob(activeJob.value.jobId)
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err)
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

watch(activeJob, (job) => {
  if (job?.phase === 'failed' && job.error) {
    actionError.value = job.error
  }
})

onMounted(() => {
  void loadSession()
  window.addEventListener('keydown', onEditorKeyDown)
  unsubJob = window.csHero?.onFfmpegJobStatusChanged((status) => {
    activeJob.value = status
    if (status.phase === 'completed' || status.phase === 'failed' || status.phase === 'cancelled') {
      if (status.phase !== 'running') {
        /* keep last status visible */
      }
    }
  })
})

onUnmounted(() => {
  window.removeEventListener('keydown', onEditorKeyDown)
  unsubJob?.()
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
        <p v-if="session?.metadata && durationSeconds > 0" class="meta-line">
          时长 {{ durationSeconds.toFixed(1) }}s
          <span v-if="session.metadata.width">
            · {{ session.metadata.width }}×{{ session.metadata.height }}
          </span>
          <span v-if="session.metadata.fps"> · {{ session.metadata.fps.toFixed(0) }} fps</span>
        </p>
        <p v-else-if="session?.metadata?.probeError" class="warn">{{ session.metadata.probeError }}</p>
      </div>
    </header>

    <p v-if="loadError" class="error">{{ loadError }}</p>

    <template v-else-if="session">
      <section class="card video-card">
        <div class="video-player">
          <video
            ref="videoRef"
            class="preview-video"
            :src="session.sourceVideoUrl"
            preload="auto"
            playsinline
            @click="togglePlay"
            @loadedmetadata="onVideoLoadedMetadata"
            @durationchange="onVideoDurationChange"
            @timeupdate="onVideoTimeUpdate"
            @seeking="onVideoSeeking"
            @seeked="onVideoSeeked"
            @play="onVideoPlay"
            @pause="onVideoPause"
            @error="onVideoError"
          />
          <div class="transport">
            <button class="transport-btn" type="button" :title="isPlaying ? '暂停' : '播放'" @click="togglePlay">
              {{ isPlaying ? '暂停' : '播放' }}
            </button>
            <span v-if="isSeeking" class="seeking-hint">定位中…</span>
          </div>
          <p v-if="seekHint" class="seek-hint">{{ seekHint }}</p>
          <EventTimeline
            :duration="durationSeconds"
            :current-time="displayTime"
            :markers="timelineMarkers"
            :trim-start="startSeconds"
            :trim-end="endSeconds"
            :disabled="timelineScrubDisabled"
            :show-markers="showTimelineMarkers"
            @scrub-start="onScrubStart"
            @scrub-preview="onScrubPreview"
            @scrub-commit="onScrubCommit"
            @marker-click="onMarkerClick"
          />
          <p v-if="showTimelineMarkers" class="legend">
            <span class="dot kill" /> 击杀
            <span class="dot death" /> 死亡
          </p>
        </div>
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
      </section>

      <section v-if="mergeCandidates" class="card">
        <h2 class="section-title">合并导出</h2>
        <p v-if="session.hasMergedVideo" class="message success subtle">
          对局目录已有 merged.mp4，重新生成将覆盖。
        </p>

        <h3 class="group-title">文件片段</h3>
        <ul v-if="mergeCandidates.clips.length" class="merge-list">
          <li v-for="c in mergeCandidates.clips" :key="c.file">
            <label class="merge-row">
              <input
                type="checkbox"
                :checked="selectedClipFiles.has(c.file)"
                @change="toggleClip(c.file)"
              />
              <span>{{ c.file }}</span>
              <span v-if="c.durationSeconds" class="meta">{{ c.durationSeconds.toFixed(1) }}s</span>
            </label>
          </li>
        </ul>
        <p v-else class="message subtle">暂无 clip 文件</p>

        <h3 class="group-title">事件锚点</h3>
        <ul v-if="mergeCandidates.bookmarks.length" class="merge-list">
          <li v-for="b in mergeCandidates.bookmarks" :key="b.index">
            <label class="merge-row" :class="{ disabled: !mergeCandidates.hasFullMatch }">
              <input
                type="checkbox"
                :disabled="!mergeCandidates.hasFullMatch"
                :checked="selectedBookmarkIndices.has(b.index)"
                @change="toggleBookmark(b.index)"
              />
              <span :class="['tag', b.type]">{{ bookmarkTypeLabel(b.type) }}</span>
              <span>{{ b.time.toFixed(1) }}s</span>
            </label>
          </li>
        </ul>
        <p v-else class="message subtle">暂无事件锚点</p>
        <p v-if="!mergeCandidates.hasFullMatch" class="message warn">
          整局录像不存在时，无法按事件锚点裁切；仍可选择已有 clip 合并。
        </p>

        <p class="message subtle">
          已选 {{ selectedMergeCount }} 项 · 预计约 {{ estimatedMergeDuration.toFixed(1) }} 秒
        </p>

        <div class="btn-row">
          <button class="secondary-btn" type="button" @click="sortSelectionsByTime">按时间排序</button>
        </div>
        <div class="btn-row primary-row">
          <button class="primary" type="button" :disabled="!canMerge" @click="runMerge(false)">
            {{ mergeBusy ? '合并中…' : '生成 merged.mp4' }}
          </button>
          <button class="secondary-btn" type="button" :disabled="!canMerge" @click="runMerge(true)">
            导出到 exports
          </button>
        </div>
      </section>

      <section v-if="activeJob && (exportBusy || mergeBusy)" class="card job-card">
        <p class="job-message">{{ activeJob.message }} ({{ activeJob.progress }}%)</p>
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: `${activeJob.progress}%` }" />
        </div>
        <button
          v-if="activeJob.phase === 'running'"
          class="secondary-btn"
          type="button"
          @click="cancelActiveJob"
        >
          取消
        </button>
      </section>

      <section class="card actions-card">
        <p v-if="actionError" class="error">{{ actionError }}</p>
        <p v-if="lastExport" class="success">
          已导出：<code>{{ lastExport.outputPath }}</code>（约
          {{ lastExport.durationSeconds.toFixed(1) }} 秒）
        </p>
        <p v-if="lastMerge" class="success">
          合并完成：<code>{{ lastMerge.outputPath }}</code>
          <span v-if="lastMerge.usedCompatMode">（已使用兼容编码）</span>
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

.subtitle,
.meta-line {
  margin: 0;
  color: #8b98a5;
  font-size: 0.9rem;
}

.meta-line {
  margin-top: 4px;
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

.group-title {
  margin: 16px 0 8px;
  font-size: 0.9rem;
  color: #94a3b8;
}

.video-player {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.preview-video {
  width: 100%;
  max-height: 420px;
  border-radius: 8px;
  background: #000;
  cursor: pointer;
}

.transport {
  display: flex;
  align-items: center;
  gap: 8px;
}

.transport-btn {
  padding: 6px 14px;
  border: none;
  border-radius: 8px;
  background: #334155;
  color: #e2e8f0;
  font-size: 0.85rem;
  cursor: pointer;
}

.transport-btn:hover {
  background: #475569;
}

.seeking-hint,
.seek-hint {
  font-size: 0.8rem;
  color: #94a3b8;
}

.seek-hint {
  margin: 0;
  color: #fcd34d;
}

.legend {
  margin: 8px 0 0;
  font-size: 0.8rem;
  color: #94a3b8;
  display: flex;
  gap: 16px;
  align-items: center;
}

.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 4px;
}

.dot.kill {
  background: #22c55e;
}

.dot.death {
  background: #ef4444;
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

.merge-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.merge-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  font-size: 0.9rem;
  cursor: pointer;
}

.merge-row.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.merge-row .meta {
  margin-left: auto;
  color: #64748b;
  font-size: 0.8rem;
}

.tag {
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: 4px;
}

.tag.kill {
  background: #14532d;
  color: #86efac;
}

.tag.death {
  background: #7f1d1d;
  color: #fca5a5;
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

.message {
  margin: 8px 0;
  font-size: 0.85rem;
}

.message.subtle {
  color: #94a3b8;
}

.message.warn,
.warn {
  color: #fcd34d;
  font-size: 0.85rem;
}

.error {
  color: #f87171;
  font-size: 0.9rem;
}

.success {
  color: #86efac;
  font-size: 0.85rem;
}

.success code {
  display: block;
  margin-top: 4px;
  word-break: break-all;
  color: #cbd5e1;
}

.job-message {
  margin: 0 0 8px;
  font-size: 0.9rem;
}

.progress-bar {
  height: 6px;
  background: #0f172a;
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 10px;
}

.progress-fill {
  height: 100%;
  background: #3b82f6;
  transition: width 0.15s ease;
}
</style>
