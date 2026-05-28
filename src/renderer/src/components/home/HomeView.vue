<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'

defineOptions({ name: 'HomeView' })
import type { AppSettings, RecordingMode } from '../../../../shared/settings'
import type {
  ContentMatchSummary,
  Cs2IntegrationStatus
} from '../../../../shared/recording-types'
import {
  buildTrendSeries,
  filterMatchesInRange,
  summarizeHomeStats,
  type StatsRangeDays
} from '../../lib/match-stats'
import { joinMatchMediaPath, toMediaUrl } from '../../lib/media-url'
import DataOverviewCard from './DataOverviewCard.vue'
import RecentMatchesTable, { type MatchRowView } from './RecentMatchesTable.vue'
import RecordingControlCard from './RecordingControlCard.vue'
import { useEqualRowHeight } from '../../lib/use-equal-row-height'

const emit = defineEmits<{
  (e: 'navigate', view: string): void
}>()

const settings = ref<AppSettings | null>(null)
const cs2Status = ref<Cs2IntegrationStatus | null>(null)
const allMatches = ref<ContentMatchSummary[]>([])
const tableRows = ref<MatchRowView[]>([])
const listOffset = ref(0)
const listHasMore = ref(false)
const statsLoading = ref(true)
const tableLoading = ref(true)
const settingsBusy = ref(false)
const manualActionBusy = ref(false)
/** 忽略过期的 settings 事件（磁盘 watch 可能晚于内存更新） */
let settingsApplySeq = 0
const rangeDays = ref<StatsRangeDays>(30)

const MATCH_PAGE = 20

let unsubSettings: (() => void) | undefined
let unsubCs2: (() => void) | undefined
let unsubMatches: (() => void) | undefined
const matchesTableRef = ref<InstanceType<typeof RecentMatchesTable> | null>(null)
const homeTopRef = ref<HTMLElement | null>(null)

const { scheduleSync: syncHomeTopHeights } = useEqualRowHeight(homeTopRef)

const rangedMatches = computed(() =>
  filterMatchesInRange(allMatches.value, rangeDays.value)
)

const homeStats = computed(() => summarizeHomeStats(rangedMatches.value))
const trendSeries = computed(() => buildTrendSeries(rangedMatches.value, rangeDays.value))

async function fetchAllMatches(): Promise<ContentMatchSummary[]> {
  if (!window.csHero) return []
  const items: ContentMatchSummary[] = []
  let offset = 0
  const limit = 100
  while (true) {
    const page = await window.csHero.listMatches({ offset, limit })
    items.push(...page.items)
    if (!page.hasMore) break
    offset += page.limit
  }
  return items
}

async function buildRowViews(summaries: ContentMatchSummary[]): Promise<MatchRowView[]> {
  if (!window.csHero || summaries.length === 0) return []

  const details = await Promise.all(summaries.map((s) => window.csHero!.getMatch(s.id)))

  return summaries.map((summary, index) => {
    const detail = details[index]
    const killFiles = (detail?.clips ?? []).filter((c) => c.type === 'kill')
    return {
      ...summary,
      killClips: killFiles.map((clip) => ({
        file: clip.file,
        mediaUrl: toMediaUrl(joinMatchMediaPath(summary.dir, clip.file))
      }))
    }
  })
}

async function refreshTable(reset: boolean): Promise<void> {
  if (!window.csHero) return
  tableLoading.value = true
  try {
    if (reset) {
      listOffset.value = 0
      if (allMatches.value.length > 0) {
        const firstPage = allMatches.value.slice(0, MATCH_PAGE)
        tableRows.value = await buildRowViews(firstPage)
        listOffset.value = firstPage.length
        listHasMore.value = allMatches.value.length > MATCH_PAGE
        requestAnimationFrame(() => matchesTableRef.value?.animateRows())
        return
      }
    }
    const page = await window.csHero.listMatches({
      offset: listOffset.value,
      limit: MATCH_PAGE
    })
    const rows = await buildRowViews(page.items)
    if (reset) {
      tableRows.value = rows
    } else {
      tableRows.value = [...tableRows.value, ...rows]
    }
    listHasMore.value = page.hasMore
    listOffset.value = page.offset + page.items.length
    requestAnimationFrame(() => matchesTableRef.value?.animateRows())
  } catch (err) {
    console.error(err)
  } finally {
    tableLoading.value = false
  }
}

/** 单次拉取对局列表，同时更新统计与表格首页，避免重复请求 */
async function refreshAll(): Promise<void> {
  if (!window.csHero) return
  statsLoading.value = true
  tableLoading.value = true
  try {
    allMatches.value = await fetchAllMatches()
    const firstPage = allMatches.value.slice(0, MATCH_PAGE)
    listOffset.value = firstPage.length
    listHasMore.value = allMatches.value.length > MATCH_PAGE
    tableRows.value = await buildRowViews(firstPage)
    requestAnimationFrame(() => matchesTableRef.value?.animateRows())
  } catch (err) {
    console.error(err)
  } finally {
    statsLoading.value = false
    tableLoading.value = false
  }
}

async function loadMoreMatches(): Promise<void> {
  if (!listHasMore.value || tableLoading.value) return
  await refreshTable(false)
}

async function refreshSettings(): Promise<void> {
  if (!window.csHero) return
  try {
    settings.value = await window.csHero.getSettings()
  } catch (err) {
    console.error(err)
  }
}

