import fs from 'fs'
import { DEFAULT_SETTINGS, type AppSettings, type RecordingMode } from '../../shared/settings'

export type { RecordingMode }
import { paths } from '../shared/paths'
import { log } from '../shared/logger'
import { listDisplays, resolveRecordingDisplay } from '../shared/displays'
import { createDebouncedWatcher, type DebouncedWatcher } from '../shared/watch_debounced'

const PERSIST_DEBOUNCE_MS = 600
const WATCH_DEBOUNCE_MS = 80

const ALLOWED_RECORDING_FPS: AppSettings['recordingFps'][] = [30, 60, 90, 120]

function normalizeSettings(merged: AppSettings): AppSettings {
  if (merged.recordingMode !== 'auto' && merged.recordingMode !== 'manual') {
    merged.recordingMode = DEFAULT_SETTINGS.recordingMode
  }
  if (!ALLOWED_RECORDING_FPS.includes(merged.recordingFps)) {
    merged.recordingFps =
      merged.recordingFps === 144 ? 120 : DEFAULT_SETTINGS.recordingFps
  }
  const displays = listDisplays()
  const valid = displays.some((d) => d.id === merged.recordingDisplayId)
  if (!valid) {
    merged.recordingDisplayId = resolveRecordingDisplay().display.id
  }
  return merged
}

function settingsFingerprint(settings: AppSettings): string {
  return JSON.stringify(settings)
}

function readSettingsFromDisk(): AppSettings {
  try {
    if (fs.existsSync(paths.settingsPath)) {
      const raw = JSON.parse(fs.readFileSync(paths.settingsPath, 'utf-8')) as Partial<AppSettings>
      return normalizeSettings({ ...DEFAULT_SETTINGS, ...raw } as AppSettings)
    }
  } catch (err) {
    log('Failed to load settings, using defaults', err)
  }
  return normalizeSettings({ ...DEFAULT_SETTINGS })
}

let cached: AppSettings | null = null
let lastPersistedFingerprint = ''
let persistTimer: ReturnType<typeof setTimeout> | undefined
let fileWatcher: DebouncedWatcher | null = null
let onDiskSettingsChanged: ((settings: AppSettings) => void) | null = null

export function setOnDiskSettingsChanged(handler: (settings: AppSettings) => void): void {
  onDiskSettingsChanged = handler
}

export function startSettingsFileWatcher(): void {
  if (fileWatcher) return
  fs.mkdirSync(paths.appDataRoot, { recursive: true })
  if (!fs.existsSync(paths.settingsPath)) {
    flushSettingsToDisk()
  }
  fileWatcher =
    createDebouncedWatcher(paths.settingsPath, syncFromDiskIfChanged, WATCH_DEBOUNCE_MS) ??
    null
}

export function stopSettingsFileWatcher(): void {
  fileWatcher?.close()
  fileWatcher = null
  if (persistTimer) clearTimeout(persistTimer)
}

function syncFromDiskIfChanged(): void {
  try {
    const disk = readSettingsFromDisk()
    const fp = settingsFingerprint(disk)
    if (cached && fp === settingsFingerprint(cached)) return
    cached = disk
    lastPersistedFingerprint = fp
    onDiskSettingsChanged?.({ ...disk })
  } catch (err) {
    log('Settings file sync failed', err)
  }
}

function flushSettingsToDisk(): void {
  persistTimer = undefined
  if (!cached) return
  const fp = settingsFingerprint(cached)
  if (fp === lastPersistedFingerprint) return
  fs.mkdirSync(paths.appDataRoot, { recursive: true })
  fs.writeFileSync(paths.settingsPath, JSON.stringify(cached, null, 2), 'utf-8')
  lastPersistedFingerprint = fp
}

function scheduleSettingsPersist(): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(flushSettingsToDisk, PERSIST_DEBOUNCE_MS)
}

export function loadSettings(): AppSettings {
  if (cached) return { ...cached }
  cached = readSettingsFromDisk()
  lastPersistedFingerprint = settingsFingerprint(cached)
  if (!fs.existsSync(paths.settingsPath)) {
    flushSettingsToDisk()
  }
  return { ...cached }
}

/** 仅更新内存；磁盘由防抖批量写入，写入后由 fs.watch 检测是否与内存一致。 */
export function applySettings(partial: Partial<AppSettings>): AppSettings {
  const next = normalizeSettings({ ...loadSettings(), ...partial })
  cached = next
  scheduleSettingsPersist()
  return { ...next }
}

/** 主进程其它模块需立即落盘时调用（如 GSI 端口调整）。 */
export function saveSettings(settings: AppSettings): void {
  const prevFp = lastPersistedFingerprint
  cached = normalizeSettings({ ...settings })
  if (persistTimer) clearTimeout(persistTimer)
  flushSettingsToDisk()
  if (cached && settingsFingerprint(cached) !== prevFp) {
    onDiskSettingsChanged?.({ ...cached })
  }
}

export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  return applySettings(partial)
}

export function invalidateSettingsCache(): void {
  cached = null
  lastPersistedFingerprint = ''
}
