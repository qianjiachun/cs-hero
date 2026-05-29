<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRecordingControlMotion } from '../../motion/useRecordingControlMotion'
import { useRecordingRingRipple } from '../../motion/useRecordingRingRipple'
import {
  AlertTriangle,
  CircleDot,
  CircleStop,
  Clock,
  Film,
  Hand,
  Loader2,
  Play,
  Settings2,
  Video,
  X
} from 'lucide-vue-next'
import type { AppSettings, RecordingMode } from '../../../../shared/settings'
import type { Cs2IntegrationStatus, ObsRuntimeInfo } from '../../../../shared/recording-types'
import {
  buildRecordingControlModel,
  formatRecordingTimer
} from '../../lib/recording-control-model'
import { buildRecordingStatusItems } from '../../lib/recording-status-panel'

const props = defineProps<{
  settings: AppSettings | null
  cs2Status: Cs2IntegrationStatus | null
  settingsBusy: boolean
  manualActionBusy: boolean
}>()

const emit = defineEmits<{
  (e: 'update:recordingMode', mode: RecordingMode): void
  (e: 'open-settings'): void
  (e: 'manual-start'): void
  (e: 'manual-stop'): void
}>()

const obsRuntime = ref<ObsRuntimeInfo | null>(null)
let unsubObsRuntime: (() => void) | undefined

const model = computed(() =>
  buildRecordingControlModel(props.settings, props.cs2Status, {
    settingsBusy: props.settingsBusy,
    manualActionBusy: props.manualActionBusy,
    obsRuntime: obsRuntime.value
  })
)

const ringIsButton = computed(() => model.value.ringControl?.interactive === true)

type RingCueIcon =
  | 'loader'
  | 'play'
  | 'stop'
  | 'cancel'
  | 'hand'
  | 'video'
  | 'recording'
  | 'waiting'
  | 'film'
  | 'alert'

const ringCue = computed((): { icon: RingCueIcon; className: string; spin: boolean } => {
  const m = model.value
  const cs2 = props.cs2Status

  if (m.mode === 'manual') {
    if (props.manualActionBusy) {
      return { icon: 'loader', className: 'cue-manual cue-busy', spin: true }
    }
    const action = m.ringControl?.action
    if (action === 'stop') {
      return { icon: 'stop', className: 'cue-manual cue-stop', spin: false }
    }
    if (action === 'cancel') {
      return { icon: 'cancel', className: 'cue-manual cue-cancel', spin: false }
    }
    if (action === 'start') {
      return { icon: 'play', className: 'cue-manual cue-start', spin: false }
    }
    return { icon: 'hand', className: 'cue-manual cue-hand', spin: false }
  }

  if (!cs2 || m.circle.title === '连接中' || m.circle.title === '准备中') {
    return { icon: 'loader', className: 'cue-auto cue-loading', spin: true }
  }
  if (m.tone === 'danger') {
    return { icon: 'alert', className: 'cue-auto cue-alert', spin: false }
  }
  if (m.isSessionActive) {
    const phase = cs2.recordingPhase
    if (phase === 'recording') {
      return { icon: 'recording', className: 'cue-auto cue-recording', spin: false }
    }
    if (phase === 'waiting_cs2') {
      return { icon: 'waiting', className: 'cue-auto cue-waiting', spin: false }
    }
    if (phase === 'clipping') {
      return { icon: 'film', className: 'cue-auto cue-processing', spin: false }
    }
    return { icon: 'loader', className: 'cue-auto cue-processing', spin: true }
  }
  if (m.tone === 'warn') {
    return { icon: 'alert', className: 'cue-auto cue-warn', spin: false }
  }
  return { icon: 'video', className: 'cue-auto cue-ready', spin: false }
})
const showRecordingRipple = computed(() => model.value.circle.showTimer)
const paramsText = computed(() =>
  model.value.params.map((p) => p.value).join(' · ')
)

const statusItems = computed(() => buildRecordingStatusItems(model.value, props.cs2Status))

/** 条目较少时拉高状态区，与圆环垂直体量对齐 */
const statusLayout = computed(() => {
  const count = statusItems.value.length
  if (count <= 2) return 'is-sparse'
  if (count === 3) return 'is-balanced'
  return ''
})

const ringElRef = ref<HTMLElement | null>(null)
const rippleARef = ref<HTMLElement | null>(null)
const rippleBRef = ref<HTMLElement | null>(null)
const rippleEls = computed(() => [rippleARef.value, rippleBRef.value])

