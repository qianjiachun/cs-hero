import { screen } from 'electron'
import type { DisplayInfo } from '../../shared/display-types'

function toEvenPhysical(n: number): number {
  return Math.max(1, Math.round(n))
}

function formatScalePercent(scaleFactor: number): string {
  return `${Math.round(scaleFactor * 100)}%`
}

function buildDisplayInfo(d: Electron.Display, monitorIndex: number, primary: boolean): DisplayInfo {
  const logicalWidth = d.size.width
  const logicalHeight = d.size.height
  const physicalWidth = toEvenPhysical(logicalWidth * d.scaleFactor)
  const physicalHeight = toEvenPhysical(logicalHeight * d.scaleFactor)
  const scaleLabel = formatScalePercent(d.scaleFactor)
  const bounds = d.bounds

  const label = primary
    ? `主显示器 · ${physicalWidth}×${physicalHeight} · 缩放 ${scaleLabel}`
    : `显示器 ${monitorIndex + 1} · ${physicalWidth}×${physicalHeight} · 缩放 ${scaleLabel} @(${bounds.x},${bounds.y})`

  return {
    id: d.id,
    label,
    logicalWidth,
    logicalHeight,
    physicalWidth,
    physicalHeight,
    scaleFactor: d.scaleFactor,
    isPrimary: primary,
    monitorIndex,
    width: logicalWidth,
    height: logicalHeight
  }
}

export function listDisplays(): DisplayInfo[] {
  const all = screen.getAllDisplays()
  const primaryId = screen.getPrimaryDisplay().id
  return all.map((d, monitorIndex) => buildDisplayInfo(d, monitorIndex, d.id === primaryId))
}

export function resolveRecordingDisplay(displayId?: number): {
  display: DisplayInfo
  logicalWidth: number
  logicalHeight: number
  physicalWidth: number
  physicalHeight: number
  scaleFactor: number
  monitorIndex: number
} {
  const all = listDisplays()
  const found = displayId != null ? all.find((d) => d.id === displayId) : undefined
  const pick = found ?? all.find((d) => d.isPrimary) ?? all[0]
  if (!pick) {
    const primary = screen.getPrimaryDisplay()
    const display = buildDisplayInfo(primary, 0, true)
    return {
      display,
      logicalWidth: display.logicalWidth,
      logicalHeight: display.logicalHeight,
      physicalWidth: display.physicalWidth,
      physicalHeight: display.physicalHeight,
      scaleFactor: display.scaleFactor,
      monitorIndex: 0
    }
  }
  return {
    display: pick,
    logicalWidth: pick.logicalWidth,
    logicalHeight: pick.logicalHeight,
    physicalWidth: pick.physicalWidth,
    physicalHeight: pick.physicalHeight,
    scaleFactor: pick.scaleFactor,
    monitorIndex: pick.monitorIndex
  }
}
