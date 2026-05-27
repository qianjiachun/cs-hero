export type StorageAlertLevel = 'ok' | 'warning' | 'critical'

export interface StorageInfo {
  /** 检测的盘符或路径根 */
  rootPath: string
  freeBytes: number
  totalBytes: number
  /** 已用空间占比 0–100 */
  usedPercent: number
  freeLabel: string
  level: StorageAlertLevel
}