useRecordingRingRipple(showRecordingRipple, ringElRef, rippleEls)

const cardRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const ringContentRef = ref<HTMLElement | null>(null)
const statusListRef = ref<HTMLElement | null>(null)
const modeToggleRef = ref<HTMLElement | null>(null)
const ringPressed = ref(false)

const ringContentKey = computed(() =>
  [
    model.value.mode,
    model.value.circle.title,
    model.value.circle.subtitle,
    model.value.circle.showTimer,
    ringCue.value.icon,
    model.value.tone,
    model.value.isSessionActive
  ].join('|')
)

const statusKey = computed(() =>
  statusItems.value.map((i) => `${i.id}:${i.value}:${i.tone}`).join(';')
)

const ringCueTransitionKey = computed(
  () => `${ringCue.value.icon}-${ringCue.value.className}`
)

const { pulseModeToggle, pulseRingContent } = useRecordingControlMotion({
  cardRef,
  panelRef,
  ringContentRef,
  statusListRef,
  modeToggleRef,
  ringContentKey,
  statusKey
})

const timerSeconds = ref(0)
let timerHandle: ReturnType<typeof setInterval> | undefined

const timerDisplay = computed(() =>
  model.value.circle.showTimer ? formatRecordingTimer(timerSeconds.value) : '00:00:00'
)

function syncTimerFromStatus(): void {
  timerSeconds.value = props.cs2Status?.recordingElapsedSeconds ?? 0
}

function startTimerTick(): void {
  stopTimerTick()
  syncTimerFromStatus()
  timerHandle = setInterval(() => {
    timerSeconds.value += 1
  }, 1000)
}

function stopTimerTick(): void {
  if (timerHandle) {
    clearInterval(timerHandle)
    timerHandle = undefined
  }
}

watch(
  () => [model.value.circle.showTimer, props.cs2Status?.recordingElapsedSeconds] as const,
  ([show]) => {
    if (show) startTimerTick()
    else {
      stopTimerTick()
      syncTimerFromStatus()
    }
  },
  { immediate: true }
)

async function refreshObsRuntime(): Promise<void> {
  if (!window.csHero) return
  try {
    obsRuntime.value = await window.csHero.getObsRuntimeInfo()
  } catch (err) {
    console.error(err)
  }
}

onMounted(() => {
  syncTimerFromStatus()
  void refreshObsRuntime()
  if (window.csHero) {
    unsubObsRuntime = window.csHero.onObsRuntimeChanged((info) => {
      obsRuntime.value = info
    })
  }
})
onUnmounted(() => {
  stopTimerTick()
  unsubObsRuntime?.()
  unsubObsRuntime = undefined
})

function selectMode(mode: RecordingMode): void {
  if (!model.value.canChangeMode || model.value.mode === mode) return
  pulseModeToggle()
  emit('update:recordingMode', mode)
}

function onRingPointerDown(): void {
  if (!ringIsButton.value || model.value.ringControl?.disabled) return
  ringPressed.value = true
}

function clearRingPressed(): void {
  ringPressed.value = false
}

function onRingClick(): void {
  const ring = model.value.ringControl
  if (!ring?.interactive || ring.disabled || !ring.action) return
  pulseRingContent()
  if (ring.action === 'start') emit('manual-start')
  else emit('manual-stop')
  clearRingPressed()
}

const ringClass = computed(() => [
  'status-ring',
  `tone-${model.value.tone}`,
  {
    'ring-interactive': ringIsButton.value,
    active: model.value.isSessionActive,
    ticking: showRecordingRipple.value,
    recording: showRecordingRipple.value,
    loading: props.manualActionBusy,
    'action-start': model.value.ringControl?.action === 'start',
    'action-stop': model.value.ringControl?.action === 'stop',
    'action-cancel': model.value.ringControl?.action === 'cancel'
  }
])

const ringAriaLabel = computed(() => {
  if (model.value.ringControl?.ariaLabel) return model.value.ringControl.ariaLabel
  const sub = model.value.circle.subtitle
  return sub ? `${model.value.circle.title}，${sub}` : model.value.circle.title
})
</script>

