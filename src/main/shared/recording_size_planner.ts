import type { AppSettings } from '../../shared/settings'

export interface RecordingCanvasPlan {
  /** OBS base / output 画布（标准 16:9 画质分辨率） */
  baseWidth: number
  baseHeight: number
  outputWidth: number
  outputHeight: number
}

/** 720p/1080p/1440p 字面输出尺寸（固定 16:9） */
export function standardOutputSize(
  quality: AppSettings['recordingQuality']
): { width: number; height: number } {
  if (quality === '720p') return { width: 1280, height: 720 }
  if (quality === '1440p') return { width: 2560, height: 1440 }
  return { width: 1920, height: 1080 }
}

export function toEven(n: number): number {
  const v = Math.max(2, Math.round(n))
  return v % 2 === 0 ? v : v + 1
}

/** OBS 画布与编码输出均使用标准画质分辨率；采集源通过 letterbox 完整放入 */
export function planRecordingCanvas(
  quality: AppSettings['recordingQuality']
): RecordingCanvasPlan {
  const { width, height } = standardOutputSize(quality)
  const baseWidth = toEven(width)
  const baseHeight = toEven(height)
  return {
    baseWidth,
    baseHeight,
    outputWidth: baseWidth,
    outputHeight: baseHeight
  }
}

/** 将输出分辨率限制在采集源以内（禁止放大/upscale） */
export function capOutputToSource(
  sourceWidth: number,
  sourceHeight: number,
  planned: RecordingCanvasPlan
): RecordingCanvasPlan {
  if (sourceWidth <= 0 || sourceHeight <= 0) return planned

  let outW = Math.min(planned.outputWidth, sourceWidth)
  let outH = Math.min(planned.outputHeight, sourceHeight)
  const sourceAspect = sourceWidth / sourceHeight

  if (outW / outH > sourceAspect) {
    outW = toEven(Math.round(outH * sourceAspect))
  } else {
    outH = toEven(Math.round(outW / sourceAspect))
  }

  return {
    baseWidth: outW,
    baseHeight: outH,
    outputWidth: outW,
    outputHeight: outH
  }
}

/**
 * 窗口模式 game_capture 通常无法稳定输出 120fps 真实帧；
 * 高于 60 时会产生大量重复帧并增大体积。
 */
export function effectiveRecordingFps(
  requested: AppSettings['recordingFps'],
  windowedCapture: boolean
): AppSettings['recordingFps'] {
  if (windowedCapture && requested > 60) return 60
  return requested
}

/**
 * 质量优先编码的 CQP/CRF 值（越小画质越高、体积越大）。
 * 720p→20 / 1080p→18 / 1440p→18；120fps 额外 +1 以控制体积。
 */
export function recordingQualityCq(
  quality: AppSettings['recordingQuality'],
  fps?: AppSettings['recordingFps']
): number {
  let cq = 18
  if (quality === '720p') cq = 20
  else if (quality === '1440p') cq = 18
  if (fps && fps >= 120) cq += 1
  return cq
}

/** 用户可读的编码质量标签，如「CQP 18」或「CRF 18」 */
export function recordingQualityModeLabel(
  quality: AppSettings['recordingQuality'],
  encoderId: string,
  fps?: AppSettings['recordingFps']
): string {
  const cq = recordingQualityCq(quality, fps)
  const lower = encoderId.toLowerCase()
  const isSoftware = lower.includes('x264') && !lower.includes('nvenc')
  return isSoftware ? `CRF ${cq}` : `CQP ${cq}`
}

/**
 * 录制码率（kbps）：按分辨率基准 × FPS 比例。
 * 1440p@60 ≈ 40 Mbps；1440p@120 ≈ 80 Mbps。
 * 仅用于 UI 估算展示；实际录制使用 CQP/CRF 质量优先模式。
 */
export function recordingBitrateKbps(
  quality: AppSettings['recordingQuality'],
  fps: AppSettings['recordingFps']
): number {
  let baseAt60 = 12_000
  if (quality === '720p') baseAt60 = 6_000
  else if (quality === '1440p') baseAt60 = 40_000
  return Math.round(baseAt60 * (fps / 60))
}

/** x264 软编在高 FPS 下可能无法稳定达标 */
export function encoderCapabilityWarning(
  encoderId: string,
  quality: AppSettings['recordingQuality'],
  fps: AppSettings['recordingFps']
): string | undefined {
  const lower = encoderId.toLowerCase()
  const isSoftware = lower.includes('x264') && !lower.includes('nvenc')
  if (isSoftware && fps >= 120) {
    return `当前为 ${fps}fps 软编(x264)，可能无法稳定达到设定帧率，建议使用 NVENC/AMF`
  }
  if (isSoftware && quality === '1440p' && fps >= 90) {
    return `1440p@${fps}fps 软编可能卡顿或模糊，建议使用硬件编码器`
  }
  return undefined
}