async function refreshCs2(): Promise<void> {
  if (!window.csHero) return
  try {
    cs2Status.value = await window.csHero.getCs2IntegrationStatus()
  } catch (err) {
    console.error(err)
  }
}

async function patchSettings(partial: Partial<AppSettings>): Promise<void> {
  if (!window.csHero || settingsBusy.value) return
  const seq = ++settingsApplySeq
  settingsBusy.value = true

  if (settings.value) {
    settings.value = { ...settings.value, ...partial }
  }

  try {
    const next = await window.csHero.updateSettings(partial)
    if (seq === settingsApplySeq) {
      settings.value = next
    }
  } catch (err) {
    console.error(err)
    if (seq === settingsApplySeq) {
      await refreshSettings()
    }
  } finally {
    if (seq === settingsApplySeq) {
      settingsBusy.value = false
    }
  }
}

function onRecordingMode(mode: RecordingMode): void {
  if (settings.value?.recordingMode === mode) return
  void patchSettings({ recordingMode: mode })
}

function openSettings(): void {
  emit('navigate', 'settings')
}

async function onManualStart(): Promise<void> {
  if (!window.csHero || manualActionBusy.value) return
  manualActionBusy.value = true
  try {
    cs2Status.value = await window.csHero.startManualRecording()
  } catch (err) {
    console.error(err)
  } finally {
    manualActionBusy.value = false
  }
}

async function onManualStop(): Promise<void> {
  if (!window.csHero || manualActionBusy.value) return
  manualActionBusy.value = true
  try {
    await window.csHero.stopManualRecording()
    cs2Status.value = await window.csHero.getCs2IntegrationStatus()
    void refreshAll()
  } catch (err) {
    console.error(err)
  } finally {
    manualActionBusy.value = false
  }
}

async function playMatch(row: MatchRowView): Promise<void> {
  if (!window.csHero) return
  try {
    if (row.hasFullMatch) {
      await window.csHero.openEditor({ matchId: row.id, source: 'full_match' })
      return
    }
    const firstKill = row.killClips[0]
    if (firstKill) {
      await window.csHero.openEditor({
        matchId: row.id,
        source: 'clip',
        clipFile: firstKill.file
      })
      return
    }
    const detail = await window.csHero.getMatch(row.id)
    const clip = detail?.clips.find((c) => c.type === 'kill') ?? detail?.clips[0]
    if (clip) {
      await window.csHero.openEditor({
        matchId: row.id,
        source: 'clip',
        clipFile: clip.file
      })
    }
  } catch (err) {
    console.error(err)
  }
}

async function openMatchFolder(row: MatchRowView): Promise<void> {
  try {
    await window.csHero?.openPath(row.dir)
  } catch (err) {
    console.error(err)
  }
}

let subscriptionsBound = false
let skipNextActivatedRefresh = true

function bindSubscriptions(): void {
  if (subscriptionsBound || !window.csHero) return
  subscriptionsBound = true

  unsubSettings = window.csHero.onSettingsChanged((s) => {
    if (settingsBusy.value) return
    settings.value = s
  })
  unsubCs2 = window.csHero.onCs2IntegrationStatusChanged((s) => {
    cs2Status.value = s
  })
  unsubMatches = window.csHero.onMatchesChanged(() => {
    void refreshAll()
  })
}

function unbindSubscriptions(): void {
  unsubSettings?.()
  unsubCs2?.()
  unsubMatches?.()
  unsubSettings = undefined
  unsubCs2 = undefined
  unsubMatches = undefined
  subscriptionsBound = false
}

onMounted(() => {
  bindSubscriptions()
  void refreshSettings()
  void refreshCs2()
  void refreshAll()
})

onActivated(() => {
  if (skipNextActivatedRefresh) {
    skipNextActivatedRefresh = false
    requestAnimationFrame(() => syncHomeTopHeights())
    return
  }
  void refreshCs2()
  requestAnimationFrame(() => syncHomeTopHeights())
})

onDeactivated(() => {
  /* 保留实例与订阅，由 KeepAlive 缓存 */
})

onUnmounted(() => {
  unbindSubscriptions()
})

watch(rangeDays, () => {
  /* 统计由 computed 派生，无需额外请求 */
})

watch([homeStats, trendSeries, statsLoading, cs2Status, settings], () => {
  syncHomeTopHeights()
})
</script>

<template>
  <div class="home-view">
    <div ref="homeTopRef" class="home-top">
      <RecordingControlCard
        :settings="settings"
        :cs2-status="cs2Status"
        :settings-busy="settingsBusy"
        :manual-action-busy="manualActionBusy"
        class="recording-card"
        @update:recording-mode="onRecordingMode"
        @open-settings="openSettings"
        @manual-start="onManualStart"
        @manual-stop="onManualStop"
      />
      <DataOverviewCard
        v-model:range-days="rangeDays"
        :stats="homeStats"
        :series="trendSeries"
        :loading="statsLoading"
        class="overview-card"
      />
    </div>

    <RecentMatchesTable
      ref="matchesTableRef"
      :rows="tableRows"
      :loading="tableLoading"
      :has-more="listHasMore"
      @load-more="loadMoreMatches"
      @play="playMatch"
      @open-folder="openMatchFolder"
    />
  </div>
</template>