<template>
  <section ref="cardRef" class="panel-card">
    <header class="card-header">
      <h2 class="card-title">录制控制</h2>
      <div class="header-actions">
        <div
          ref="modeToggleRef"
          class="mode-toggle"
          role="tablist"
          aria-label="录制模式"
        >
          <button
            type="button"
            role="tab"
            class="mode-toggle-btn"
            :class="{ active: model.mode === 'auto' }"
            :aria-selected="model.mode === 'auto'"
            :disabled="!model.canChangeMode && model.mode !== 'auto'"
            @click="selectMode('auto')"
          >
            <Video class="mode-toggle-icon" :size="11" :stroke-width="2" aria-hidden="true" />
            <span>自动</span>
          </button>
          <button
            type="button"
            role="tab"
            class="mode-toggle-btn"
            :class="{ active: model.mode === 'manual' }"
            :aria-selected="model.mode === 'manual'"
            :disabled="!model.canChangeMode && model.mode !== 'manual'"
            @click="selectMode('manual')"
          >
            <Hand class="mode-toggle-icon" :size="11" :stroke-width="2" aria-hidden="true" />
            <span>手动</span>
          </button>
          <span
            class="mode-glider"
            :class="model.mode === 'manual' ? 'is-manual' : 'is-auto'"
            aria-hidden="true"
          />
        </div>
        <button
          type="button"
          class="settings-link"
          @click="emit('open-settings')"
        >
          <Settings2 :size="14" :stroke-width="2" />
          <span class="settings-link-text">设置</span>
        </button>
      </div>
    </header>

    <div ref="panelRef" class="recording-panel">
      <div class="panel-main">
      <div
        class="ring-stage"
        :class="{ 'is-rippling': showRecordingRipple }"
      >
        <div
          v-show="showRecordingRipple"
          class="ring-ripples"
          aria-hidden="true"
        >
          <span ref="rippleARef" class="ring-ripple" />
          <span ref="rippleBRef" class="ring-ripple" />
        </div>
        <button
          ref="ringElRef"
          type="button"
          :class="ringClass"
          :disabled="ringIsButton && Boolean(model.ringControl?.disabled)"
          :aria-label="ringAriaLabel"
          :aria-disabled="!ringIsButton"
          @pointerdown="onRingPointerDown"
          @pointerup="clearRingPressed"
          @pointerleave="clearRingPressed"
          @pointercancel="clearRingPressed"
          @click="onRingClick"
        >
          <div class="status-ring-inner">
            <div
              ref="ringContentRef"
              class="ring-content"
              :class="{ 'is-pressed': ringPressed }"
            >
              <Transition name="ring-cue" mode="out-in">
              <span
                :key="ringCueTransitionKey"
                class="ring-tap-cue"
                :class="ringCue.className"
                aria-hidden="true"
              >
                <Loader2
                  v-if="ringCue.icon === 'loader'"
                  class="ring-tap-spin"
                  :size="14"
                  :stroke-width="2"
                />
                <Play
                  v-else-if="ringCue.icon === 'play'"
                  :size="14"
                  :stroke-width="2.5"
                />
                <Hand
                  v-else-if="ringCue.icon === 'hand'"
                  :size="14"
                  :stroke-width="2"
                />
                <CircleStop
                  v-else-if="ringCue.icon === 'stop'"
                  :size="14"
                  :stroke-width="2"
                />
                <X
                  v-else-if="ringCue.icon === 'cancel'"
                  :size="14"
                  :stroke-width="2.5"
                />
                <Video
                  v-else-if="ringCue.icon === 'video'"
                  :size="14"
                  :stroke-width="2"
                />
                <CircleDot
                  v-else-if="ringCue.icon === 'recording'"
                  :size="14"
                  :stroke-width="2.5"
                />
                <Clock
                  v-else-if="ringCue.icon === 'waiting'"
                  :size="14"
                  :stroke-width="2"
                />
                <Film
                  v-else-if="ringCue.icon === 'film'"
                  :size="14"
                  :stroke-width="2"
                />
                <AlertTriangle
                  v-else-if="ringCue.icon === 'alert'"
                  :size="14"
                  :stroke-width="2"
                />
              </span>
              </Transition>
              <Transition name="ring-text" mode="out-in">
                <p :key="model.circle.title" class="ring-title">{{ model.circle.title }}</p>
              </Transition>
              <p
                class="ring-timer"
                :class="{ live: model.circle.showTimer }"
              >{{ timerDisplay }}</p>
              <p v-if="paramsText" class="ring-params">{{ paramsText }}</p>
            </div>
          </div>
        </button>
      </div>

      <aside
        class="panel-side"
        :class="statusLayout"
        aria-label="录制状态"
      >
        <p v-if="model.circle.subtitle" class="side-hint">{{ model.circle.subtitle }}</p>
        <ul ref="statusListRef" class="status-list" :class="statusLayout">
          <li
            v-for="item in statusItems"
            :key="item.id"
            class="status-row"
            :class="`tone-${item.tone}`"
          >
            <span class="status-dot" aria-hidden="true" />
            <span class="status-pair">
              <span class="status-label">{{ item.label }}</span>
              <span class="status-value">{{ item.value }}</span>
            </span>
          </li>
        </ul>
      </aside>
      </div>
    </div>
  </section>
