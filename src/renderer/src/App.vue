<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import type { StorageInfo } from '../../shared/storage-types'
import {
  Home,
  Video,
  Scissors,
  Settings,
  Moon,
  Minus,
  Square,
  X
} from 'lucide-vue-next'
import AppCard from './components/AppCard.vue'
import StatusCard from './components/StatusCard.vue'
import ServiceStatusCard from './components/ServiceStatusCard.vue'
import HomeView from './components/home/HomeView.vue'

const currentView = ref('home')
const storageInfo = ref<StorageInfo | null>(null)

let storagePollTimer: ReturnType<typeof setInterval> | undefined

async function refreshStorageInfo(): Promise<void> {
  if (!window.csHero) return
  try {
    storageInfo.value = await window.csHero.getStorageInfo()
  } catch (e) {
    console.error(e)
  }
}

const navItems = [
  { id: 'home', label: '主页', icon: Home },
  { id: 'recordings', label: '录像', icon: Video },
  { id: 'clips', label: '剪辑', icon: Scissors },
  { id: 'settings', label: '设置', icon: Settings }
]

function minimize() {
  window.csHero?.minimizeWindow()
}

function maximize() {
  window.csHero?.maximizeWindow()
}

function close() {
  window.csHero?.closeWindow()
}

async function openStorageFolder() {
  try {
    const status = await window.csHero?.getRecordingStatus()
    if (status?.appDataRoot) {
      await window.csHero?.openPath(status.appDataRoot)
    }
  } catch (e) {
    console.error(e)
  }
}

onMounted(() => {
  void refreshStorageInfo()
  storagePollTimer = setInterval(() => {
    void refreshStorageInfo()
  }, 30_000)
})

onUnmounted(() => {
  if (storagePollTimer) clearInterval(storagePollTimer)
})
</script>

<template>
  <div class="app-layout">
    <!-- Header -->
    <header class="app-header">
      <div class="header-left">
        <div class="logo-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="logo-icon">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
        <span class="app-title">CS HERO</span>
      </div>

      <!-- Drag region -->
      <div class="header-drag-region"></div>

      <div class="header-right">
        <!-- Moon Icon -->
        <button class="icon-btn theme-btn" type="button" aria-label="Theme">
          <Moon :size="16" />
        </button>
        <!-- Window Controls -->
        <div class="window-controls">
          <button class="win-btn" @click="minimize" title="最小化">
            <Minus :size="16" />
          </button>
          <button class="win-btn" @click="maximize" title="最大化">
            <Square :size="14" />
          </button>
          <button class="win-btn close-btn" @click="close" title="关闭">
            <X :size="16" />
          </button>
        </div>
      </div>
    </header>

    <div class="main-container">
      <AppCard class="sidebar">
        <nav class="nav-menu">
          <button
            v-for="item in navItems"
            :key="item.id"
            class="nav-item"
            :class="{ active: currentView === item.id }"
            @click="currentView = item.id"
          >
            <component :is="item.icon" :size="20" :stroke-width="2" class="nav-icon" />
            <span class="nav-label">{{ item.label }}</span>
          </button>
        </nav>

        <div class="sidebar-bottom">
          <ServiceStatusCard @navigate="currentView = $event" />

          <StatusCard
            title="可用空间"
            :value="storageInfo?.freeLabel ?? '…'"
            icon="folder"
            :progress="storageInfo?.usedPercent ?? 0"
            :alert-level="storageInfo?.level ?? 'ok'"
            clickable
            @click="openStorageFolder"
          />
        </div>
      </AppCard>

      <main class="content-area">
        <KeepAlive :max="8">
          <HomeView
            v-if="currentView === 'home'"
            key="home"
            @navigate="currentView = $event"
          />
          <div
            v-else-if="currentView === 'recordings'"
            key="recordings"
            class="placeholder-content"
          />
          <div
            v-else-if="currentView === 'clips'"
            key="clips"
            class="placeholder-content"
          />
          <div
            v-else-if="currentView === 'settings'"
            key="settings"
            class="placeholder-content"
          />
        </KeepAlive>
      </main>
    </div>
  </div>
</template>

<style>
/* App Layout */
.app-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
}

/* Header */
.app-header {
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: var(--bg-dark);
}

.header-drag-region {
  flex: 1;
  height: 100%;
  -webkit-app-region: drag; /* Makes the header draggable */
}

.header-left {
  display: flex;
  align-items: center;
  padding: 0 20px;
  -webkit-app-region: no-drag;
}

.logo-box {
  width: 28px;
  height: 28px;
  background: var(--accent-color);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 12px;
}

.logo-icon {
  width: 16px;
  height: 16px;
  color: #fff;
}

.app-title {
  font-weight: 700;
  font-size: 1rem;
  letter-spacing: 0.5px;
}

.header-right {
  display: flex;
  align-items: center;
  -webkit-app-region: no-drag;
  padding-right: 12px;
  gap: 16px;
}

.icon-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  padding: 6px;
  transition: all 0.2s;
}

.icon-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
}

.theme-btn {
  background: var(--bg-card);
  color: var(--text-primary);
  border-radius: 50%;
}

.window-controls {
  display: flex;
  align-items: center;
}

.win-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  width: 40px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
  border-radius: 4px;
}

.win-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
}

.close-btn:hover {
  background: var(--danger);
  color: #fff;
}

/* Main Container */
.main-container {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 0 12px 12px 12px;
  gap: 16px;
}

/* 侧栏 / 主内容壳层样式见 AppCard.vue；此处仅保留内部布局 */

.nav-menu {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-height: 0;
}

.nav-item {
  display: flex;
  align-items: center;
  min-height: 44px;
  padding: 0 14px;
  background: transparent;
  border: none;
  border-radius: var(--radius-nav);
  color: var(--text-secondary);
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    color 0.2s ease;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.25;
  text-align: left;
}

.nav-item:hover:not(.active) {
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-primary);
}

.nav-item.active {
  background: var(--bg-nav-active);
  color: var(--text-primary);
}

.nav-item.active:hover {
  background: var(--bg-nav-active-hover);
}

.nav-icon {
  flex-shrink: 0;
  margin-right: 12px;
}

.nav-label {
  white-space: nowrap;
}

/* Sidebar Bottom Cards */
.sidebar-bottom {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 12px;
}

.content-area {
  flex: 1;
  min-width: 0;
  min-height: 0;
  background-color: var(--bg-dark);
  overflow-y: auto;
}

.content-area > :deep(.home-view) {
  min-height: min(100%, 100%);
}

.placeholder-content {
  width: 100%;
  height: 100%;
  padding: 16px;
  box-sizing: border-box;
}
</style>