import fs from 'fs'
import { paths } from '../shared/paths'
import { createDebouncedWatcher, type DebouncedWatcher } from '../shared/watch_debounced'
import type { ContentService } from './content_service'

const WATCH_DEBOUNCE_MS = 200

let watcher: DebouncedWatcher | null = null
let lastFingerprint = ''
let onMatchesChanged: (() => void) | null = null
let getContentService: (() => ContentService) | null = null

export function setOnMatchesChanged(handler: () => void): void {
  onMatchesChanged = handler
}

function scanAndNotifyIfChanged(): void {
  if (!getContentService) return
  const fp = getContentService().listMatchesFingerprint()
  if (fp === lastFingerprint) return
  lastFingerprint = fp
  onMatchesChanged?.()
}

/** 启动后建立指纹，不广播（由渲染进程 IPC 拉取初始列表）。 */
export function primeMatchesCache(getService: () => ContentService): void {
  getContentService = getService
  lastFingerprint = getService().listMatchesFingerprint()
}

export function startMatchesFileWatcher(getService: () => ContentService): void {
  if (watcher) return
  getContentService = getService
  fs.mkdirSync(paths.matchesDir, { recursive: true })
  primeMatchesCache(getService)

  watcher =
    createDebouncedWatcher(
      paths.matchesDir,
      scanAndNotifyIfChanged,
      WATCH_DEBOUNCE_MS,
      { recursive: true }
    ) ?? null
}

export function stopMatchesFileWatcher(): void {
  watcher?.close()
  watcher = null
  lastFingerprint = ''
  onMatchesChanged = null
  getContentService = null
}