</template>

<style scoped>
.panel-card {
  --recording-accent-soft: rgba(99, 102, 241, 0.22);
  --recording-accent-border: rgba(129, 140, 248, 0.62);
  --recording-ring-border: rgba(129, 140, 248, 0.62);
  --motion-spring: cubic-bezier(0.34, 1.22, 0.64, 1);
  --ring-size: 8.75rem;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  overflow: visible;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.card-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  flex-shrink: 0;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.mode-toggle {
  --mode-toggle-pad: 2px;
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  flex-shrink: 0;
  padding: var(--mode-toggle-pad);
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.32);
  border: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

.mode-toggle-btn {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  min-height: 22px;
  padding: 0 9px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.02em;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition:
    color 0.2s var(--motion-ease),
    opacity 0.2s var(--motion-ease),
    transform 0.15s var(--motion-ease);
}

.mode-toggle-btn:active:not(:disabled) {
  transform: scale(0.96);
}

.mode-toggle-icon {
  flex-shrink: 0;
  opacity: 0.55;
  transition: opacity 0.18s ease, color 0.18s ease;
}

.mode-toggle-btn.active {
  color: #e0e7ff;
}

.mode-toggle-btn.active .mode-toggle-icon {
  color: #a5b4fc;
  opacity: 1;
}

.mode-toggle-btn:hover:not(:disabled):not(.active) {
  color: var(--text-secondary);
}

.mode-toggle-btn:hover:not(:disabled):not(.active) .mode-toggle-icon {
  opacity: 0.75;
}

.mode-toggle-btn:focus-visible {
  outline: 2px solid var(--accent-color);
  outline-offset: 2px;
}

.mode-toggle-btn:disabled:not(.active) {
  opacity: 0.4;
  cursor: not-allowed;
}

.mode-glider {
  position: absolute;
  top: var(--mode-toggle-pad);
  bottom: var(--mode-toggle-pad);
  left: var(--mode-toggle-pad);
  width: calc(50% - var(--mode-toggle-pad));
  border-radius: 999px;
  background: rgba(99, 102, 241, 0.38);
  box-shadow:
    0 1px 3px rgba(99, 102, 241, 0.28),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
  transition: transform 0.28s var(--motion-spring);
  pointer-events: none;
}

.mode-glider.is-manual {
  transform: translateX(100%);
}

.settings-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition:
    color 0.2s var(--motion-ease),
    background-color 0.2s var(--motion-ease),
    transform 0.15s var(--motion-ease);
}

.settings-link:hover {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.05);
}

.settings-link:active {
  transform: scale(0.96);
}

.recording-panel {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 6px 0 4px;
  min-width: 0;
  min-height: 0;
  overflow: visible;
  flex: 1 1 auto;
}

.panel-main {
  display: inline-flex;
  align-items: center;
  gap: 0;
  max-width: 100%;
}

.panel-side {
  position: relative;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  margin-left: 12px;
  padding-left: 12px;
}

.panel-side.is-sparse,
.panel-side.is-balanced {
  min-height: var(--ring-size);
}

.panel-side::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  width: 1px;
  height: min(4.75rem, 60%);
  transform: translateY(-50%);
  background: linear-gradient(
    180deg,
    transparent 0%,
    rgba(99, 102, 241, 0.14) 28%,
    rgba(148, 163, 184, 0.2) 50%,
    rgba(99, 102, 241, 0.14) 72%,
    transparent 100%
  );
  pointer-events: none;
}

.side-hint {
  margin: 0;
  max-width: 10.5rem;
  font-size: 10px;
  line-height: 1.4;
  color: var(--text-muted);
  text-align: left;
}

.ring-stage {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--ring-size);
  aspect-ratio: 1;
  flex-shrink: 0;
  overflow: visible;
}

.ring-stage.is-rippling {
  --ripple-border: rgba(129, 140, 248, 0.68);
  --ripple-glow: rgba(99, 102, 241, 0.38);
}

.status-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 11px;
  min-width: 8rem;
}

.status-list.is-balanced {
  flex: 1;
  justify-content: center;
  gap: 13px;
}

