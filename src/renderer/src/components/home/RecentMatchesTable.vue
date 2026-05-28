<script setup lang="ts">
import { computed, ref } from 'vue'
import { FolderOpen, MoreVertical, Play, Waves } from 'lucide-vue-next'
import { getMapImageUrl } from '../../../../shared/map-images'
import type { ContentMatchSummary } from '../../../../shared/recording-types'
import type { KillClipView } from '../../lib/kill-clip-strip-layout'
import { formatRelativeMatchTime, parseMatchTime } from '../../lib/time-format'
import { useMotion } from '../../motion/useMotion'
import KillClipStrip from './KillClipStrip.vue'

export type { KillClipView }

export interface MatchRowView extends ContentMatchSummary {
  killClips: KillClipView[]
}

const props = defineProps<{
  rows: MatchRowView[]
  loading: boolean
  hasMore: boolean
}>()

const emit = defineEmits<{
  (e: 'load-more'): void
  (e: 'play', match: MatchRowView): void
  (e: 'open-folder', match: MatchRowView): void
}>()

const { run, staggerDelay } = useMotion()
const tableBody = ref<HTMLElement | null>(null)

const sortedRows = computed(() => {
  const list = [...props.rows]
  list.sort((a, b) => {
    const ta = parseMatchTime(a.start_time)?.getTime() ?? 0
    const tb = parseMatchTime(b.start_time)?.getTime() ?? 0
    return tb - ta
  })
  return list
})

function mapThumb(mapName: string): string | null {
  return getMapImageUrl(mapName)
}

function matchTimeLabel(row: ContentMatchSummary): string {
  const d = parseMatchTime(row.start_time)
  return d ? formatRelativeMatchTime(d) : '—'
}

function animateRows(): void {
  const body = tableBody.value
  if (!body) return
  const items = body.querySelectorAll('.match-row')
  if (!items.length) return
  run(items, {
    opacity: [0, 1],
    translateY: [8, 0],
    duration: 220,
    delay: staggerDelay(36),
    ease: 'outCubic'
  })
}

defineExpose({ animateRows })

function voiceSummaryLabel(): { text: string; tone: 'ready' | 'empty' } {
  return { text: '未生成', tone: 'empty' }
}
</script>

<template>
  <section class="panel-card matches-card">
    <header class="matches-header">
      <h2 class="card-title">最近对局</h2>
    </header>

    <div class="table-scroll">
      <table class="matches-table">
        <colgroup>
          <col style="width: 232px" />
          <col />
          <col style="width: 100px" />
          <col style="width: 112px" />
        </colgroup>
        <thead>
          <tr>
            <th class="col-info">对局信息</th>
            <th class="col-clips">击杀片段</th>
            <th class="col-voice">语音总结</th>
            <th class="col-actions">操作</th>
          </tr>
        </thead>
        <tbody ref="tableBody">
          <tr v-if="loading && rows.length === 0">
            <td colspan="4" class="empty-cell">加载对局数据…</td>
          </tr>
          <tr v-else-if="!loading && rows.length === 0">
            <td colspan="4" class="empty-cell">暂无对局记录，开始一局 CS2 即可自动录制</td>
          </tr>
          <tr
            v-for="row in sortedRows"
            :key="row.id"
            class="match-row"
          >
            <td class="col-info">
              <div class="match-info">
                <div class="map-thumb">
                  <img
                    v-if="mapThumb(row.map)"
                    :src="mapThumb(row.map)!"
                    :alt="row.map"
                    loading="lazy"
                  />
                  <div v-else class="map-fallback">{{ row.map.slice(0, 1) }}</div>
                </div>
                <div class="match-meta">
                  <span class="map-name">{{ row.map }}</span>
                  <span class="match-rel">{{ matchTimeLabel(row) }}</span>
                </div>
              </div>
            </td>
            <td class="col-clips cell-clips">
              <KillClipStrip :row-id="row.id" :clips="row.killClips" />
            </td>
            <td class="col-voice">
              <div class="voice-cell" :class="voiceSummaryLabel().tone">
                <Waves :size="14" :stroke-width="2" />
                <span>{{ voiceSummaryLabel().text }}</span>
              </div>
            </td>
            <td class="col-actions">
              <div class="action-group">
                <button
                  type="button"
                  class="action-btn"
                  title="播放"
                  @click="emit('play', row)"
                >
                  <Play :size="14" :stroke-width="2.25" />
                </button>
                <button
                  type="button"
                  class="action-btn"
                  title="打开文件夹"
                  @click="emit('open-folder', row)"
                >
                  <FolderOpen :size="15" :stroke-width="2" />
                </button>
                <button type="button" class="action-btn" title="更多" disabled>
                  <MoreVertical :size="15" :stroke-width="2" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="hasMore" class="load-more-wrap">
      <button type="button" class="load-more-btn" :disabled="loading" @click="emit('load-more')">
        {{ loading ? '加载中…' : '加载更多' }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.matches-card {
  min-width: 0;
}

.matches-header {
  margin-bottom: 12px;
}

.card-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.table-scroll {
  overflow-x: auto;
  border-radius: 6px;
  -webkit-overflow-scrolling: touch;
}

.matches-table {
  width: 100%;
  min-width: 560px;
  table-layout: fixed;
  border-collapse: collapse;
  border-spacing: 0;
  font-size: 13px;
}

.matches-table th {
  text-align: left;
  padding: 10px;
  vertical-align: middle;
  color: var(--text-secondary);
  font-weight: 600;
  font-size: 12px;
  line-height: 1;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid var(--border-color);
  white-space: nowrap;
}

.matches-table tbody tr.match-row:first-child td {
  padding-top: 14px;
}

.matches-table td {
  padding: 6px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  vertical-align: middle;
  overflow: hidden;
  text-overflow: ellipsis;
}

.match-row:last-child td {
  border-bottom: none;
}

.match-row:hover td {
  background: rgba(255, 255, 255, 0.025);
}

.empty-cell {
  text-align: center;
  color: var(--text-muted);
  padding: 28px 16px !important;
}

.cell-clips {
  overflow: hidden;
}

.col-info {
  width: 232px;
}

.col-voice {
  white-space: nowrap;
}

.col-actions {
  white-space: nowrap;
  overflow: visible;
}

td.col-actions {
  overflow: visible;
}

.match-info {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.map-thumb {
  width: 76px;
  aspect-ratio: 4 / 3;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.map-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.map-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 18px;
  color: var(--text-muted);
  text-transform: uppercase;
}

.match-meta {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
  line-height: 1.35;
}

.map-name {
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.match-rel {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
}

.voice-cell {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-muted);
  white-space: nowrap;
}

.voice-cell.ready {
  color: #a5b4fc;
}

.voice-cell.ready :deep(svg) {
  color: #a5b4fc;
}

.action-group {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  flex-wrap: nowrap;
}

.action-btn {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    color 0.2s ease,
    border-color 0.2s ease;
}

.action-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-primary);
}

.action-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.load-more-wrap {
  display: flex;
  justify-content: center;
  margin-top: 12px;
}

.load-more-btn {
  padding: 8px 16px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    color 0.2s ease;
}

.load-more-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-primary);
}

.load-more-btn:disabled {
  opacity: 0.6;
  cursor: wait;
}
</style>
