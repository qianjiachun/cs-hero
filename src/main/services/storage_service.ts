import { statfs } from 'fs/promises'
import path from 'path'
import type { StorageAlertLevel, StorageInfo } from '../../shared/storage-types'
import { paths } from '../shared/paths'

/** 已用 ≥ 80%：橙色警告 */
const WARNING_USED_PERCENT = 80
/** 已用 ≥ 92%：红色警告 */
const CRITICAL_USED_PERCENT = 92

function formatFreeLabel(bytes: number): string {
  const gb = bytes / 1024 ** 3
  if (gb >= 100) return `${Math.round(gb)} GB`
  if (gb >= 10) return `${Math.round(gb)} GB`
  return `${gb.toFixed(1)} GB`
}

function resolveLevel(usedPercent: number): StorageAlertLevel {
  if (usedPercent >= CRITICAL_USED_PERCENT) return 'critical'
  if (usedPercent >= WARNING_USED_PERCENT) return 'warning'
  return 'ok'
}

function resolveDriveRoot(targetPath: string): string {
  const resolved = path.resolve(targetPath)
  const { root } = path.parse(resolved)
  return root || resolved
}

export async function getStorageInfo(targetPath?: string): Promise<StorageInfo> {
  const dataRoot = targetPath ?? paths.appDataRoot
  const rootPath = resolveDriveRoot(dataRoot)

  try {
    const stats = await statfs(rootPath)
    const totalBytes = stats.blocks * stats.bsize
    const freeBytes = stats.bfree * stats.bsize
    const usedPercent =
      totalBytes > 0 ? Math.min(100, Math.round(((totalBytes - freeBytes) / totalBytes) * 100)) : 0

    return {
      rootPath,
      freeBytes,
      totalBytes,
      usedPercent,
      freeLabel: formatFreeLabel(freeBytes),
      level: resolveLevel(usedPercent)
    }
  } catch {
    return {
      rootPath,
      freeBytes: 0,
      totalBytes: 0,
      usedPercent: 0,
      freeLabel: '—',
      level: 'ok'
    }
  }
}