.status-list.is-sparse {
  flex: 1;
  justify-content: space-evenly;
  gap: 0;
  padding-block: 4px;
}

.status-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  line-height: 1.5;
  transition: opacity 0.2s var(--motion-ease);
}

.status-pair {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  white-space: nowrap;
  text-align: left;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(148, 163, 184, 0.45);
}

.status-row.tone-ok .status-dot {
  background: var(--success);
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.4);
}

.status-row.tone-warn .status-dot {
  background: var(--warning);
}

.status-row.tone-danger .status-dot {
  background: var(--danger);
}

.status-row.tone-busy .status-dot {
  background: var(--accent-color);
  box-shadow: 0 0 6px rgba(99, 102, 241, 0.35);
}

.status-label {
  font-size: 11px;
  color: var(--text-muted);
}

.status-label::after {
  content: '·';
  margin-left: 5px;
  color: rgba(148, 163, 184, 0.35);
  font-weight: 400;
}

.status-value {
  color: var(--text-secondary);
  font-weight: 500;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  transition: color 0.22s var(--motion-ease);
}

.ring-ripples {
  position: absolute;
  inset: -4%;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.ring-ripple {
  position: absolute;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 2px solid var(--ripple-border, rgba(129, 140, 248, 0.55));
  opacity: 0;
  transform: scale(1);
  box-shadow:
    0 0 14px var(--ripple-glow, rgba(99, 102, 241, 0.32)),
    0 0 28px var(--ripple-glow, rgba(99, 102, 241, 0.14));
  filter: blur(0.35px);
  will-change: transform, opacity;
}

.status-ring {
  flex-shrink: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  border: 2px solid var(--recording-ring-border);
  border-radius: 50%;
  background: var(--bg-card);
  box-shadow: none;
  container-type: inline-size;
  container-name: status-ring;
  transition:
    border-color 0.28s var(--motion-ease),
    box-shadow 0.28s var(--motion-ease),
    background-color 0.22s var(--motion-ease);
}

button.status-ring {
  appearance: none;
  font: inherit;
  color: inherit;
}

.status-ring:not(.ring-interactive) {
  cursor: default;
}

.status-ring.ring-interactive:not(:disabled) {
  cursor: pointer;
}

.status-ring.ring-interactive.action-start:not(:disabled) {
  border-style: dashed;
}

.status-ring.ring-interactive.action-start:not(:disabled):hover {
  border-color: var(--accent-color);
  border-style: dashed;
  background: rgba(99, 102, 241, 0.06);
  box-shadow: 0 0 0 5px rgba(99, 102, 241, 0.1);
}

.status-ring.ring-interactive.action-stop:not(:disabled) {
  border-color: var(--accent-color);
}

.status-ring.ring-interactive.action-stop:not(:disabled):hover {
  border-color: #818cf8;
  background: rgba(99, 102, 241, 0.08);
  box-shadow: 0 0 0 5px rgba(99, 102, 241, 0.12);
}

.status-ring.ring-interactive.action-cancel:not(:disabled) {
  border-color: rgba(129, 140, 248, 0.56);
}

.status-ring.ring-interactive.action-cancel:not(:disabled):hover {
  border-color: var(--accent-color);
  background: rgba(99, 102, 241, 0.06);
}

.status-ring.ring-interactive:focus-visible {
  outline: 2px solid var(--accent-color);
  outline-offset: 3px;
}

.status-ring:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.status-ring.loading {
  cursor: wait;
}

.status-ring.active {
  border-color: var(--accent-color);
}

.status-ring.tone-busy {
  border-color: rgba(129, 140, 248, 0.58);
}

.status-ring.tone-warn {
  border-color: rgba(129, 140, 248, 0.52);
}

.status-ring.tone-danger {
  border-color: rgba(239, 68, 68, 0.55);
}

.status-ring.recording,
.status-ring.ticking {
  border-color: #818cf8;
  box-shadow:
    0 0 0 1px rgba(99, 102, 241, 0.24),
    0 0 22px rgba(99, 102, 241, 0.28);
}

.status-ring.recording .status-ring-inner {
  background: radial-gradient(
      circle at 50% 35%,
      rgba(99, 102, 241, 0.08) 0%,
      transparent 58%
    ),
    var(--bg-card);
}

.status-ring-inner {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 35%, rgba(99, 102, 241, 0.1) 0%, transparent 58%),
    var(--bg-card);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px;
}

