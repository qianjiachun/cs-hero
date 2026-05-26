import fs from 'fs'
import type { ContentMatchSummary } from '../../shared/recording-types'
import { paths } from '../shared/paths'
import { createDebouncedWatcher, type DebouncedWatcher } from '../shared/watch_debounced'
import type { ContentService } from './content_service'

const WATCH_DEBOUNCE_MS = 200

function matchesFingerprint(matches: ContentMatchSummary[]): string {
  return JSON.stringify(
    matches.map((m) => ({
      id: m.id,
      status: m.status,
      clipCount: m.clipCount,
      bookmarkCount: m.bookmarkCount,
      hasFullMatch: m.hasFullMatch,
      duration: m.duration,
      parseError: m.parseError
    }))
  )
}

let watcher: DebouncedWatcher | null = null
let lastFingerprint = ''
let onMatchesChanged: ((matches: ContentMatchSummary[]) => void) | null = null
let getContentService: (() => ContentService) | null = null

export function setOnMatchesChanged(handler: (matches: ContentMatchSummary[]) => void): void {
  onMatchesChanged = handler
}

function scanAndNotifyIfChanged(): void {
  if (!getContentService) return
  const matches = getContentService().listMatches()
  const fp = matchesFingerprint(matches)
  if (fp === lastFingerprint) return
  lastFingerprint = fp
  onMatchesChanged?.(matches)
}

/** 启动后首次扫描，建立指纹但不广播（由渲染进程 IPC 拉取初始列表）。 */
export function primeMatchesCache(getService: () => ContentService): void {
  getContentService = getService
  lastFingerprint = matchesFingerprint(getService().listMatches())
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