.ring-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 8px;
  width: 100%;
  transition: transform 0.14s var(--motion-ease);
  will-change: transform;
}

.ring-content.is-pressed {
  transform: scale(0.96);
}

.ring-cue-enter-active,
.ring-cue-leave-active {
  transition:
    opacity 0.2s var(--motion-ease),
    transform 0.24s var(--motion-spring);
}

.ring-cue-enter-from,
.ring-cue-leave-to {
  opacity: 0;
  transform: scale(0.78);
}

.ring-text-enter-active,
.ring-text-leave-active {
  transition:
    opacity 0.18s var(--motion-ease),
    transform 0.22s var(--motion-ease);
}

.ring-text-enter-from {
  opacity: 0;
  transform: translateY(5px);
}

.ring-text-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.ring-tap-cue {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.625rem;
  height: 1.625rem;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--recording-accent-soft);
  border: 1px solid var(--recording-accent-border);
  color: var(--accent-color);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.14);
  transition:
    color 0.25s var(--motion-ease),
    border-color 0.25s var(--motion-ease),
    background-color 0.25s var(--motion-ease),
    box-shadow 0.25s var(--motion-ease);
}

.ring-tap-cue.cue-manual.cue-stop {
  color: #a5b4fc;
}

.ring-tap-cue.cue-manual.cue-cancel {
  color: var(--text-secondary);
  border-color: rgba(129, 140, 248, 0.35);
  background: rgba(99, 102, 241, 0.1);
}

.ring-tap-cue.cue-manual.cue-hand {
  color: #c4b5fd;
}

.ring-tap-cue.cue-auto.cue-recording {
  color: #fca5a5;
  border-color: rgba(248, 113, 113, 0.45);
  background: rgba(248, 113, 113, 0.12);
  box-shadow: 0 0 0 3px rgba(248, 113, 113, 0.1);
}

.ring-tap-cue.cue-auto.cue-waiting {
  color: #c4b5fd;
  border-color: rgba(167, 139, 250, 0.4);
  background: rgba(99, 102, 241, 0.14);
}

.ring-tap-cue.cue-auto.cue-warn,
.ring-tap-cue.cue-auto.cue-alert {
  color: #fbbf24;
  border-color: rgba(251, 191, 36, 0.4);
  background: rgba(251, 191, 36, 0.1);
  box-shadow: 0 0 0 3px rgba(251, 191, 36, 0.06);
}

.ring-tap-cue.cue-auto.cue-processing,
.ring-tap-cue.cue-auto.cue-loading {
  color: var(--accent-color);
}

.ring-tap-spin {
  animation: ring-tap-spin 0.85s linear infinite;
}

@keyframes ring-tap-spin {
  to {
    transform: rotate(360deg);
  }
}

.ring-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
}

.ring-timer {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.05em;
  color: rgba(148, 163, 184, 0.5);
  line-height: 1;
  transition: color 0.28s var(--motion-ease);
}

.ring-timer.live {
  color: #a5b4fc;
}

.ring-params {
  margin: 0;
  padding-top: 2px;
  font-size: 9px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
  color: rgba(148, 163, 184, 0.65);
  line-height: 1.2;
  transition: opacity 0.22s var(--motion-ease);
}

@media (prefers-reduced-motion: reduce) {
  .ring-ripples {
    display: none;
  }

  .mode-glider {
    transition: none;
  }

  .ring-tap-spin {
    animation: none;
  }

  .ring-content.is-pressed {
    transform: none;
  }

  .ring-cue-enter-active,
  .ring-cue-leave-active,
  .ring-text-enter-active,
  .ring-text-leave-active {
    transition: none;
  }

  .mode-toggle-btn:active:not(:disabled),
  .settings-link:active {
    transform: none;
  }
}

@media (max-width: 480px) {
  .header-actions .settings-link-text {
    display: none;
  }

  .panel-main {
    flex-direction: column;
    align-items: center;
  }

  .panel-side {
    margin-left: 0;
    padding-left: 0;
    padding-top: 14px;
    align-items: center;
    text-align: center;
  }

  .panel-side::before {
    top: 0;
    left: 50%;
    width: min(5rem, 42%);
    height: 1px;
    transform: translateX(-50%);
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(99, 102, 241, 0.14) 28%,
      rgba(148, 163, 184, 0.2) 50%,
      rgba(99, 102, 241, 0.14) 72%,
      transparent 100%
    );
  }

  .side-hint {
    max-width: none;
  }

  .ring-stage {
    --ring-size: 8.25rem;
  }
}
</style>
