import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { randomUUID } from 'crypto'
import type {
  ObsDisplayConfig,
  ObsInitPayload,
  ObsPathsConfig,
  ObsRecordingConfig,
  ObsRuntimeInfoPayload
} from './obs_ipc'
import { getCs2WindowFallbacks, resolveCs2Window, type Cs2WindowInfo } from './cs2_window'
import { pickRecordingEncoder } from '../services/encoder_service'
import type { AppSettings } from '../../shared/settings'
import {
  capOutputToSource,
  effectiveRecordingFps,
  encoderCapabilityWarning,
  planRecordingCanvas,
  recordingBitrateKbps,
  recordingQualityCq,
  recordingQualityModeLabel,
  toEven
} from '../shared/recording_size_planner'

const nodeRequire = createRequire(import.meta.url)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Osn = any

const OBS_INIT_ERRORS: Record<string, string> = {
  '-2': '未找到 DirectX，请安装最新 DirectX 运行库后重试。',
  '-5': 'OBS 初始化失败，可能是显卡驱动过旧或系统不支持。'
}

export type ObsLogFn = (level: 'info' | 'error', message: string, detail?: string) => void

/** 在子进程内运行的 OBS/libobs 逻辑（不依赖 electron.screen） */
export class ObsEngine {
  private osn: Osn | null = null
  private osnModuleDir = ''
  private initialized = false
  private scene: Osn | null = null
  private desktopAudio: Osn | null = null
  private video: Osn | null = null
  /** OBS 输出通道：1=画面，2+=音频（与 Streamlabs OSN 约定一致） */
  private static readonly VIDEO_OUTPUT_CHANNEL = 1
  private static readonly DESKTOP_AUDIO_OUTPUT_CHANNEL = 2
  private paths: ObsPathsConfig | null = null
  private display: ObsDisplayConfig | null = null
  private recording: ObsRecordingConfig | null = null
  private selectedEncoder = 'obs_x264'
  private encoderDisplay = 'x264'
  private videoBitrateKbps = 0
  private qualityCq = 18
  private qualityModeLabel = 'CQP 18'
  private effectiveFps = 60
  private encoderWarning: string | undefined
  private availableEncoders: string[] = []
  private signalWaiters: Array<(info: Osn) => void> = []
  private signalBuffer: Osn[] = []

  constructor(private readonly logFn: ObsLogFn = () => {}) {}

  isInitialized(): boolean {
    return this.initialized
  }

  private log(message: string, detail?: string): void {
    this.logFn('info', message, detail)
  }

  private logError(message: string, detail?: string): void {
    this.logFn('error', message, detail)
  }

  private loadOsn(): Osn {
    if (!this.osn) {
      const entry = this.osnModuleDir
        ? path.join(this.osnModuleDir, 'index.js')
        : ''
      this.osn = entry && fs.existsSync(entry)
        ? nodeRequire(entry)
        : nodeRequire('obs-studio-node')
    }
    return this.osn
  }

  initialize(payload: ObsInitPayload): void {
    if (this.initialized) return

    this.paths = payload.paths
    this.display = payload.display
    this.recording = payload.recording

    const { osnModuleDir, paths: p, osnVersion } = payload
    this.osnModuleDir = osnModuleDir
    const osn = this.loadOsn()

    fs.mkdirSync(p.obsConfigPath, { recursive: true })
    fs.mkdirSync(p.tempDir, { recursive: true })

    osn.NodeObs.IPC.host(`cs-hero-${randomUUID()}`)
    osn.NodeObs.SetWorkingDirectory(osnModuleDir)

    this.log('OBS init', JSON.stringify({ osnVersion, osnModuleDir, obsConfigPath: p.obsConfigPath }))

    const initResult = osn.NodeObs.OBS_API_initAPI('en-US', p.obsConfigPath, '0.1.0')
    if (initResult !== 0) {
      const msg =
        OBS_INIT_ERRORS[String(initResult)] ?? `OBS 初始化失败，错误码：${initResult}`
      throw new Error(msg)
    }

    if (typeof osn.NodeObs.OBS_API_resetAudio === 'function') {
      osn.NodeObs.OBS_API_resetAudio()
    }
    if (typeof osn.NodeObs.OBS_API_resetVideo === 'function') {
      osn.NodeObs.OBS_API_resetVideo()
    }

    osn.NodeObs.OBS_service_connectOutputSignals((signalInfo: Osn) => {
      this.dispatchSignal(signalInfo)
    })

    this.initVideo(osn)
    this.configureOutput(osn)
    this.scene = this.setupScene(osn)
    this.setupAudio(osn)
    osn.Global.setOutputSource(ObsEngine.VIDEO_OUTPUT_CHANNEL, this.scene)

    this.initialized = true
    this.log('OBS initialized')
  }

  getRuntimeInfo(): ObsRuntimeInfoPayload {
    const d = this.display
    const quality = this.recording?.recordingQuality ?? '1080p'
    const fps = this.recording?.recordingFps ?? 60
    return {
      selectedEncoder: this.selectedEncoder,
      encoderDisplayName: this.encoderDisplay,
      availableEncoders: [...this.availableEncoders],
      baseWidth: d?.baseWidth ?? 0,
      baseHeight: d?.baseHeight ?? 0,
      outputWidth: d?.outputWidth ?? 0,
      outputHeight: d?.outputHeight ?? 0,
      recordingFps: this.effectiveFps || fps,
      recordingQuality: quality,
      videoBitrateKbps: this.videoBitrateKbps || recordingBitrateKbps(quality, fps),
      qualityCq: this.qualityCq,
      qualityModeLabel: this.qualityModeLabel,
      encoderWarning: this.encoderWarning,
      captureModeLabel: '游戏采集（自动）· 回退显示器 · WGC/DXGI 自动',
      recordingDisplayLabel: d?.displayLabel ?? '主显示器'
    }
  }

  private initVideo(osn: Osn): void {
    const d = this.display!
    const requested = this.recording?.recordingFps ?? 60
    this.effectiveFps = requested
    this.applyVideoOutput(osn, d.baseWidth, d.baseHeight, this.effectiveFps)
  }

  private applyVideoOutput(osn: Osn, width: number, height: number, fps: number): void {
    const w = toEven(width)
    const h = toEven(height)
    if (typeof osn.NodeObs.OBS_API_resetVideo === 'function') {
      osn.NodeObs.OBS_API_resetVideo()
    }
    this.video = osn.VideoFactory.create()
    this.video.video = {
      fpsNum: fps,
      fpsDen: 1,
      baseWidth: w,
      baseHeight: h,
      outputWidth: w,
      outputHeight: h,
      outputFormat: osn.EVideoFormat?.NV12 ?? 0,
      colorspace: osn.EColorSpace?.CS709 ?? osn.EColorSpace?.['709'] ?? 1,
      range: osn.ERangeType?.Partial ?? 1,
      scaleType: osn.EScaleType?.Lanczos ?? osn.EScaleType?.Bicubic ?? osn.EScaleType?.Bilinear ?? 3,
      fpsType: osn.EFPSType?.Common ?? 0
    }
    this.applyRecordingFps(osn, fps)
    this.log(
      'OBS video',
      JSON.stringify({
        base: `${w}x${h}`,
        output: `${w}x${h}`,
        fps
      })
    )
  }

  private configureOutput(osn: Osn): void {
    const p = this.paths!
    const fps = this.recording?.recordingFps ?? 60
    const quality = this.recording?.recordingQuality ?? '1080p'
    this.setSetting(osn, 'Output', 'Mode', 'Advanced')
    const encoders = this.getAvailableValues(osn, 'Output', 'Recording', 'RecEncoder')
    this.availableEncoders = encoders
    const picked = pickRecordingEncoder(encoders)
    this.selectedEncoder = picked.selected
    this.encoderDisplay = picked.displayName
    this.qualityCq = recordingQualityCq(quality, fps)
    this.qualityModeLabel = recordingQualityModeLabel(quality, picked.selected, fps)
    this.videoBitrateKbps = recordingBitrateKbps(quality, fps)
    this.encoderWarning = encoderCapabilityWarning(picked.selected, quality, fps)

    this.setSetting(osn, 'Output', 'RecEncoder', picked.selected)
    this.setSetting(osn, 'Output', 'RecFilePath', p.tempDir)
    this.setSetting(osn, 'Output', 'RecFormat', 'mkv')
    this.applyRecordingFps(osn, fps)
    const appliedQuality = this.applyRecordingQuality(osn, picked.selected, quality)
    this.trySetVideoAdapter(osn, 0)
    this.log(
      'OBS output configured',
      JSON.stringify({
        encoder: picked.selected,
        display: picked.displayName,
        available: encoders,
        recDir: p.tempDir,
        fps,
        quality,
        qualityMode: this.qualityModeLabel,
        qualityCq: this.qualityCq,
        appliedQuality,
        videoBitrateEstimateKbps: this.videoBitrateKbps,
        encoderWarning: this.encoderWarning
      })
    )
  }

  private applyRecordingFps(osn: Osn, fps: number): void {
    const commonFps = [30, 60, 120]
    if (commonFps.includes(fps)) {
      this.setSetting(osn, 'Video', 'FPSCommon', fps)
      return
    }
    this.trySetSetting(osn, 'Video', 'FPSInt', fps)
    this.trySetSetting(osn, 'Video', 'FPSNum', fps)
    this.trySetSetting(osn, 'Video', 'FPSDen', 1)
    this.setSetting(osn, 'Video', 'FPSCommon', fps)
  }

  /** 高级录制：写入编码器专属 CQP/CRF 参数（Simple 模式的 VBitrate/RecQuality 无效） */
  private applyRecordingQuality(
    osn: Osn,
    encoderId: string,
    quality: AppSettings['recordingQuality']
  ): Record<string, string | number | boolean | undefined> {
    const cq = recordingQualityCq(quality)
    const lower = encoderId.toLowerCase()
    const applied: Record<string, string | number | boolean | undefined> = { cq }

    if (lower.includes('x264') && !lower.includes('nvenc')) {
      applied.rate_control = this.trySetEncoderParam(osn, encoderId, ['rate_control', 'Recrate_control'], 'CRF')
      applied.crf = this.trySetEncoderParam(osn, encoderId, ['crf', 'Reccrf'], cq)
      applied.preset = this.trySetEncoderParam(osn, encoderId, ['preset', 'Recpreset'], 'faster')
      applied.profile = this.trySetEncoderParam(osn, encoderId, ['profile', 'Recprofile'], 'high')
      applied.keyint_sec = this.trySetEncoderParam(osn, encoderId, ['keyint_sec', 'Reckeyint_sec'], 2)
      return applied
    }

    if (lower.includes('qsv')) {
      applied.rate_control = this.trySetEncoderParam(osn, encoderId, ['rate_control', 'Recrate_control'], 'CQP')
      applied.cqp = this.trySetEncoderParam(
        osn,
        encoderId,
        ['cqp', 'Reccqp', 'icq_quality', 'Recicq_quality'],
        cq
      )
      applied.preset = this.trySetEncoderParam(osn, encoderId, ['preset', 'Recpreset'], 'quality')
      applied.profile = this.trySetEncoderParam(osn, encoderId, ['profile', 'Recprofile'], 'high')
      return applied
    }

    if (lower.includes('amf')) {
      applied.rate_control = this.trySetEncoderParam(osn, encoderId, ['rate_control', 'Recrate_control'], 'CQP')
      applied.cqp = this.trySetEncoderParam(
        osn,
        encoderId,
        ['cqp', 'Reccqp', 'qp_i', 'Recqp_i'],
        cq
      )
      applied.preset = this.trySetEncoderParam(
        osn,
        encoderId,
        ['preset', 'Recpreset', 'quality_preset', 'Recquality_preset'],
        'quality'
      )
      return applied
    }

    if (lower.includes('nvenc')) {
      applied.rate_control = this.trySetEncoderParam(osn, encoderId, ['rate_control', 'Recrate_control'], 'CQP')
      applied.cqp = this.trySetEncoderParam(
        osn,
        encoderId,
        ['cqp', 'Reccqp', 'cq', 'Reccq'],
        cq
      )
      applied.preset = this.trySetEncoderParam(
        osn,
        encoderId,
        ['preset', 'Recpreset', 'Recpreset2'],
        'p5'
      )
      applied.profile = this.trySetEncoderParam(osn, encoderId, ['profile', 'Recprofile'], 'high')
      applied.psycho_aq = this.trySetEncoderParam(
        osn,
        encoderId,
        ['psycho_aq', 'Recpsycho_aq'],
        true
      )
      applied.lookahead = this.trySetEncoderParam(
        osn,
        encoderId,
        ['lookahead', 'Reclookahead'],
        true
      )
      return applied
    }

    applied.rate_control = this.trySetEncoderParam(osn, encoderId, ['rate_control', 'Recrate_control'], 'CQP')
    applied.cqp = this.trySetEncoderParam(
      osn,
      encoderId,
      ['cqp', 'Reccqp', 'cq', 'Reccq', 'crf', 'Reccrf'],
      cq
    )
    return applied
  }

  private encoderSettingSubcategories(encoderId: string): string[] {
    const variants = [
      encoderId,
      'Recording',
      encoderId.replace(/^obs_/, ''),
      encoderId.replace(/^jim_/, ''),
      encoderId.replace(/^ffmpeg_/, '')
    ]
    return [...new Set(variants.filter(Boolean))]
  }

  private trySetSettingInSubcategory(
    osn: Osn,
    category: string,
    subcategory: string,
    parameter: string,
    value: unknown
  ): boolean {
    try {
      const settings = osn.NodeObs.OBS_settings_getSettings(category).data
      const sub = settings.find((s: Osn) => s.nameSubCategory === subcategory)
      if (!sub) return false
      let found = false
      for (const param of sub.parameters) {
        if (param.name === parameter) {
          param.currentValue = value
          found = true
        }
      }
      if (!found) return false
      osn.NodeObs.OBS_settings_saveSettings(category, settings)
      return true
    } catch {
      return false
    }
  }

  private trySetEncoderParam(
    osn: Osn,
    encoderId: string,
    paramNames: string[],
    value: unknown
  ): string | undefined {
    for (const sub of this.encoderSettingSubcategories(encoderId)) {
      for (const name of paramNames) {
        if (this.trySetSettingInSubcategory(osn, 'Output', sub, name, value)) {
          return `${sub}.${name}`
        }
      }
    }
    for (const name of paramNames) {
      try {
        this.setSetting(osn, 'Output', name, value)
        return name
      } catch {
        // 部分 OSN 构建无该项
      }
    }
    return undefined
  }

  private resolveDesktopAudioDeviceId(osn: Osn): string {
    try {
      const probe = osn.InputFactory.create('wasapi_output_capture', 'desktop-audio-probe', {
        device_id: 'does_not_exist'
      })
      const items = probe.properties?.get?.('device_id')?.details?.items ?? []
      if (typeof probe.release === 'function') {
        probe.release()
      }

      const preferred = items.find((item: Osn) => {
        const name = String(item.name ?? '').toLowerCase()
        const value = String(item.value ?? '')
        return (
          value &&
          value !== 'does_not_exist' &&
          (value.toLowerCase() === 'default' || name.includes('default'))
        )
      })
      if (preferred?.value) return String(preferred.value)

      const first = items.find((item: Osn) => {
        const value = String(item.value ?? '')
        return value && value !== 'does_not_exist'
      })
      if (first?.value) return String(first.value)
    } catch (err) {
      this.log('Desktop audio device probe failed', String(err))
    }
    return 'default'
  }

  /** 桌面音频（游戏/系统声音）→ 录制 Track 1 */
  private setupAudio(osn: Osn): void {
    this.setSetting(osn, 'Output', 'Track1Name', 'Desktop Audio')

    const deviceId = this.resolveDesktopAudioDeviceId(osn)
    try {
      this.desktopAudio = osn.InputFactory.create('wasapi_output_capture', 'desktop-audio', {
        device_id: deviceId
      })
    } catch (err) {
      this.logError('wasapi_output_capture create failed', String(err))
      return
    }

    this.desktopAudio.audioMixers = 1
    osn.Global.setOutputSource(ObsEngine.DESKTOP_AUDIO_OUTPUT_CHANNEL, this.desktopAudio)
    this.setSetting(osn, 'Output', 'RecTracks', 1)

    try {
      const audioEncoders = this.getAvailableValues(osn, 'Output', 'Recording', 'RecAudioEncoder')
      if (audioEncoders.length > 0) {
        const aac =
          audioEncoders.find((e) => e.toLowerCase().includes('aac')) ?? audioEncoders[0]
        this.setSetting(osn, 'Output', 'RecAudioEncoder', aac)
      }
    } catch {
      // 部分 OSN 构建无独立 RecAudioEncoder 项
    }

    this.log('OBS audio configured', JSON.stringify({ deviceId }))
  }

  private setupScene(osn: Osn): Osn {
    return this.setupMonitorScene(osn)
  }

  private setupMonitorScene(osn: Osn): Osn {
    const d = this.display!

    const videoSource = osn.InputFactory.create('monitor_capture', 'desktop-video')
    const settings = videoSource.settings
    settings.width = d.physicalWidth
    settings.height = d.physicalHeight
    settings.monitor = this.display?.monitorIndex ?? 0
    videoSource.update(settings)
    videoSource.save()

    const scene = osn.SceneFactory.create('cs-hero-desktop')
    const item = scene.add(videoSource)
    this.applyFullFrameSceneItem(item, d.physicalWidth, d.physicalHeight)

    return scene
  }

  private static readonly CAPTURE_HOOK_WARMUP_MS = 3000
  private static readonly MIN_CAPTURE_WIDTH = 320
  private static readonly MIN_CAPTURE_HEIGHT = 240

  /**
   * OBS Game/Window 采集：Capture Method 全自动（优先 WGC，其次 DXGI，由 OBS「自动」模式处理）
   * 常见映射：0=自动, 1=DXGI, 2=WGC
   */
  private applyAutoHookCaptureMethod(settings: Osn): void {
    if ('capture_method' in settings) {
      settings.capture_method = 0
    }
    if ('method' in settings) {
      settings.method = 0
    }
  }

  private applyGameCaptureSettings(
    settings: Osn,
    captureMode: 'window' | 'any_fullscreen',
    window?: string
  ): void {
    settings.capture_mode = captureMode
    settings.capture_cursor = true
    this.applyAutoHookCaptureMethod(settings)
    if (window !== undefined) {
      settings.window = window
    } else if ('window' in settings) {
      settings.window = ''
    }
    // CS2 + -allow_third_party_software：兼容模式 hook
    if ('anti_cheat_hook' in settings) {
      settings.anti_cheat_hook = true
    }
    if ('hook_rate' in settings) {
      settings.hook_rate = 0
    }
    if ('capture_overlays' in settings) {
      settings.capture_overlays = false
    }
    if ('sli_compatibility' in settings) {
      settings.sli_compatibility = true
    }
    if ('limit_framerate' in settings) {
      settings.limit_framerate = false
    }
    if (captureMode === 'window' && 'priority' in settings) {
      settings.priority = 2
    }
  }

  private getBaseCanvasSize(): { width: number; height: number } {
    const d = this.display!
    return { width: d.baseWidth, height: d.baseHeight }
  }

  /**
   * 将采集源等比居中放入 base 画布（letterbox/pillarbox）。
   * source 未知时先占满，warmup 后必须用真实尺寸再次调用。
   */
  private applyFullFrameSceneItem(item: Osn, sourceWidth = 0, sourceHeight = 0): void {
    const { width: bw, height: bh } = this.getBaseCanvasSize()
    if (sourceWidth <= 0 || sourceHeight <= 0) {
      item.scale = { x: 1, y: 1 }
      if ('position' in item) {
        item.position = { x: 0, y: 0 }
      }
      this.log('OBS scene item pending fit', `canvas=${bw}x${bh}`)
      return
    }

    const sw = sourceWidth
    const sh = sourceHeight

    if (Math.abs(sw - bw) <= 4 && Math.abs(sh - bh) <= 4) {
      item.scale = { x: 1, y: 1 }
      if ('position' in item) {
        item.position = { x: 0, y: 0 }
      }
      this.log('OBS scene item full frame', `${bw}x${bh}`)
      return
    }

    const uniform = Math.min(1, bw / sw, bh / sh)
    const displayW = sw * uniform
    const displayH = sh * uniform
    const posX = (bw - displayW) / 2
    const posY = (bh - displayH) / 2

    item.scale = { x: uniform, y: uniform }
    if ('position' in item) {
      item.position = { x: posX, y: posY }
    }
    if (typeof item.setTransform === 'function') {
      try {
        item.setTransform({ positionX: posX, positionY: posY, scaleX: uniform, scaleY: uniform })
      } catch {
        // ignore
      }
    }
    this.log(
      'OBS scene item letterbox',
      JSON.stringify({
        base: `${bw}x${bh}`,
        source: `${sw}x${sh}`,
        scale: uniform,
        position: { x: posX, y: posY }
      })
    )
  }

  private refitSceneItemFromCapture(item: Osn, cs2Info: Cs2WindowInfo | null): void {
    const dims = this.readSourceDimensions(item)
    const { width: bw, height: bh } = this.getBaseCanvasSize()
    const sw = dims.width > 0 ? dims.width : cs2Info?.width ?? 0
    const sh = dims.height > 0 ? dims.height : cs2Info?.height ?? 0
    this.applyFullFrameSceneItem(item, sw, sh)
    if (sw <= 0 || sh <= 0) {
      this.log('OBS refit deferred: unknown source size', `canvas=${bw}x${bh}`)
    }
  }

  private readSourceDimensions(item: Osn): { width: number; height: number } {
    const source = item?.source ?? item
    const w =
      Number(source?.width) ||
      Number(source?.getWidth?.()) ||
      Number(item?.width) ||
      Number(item?.sourceWidth) ||
      0
    const h =
      Number(source?.height) ||
      Number(source?.getHeight?.()) ||
      Number(item?.height) ||
      Number(item?.sourceHeight) ||
      0
    return { width: w, height: h }
  }

  private async verifyCaptureActive(item: Osn): Promise<boolean> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { width, height } = this.readSourceDimensions(item)
      if (width >= ObsEngine.MIN_CAPTURE_WIDTH && height >= ObsEngine.MIN_CAPTURE_HEIGHT) {
        this.log('OBS capture verified', `${width}x${height}`)
        return true
      }
      await sleep(500)
    }
    const last = this.readSourceDimensions(item)
    this.log('OBS capture not active', `${last.width}x${last.height}`)
    return false
  }

  private refreshGameCaptureSource(item: Osn): void {
    try {
      const source = item?.source
      if (source?.settings && typeof source.update === 'function') {
        source.update(source.settings)
        source.save()
      }
    } catch {
      // ignore
    }
  }

  private setupGameCaptureScene(
    osn: Osn,
    captureMode: 'window' | 'any_fullscreen',
    window: string | undefined,
    cs2Info: Cs2WindowInfo | null
  ): Osn {
    const id = window ? `cs2-game-${captureMode}` : `cs2-game-${captureMode}-fs`
    const videoSource = osn.InputFactory.create('game_capture', id)
    const settings = videoSource.settings
    this.applyGameCaptureSettings(settings, captureMode, window)
    videoSource.update(settings)
    videoSource.save()

    const scene = osn.SceneFactory.create(`cs-hero-${id}`)
    const item = scene.add(videoSource)
    this.applyFullFrameSceneItem(item, 0, 0)
    return scene
  }

  private async warmupAndFitGameCapture(
    osn: Osn,
    scene: Osn,
    cs2Info: Cs2WindowInfo | null
  ): Promise<Osn> {
    this.activateScene(osn, scene)
    await sleep(ObsEngine.CAPTURE_HOOK_WARMUP_MS)

    const item = scene.getItems()[0]
    if (!item) {
      throw new Error('game_capture scene has no items')
    }

    this.refreshGameCaptureSource(item)

    this.refitSceneItemFromCapture(item, cs2Info)
    return item
  }

  private async tryGameCaptureStrategy(
    osn: Osn,
    captureMode: 'window' | 'any_fullscreen',
    window: string | undefined,
    cs2Info: Cs2WindowInfo | null
  ): Promise<Osn> {
    const scene = this.setupGameCaptureScene(osn, captureMode, window, cs2Info)
    const item = await this.warmupAndFitGameCapture(osn, scene, cs2Info)

    if (await this.verifyCaptureActive(item)) {
      this.refitSceneItemFromCapture(item, cs2Info)
      return scene
    }

    await sleep(1500)
    this.refreshGameCaptureSource(item)
    this.refitSceneItemFromCapture(item, cs2Info)

    if (await this.verifyCaptureActive(item)) {
      this.refitSceneItemFromCapture(item, cs2Info)
      return scene
    }

    // window 模式必须验证出帧；全屏 hook 在部分 OSN 上不回报尺寸，用窗口/画布尺寸兜底 fit
    if (
      captureMode === 'any_fullscreen' &&
      cs2Info?.isFullscreenLikely &&
      cs2Info.width >= ObsEngine.MIN_CAPTURE_WIDTH
    ) {
      this.refitSceneItemFromCapture(item, cs2Info)
      this.log('OBS capture verify relaxed pass (fullscreen)', `${cs2Info.width}x${cs2Info.height}`)
      return scene
    }

    throw new Error(`game_capture inactive (${captureMode}${window ? ` ${window}` : ''})`)
  }

  private setupWindowCaptureScene(
    osn: Osn,
    window: string,
    cs2Info: Cs2WindowInfo | null
  ): Osn {
    const videoSource = osn.InputFactory.create('window_capture', 'cs2-window-capture')
    const settings = videoSource.settings
    settings.window = window
    settings.capture_cursor = true
    this.applyAutoHookCaptureMethod(settings)
    videoSource.update(settings)
    videoSource.save()

    const scene = osn.SceneFactory.create('cs-hero-cs2-window')
    const item = scene.add(videoSource)
    this.applyFullFrameSceneItem(item, 0, 0)
    return scene
  }

  private buildCaptureStrategies(
    cs2Info: Cs2WindowInfo | null,
    windowIds: string[]
  ): Array<{ mode: 'window' | 'any_fullscreen'; window?: string }> {
    const strategies: Array<{ mode: 'window' | 'any_fullscreen'; window?: string }> = []

    if (cs2Info?.isFullscreenLikely) {
      strategies.push({ mode: 'any_fullscreen' })
      for (const w of windowIds) {
        strategies.push({ mode: 'window', window: w })
      }
    } else {
      for (const w of windowIds) {
        strategies.push({ mode: 'window', window: w })
      }
      strategies.push({ mode: 'any_fullscreen' })
    }

    return strategies
  }

  private activateScene(osn: Osn, scene: Osn): void {
    this.scene = scene
    osn.Global.setOutputSource(ObsEngine.VIDEO_OUTPUT_CHANNEL, scene)
  }

  /**
   * 采集验证后：输出分辨率贴合真实采集源（禁止 upscale），窗口模式限制帧率。
   */
  private finalizeCaptureOutput(osn: Osn, cs2Info: Cs2WindowInfo | null): void {
    const scene = this.scene
    if (!scene) return
    const items = scene.getItems?.() ?? []
    const item = items[0]
    if (!item) return

    const dims = this.readSourceDimensions(item)
    const sw = dims.width > 0 ? dims.width : cs2Info?.width ?? 0
    const sh = dims.height > 0 ? dims.height : cs2Info?.height ?? 0
    if (sw < ObsEngine.MIN_CAPTURE_WIDTH || sh < ObsEngine.MIN_CAPTURE_HEIGHT) return

    const windowed = cs2Info ? !cs2Info.isFullscreenLikely : true
    this.fitOutputToCaptureSource(osn, sw, sh, windowed)
    this.refitSceneItemFromCapture(item, cs2Info)
  }

  private fitOutputToCaptureSource(
    osn: Osn,
    sourceWidth: number,
    sourceHeight: number,
    windowedCapture: boolean
  ): void {
    const d = this.display!
    const quality = this.recording?.recordingQuality ?? '1080p'
    const requested = this.recording?.recordingFps ?? 60
    const planned = planRecordingCanvas(quality)
    const capped = capOutputToSource(sourceWidth, sourceHeight, planned)
    const fps = effectiveRecordingFps(requested, windowedCapture)

    const changed =
      capped.outputWidth !== d.outputWidth ||
      capped.outputHeight !== d.outputHeight ||
      fps !== this.effectiveFps

    if (!changed) return

    d.baseWidth = capped.baseWidth
    d.baseHeight = capped.baseHeight
    d.outputWidth = capped.outputWidth
    d.outputHeight = capped.outputHeight
    this.effectiveFps = fps
    this.qualityCq = recordingQualityCq(quality, fps)
    this.qualityModeLabel = recordingQualityModeLabel(quality, this.selectedEncoder, fps)
    const warnings: string[] = []
    if (windowedCapture && requested > 60) {
      warnings.push(`窗口模式采集，帧率已限制为 60fps（设置 ${requested}fps）`)
    }
    if (capped.outputWidth < planned.outputWidth || capped.outputHeight < planned.outputHeight) {
      warnings.push(
        `采集源 ${sourceWidth}×${sourceHeight}，输出已限制为 ${capped.outputWidth}×${capped.outputHeight}（禁止放大）`
      )
    }
    if (warnings.length > 0) {
      this.encoderWarning = warnings.join('；')
    }
    this.applyVideoOutput(osn, capped.outputWidth, capped.outputHeight, fps)
    this.applyRecordingQuality(osn, this.selectedEncoder, quality)
    this.log(
      'OBS output fit to capture',
      JSON.stringify({
        source: `${sourceWidth}x${sourceHeight}`,
        output: `${capped.outputWidth}x${capped.outputHeight}`,
        requestedFps: requested,
        effectiveFps: fps,
        windowedCapture
      })
    )
  }

  /**
   * 对局录制：game_capture 为主；按 CS2 窗口/全屏状态选择策略；验证出帧后再采用。
   */
  async prepareMatchCapture(): Promise<string> {
    if (!this.initialized) throw new Error('OBS 未初始化')
    const osn = this.loadOsn()

    const cs2Info = resolveCs2Window()
    const windowIds = getCs2WindowFallbacks(cs2Info)
    this.log(
      'CS2 window resolved',
      JSON.stringify({
        obsWindowId: cs2Info?.obsWindowId,
        size: cs2Info ? `${cs2Info.width}x${cs2Info.height}` : 'unknown',
        fullscreen: cs2Info?.isFullscreenLikely ?? 'unknown',
        monitor: this.display?.monitorIndex ?? 0
      })
    )

    const strategies = this.buildCaptureStrategies(cs2Info, windowIds)

    for (const cap of strategies) {
      try {
        await this.tryGameCaptureStrategy(osn, cap.mode, cap.window, cs2Info)
        const label =
          cap.mode === 'any_fullscreen'
            ? 'game_capture (any_fullscreen)'
            : `game_capture (window) ${cap.window}`
        this.log('OBS match capture', label)
        this.finalizeCaptureOutput(osn, cs2Info)
        return 'game_capture'
      } catch (err) {
        this.log(
          'OBS game_capture try failed',
          `${cap.mode}${cap.window ? ` ${cap.window}` : ''}: ${String(err)}`
        )
      }
    }

    for (const window of windowIds) {
      try {
        const scene = this.setupWindowCaptureScene(osn, window, cs2Info)
        this.activateScene(osn, scene)
        await sleep(1500)
        const item = scene.getItems()[0]
        if (item && (await this.verifyCaptureActive(item))) {
          this.refitSceneItemFromCapture(item, cs2Info)
          this.log('OBS match capture fallback', `window_capture ${window}`)
          this.finalizeCaptureOutput(osn, cs2Info)
          return 'window_capture_fallback'
        }
        throw new Error('window_capture inactive')
      } catch (err) {
        this.log('OBS window_capture fallback failed', `${window}: ${String(err)}`)
      }
    }

    this.logError('game_capture failed, fallback to monitor', '')
    const scene = this.setupMonitorScene(osn)
    this.activateScene(osn, scene)
    await sleep(1500)
    const monitorItem = scene.getItems()[0]
    if (monitorItem) {
      this.refitSceneItemFromCapture(monitorItem, cs2Info)
    }
    this.finalizeCaptureOutput(osn, cs2Info)
    return 'monitor_capture_fallback'
  }

  startRecording(): void {
    if (!this.initialized) throw new Error('OBS 未初始化')
    const osn = this.loadOsn()
    this.clearTempRecordings()
    this.log('OBS start recording')
    osn.NodeObs.OBS_service_startRecording()
  }

  async waitRecordingStarted(): Promise<void> {
    const startSignal = await this.waitForSignalOptional(8000)
    this.assertRecordingStartSignal(startSignal)
    this.log(
      'OBS recording started',
      startSignal ? `${startSignal.type}/${startSignal.signal}` : '(no signal)'
    )
  }

  async stopRecording(): Promise<string> {
    if (!this.initialized) throw new Error('OBS 未初始化')
    const osn = this.loadOsn()

    this.log('OBS stop recording')
    osn.NodeObs.OBS_service_stopRecording()

    await this.waitForSignalOptional(5000)
    await this.waitForSignalOptional(3000)
    this.log('OBS stop requested, waiting for mkv file…')

    const mkvPath = await this.ensureFileReady(this.resolveRecordingMkvPath(), 90000)
    this.log('OBS recording file ready', mkvPath)
    return mkvPath
  }

  shutdown(): void {
    if (!this.initialized || !this.osn) return
    try {
      if (this.desktopAudio && typeof this.desktopAudio.release === 'function') {
        this.desktopAudio.release()
      }
      this.osn.NodeObs.OBS_service_removeCallback()
      this.osn.NodeObs.IPC.disconnect()
    } catch (err) {
      this.logError('OBS shutdown error', String(err))
    }
    this.initialized = false
    this.scene = null
    this.desktopAudio = null
    this.video = null
    this.log('OBS shutdown')
  }

  private clearTempRecordings(): void {
    const dir = this.paths!.tempDir
    if (!fs.existsSync(dir)) return
    for (const f of fs.readdirSync(dir)) {
      if (f.toLowerCase().endsWith('.mkv')) {
        try {
          fs.unlinkSync(path.join(dir, f))
        } catch {
          // ignore
        }
      }
    }
  }

  private assertRecordingStartSignal(signal: Osn | null): void {
    if (!signal) {
      this.log('WARN: 未收到录制开始信号，将依赖停止后文件落盘')
      return
    }
    const sig = String(signal.signal ?? '').toLowerCase()
    if (sig === 'stop') {
      const detail =
        signal.error ?? signal.lastError ?? signal.message ?? JSON.stringify(signal)
      throw new Error(
        `录制未能启动（OBS 返回 stop）。常见原因：编码器无画面输入。详情: ${detail || '见 osn-data/node-obs/logs/'}`
      )
    }
    if (sig !== 'start') {
      this.log('WARN: 非预期的开始信号', JSON.stringify(signal))
    }
  }

  private resolveRecordingMkvPath(): string {
    const p = this.paths!
    const mkv = this.findNewestMkv(p.tempDir)
    if (mkv) return mkv
    if (fs.existsSync(p.recordingTmpMkv)) return p.recordingTmpMkv
    const fallback = this.findNewestMkv(p.obsConfigPath)
    return fallback ?? p.recordingTmpMkv
  }

  private findNewestMkv(dir: string): string | null {
    if (!fs.existsSync(dir)) return null
    const mkvs = fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.mkv'))
      .map((f) => {
        const full = path.join(dir, f)
        return { full, mtime: fs.statSync(full).mtimeMs, size: fs.statSync(full).size }
      })
      .filter((x) => x.size > 0)
      .sort((a, b) => b.mtime - a.mtime)
    return mkvs[0]?.full ?? null
  }

  private async ensureFileReady(filePath: string, timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs
    let lastSize = -1

    while (Date.now() < deadline) {
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath)
        if (stat.size > 0 && stat.size === lastSize) {
          return filePath
        }
        lastSize = stat.size
      }
      await sleep(500)
    }

    throw new Error(`录制文件未就绪：${filePath}`)
  }

  private dispatchSignal(signalInfo: Osn): void {
    const summary = `${signalInfo?.type ?? '?'}/${signalInfo?.signal ?? '?'}`
    this.log('OBS output signal', summary)
    const waiter = this.signalWaiters.shift()
    if (waiter) {
      waiter(signalInfo)
    } else {
      this.signalBuffer.push(signalInfo)
    }
  }

  private async waitForSignalOptional(timeoutMs: number): Promise<Osn | null> {
    try {
      return await this.waitForSignal(timeoutMs)
    } catch {
      return null
    }
  }

  private waitForSignal(timeoutMs: number): Promise<Osn> {
    if (this.signalBuffer.length > 0) {
      return Promise.resolve(this.signalBuffer.shift()!)
    }
    return new Promise((resolve, reject) => {
      const onSignal = (info: Osn): void => {
        clearTimeout(timer)
        resolve(info)
      }
      const timer = setTimeout(() => {
        const idx = this.signalWaiters.indexOf(onSignal)
        if (idx >= 0) this.signalWaiters.splice(idx, 1)
        reject(new Error('OBS 输出信号超时'))
      }, timeoutMs)
      this.signalWaiters.push(onSignal)
    })
  }

  private setSetting(osn: Osn, category: string, parameter: string, value: unknown): void {
    const settings = osn.NodeObs.OBS_settings_getSettings(category).data
    for (const sub of settings) {
      for (const param of sub.parameters) {
        if (param.name === parameter) {
          param.currentValue = value
        }
      }
    }
    osn.NodeObs.OBS_settings_saveSettings(category, settings)
  }

  /** 双显卡：尽量使用 Adapter 0（通常为独显） */
  private trySetSetting(osn: Osn, category: string, parameter: string, value: unknown): void {
    try {
      this.setSetting(osn, category, parameter, value)
    } catch {
      // 部分 OSN 构建无该项
    }
  }

  private trySetVideoAdapter(osn: Osn, index: number): void {
    this.trySetSetting(osn, 'Video', 'Adapter', index)
    this.log('OBS video adapter', String(index))
  }

  private getAvailableValues(
    osn: Osn,
    category: string,
    subcategory: string,
    parameter: string
  ): string[] {
    const categorySettings = osn.NodeObs.OBS_settings_getSettings(category).data
    const sub = categorySettings.find((s: Osn) => s.nameSubCategory === subcategory)
    const param = sub?.parameters.find((p: Osn) => p.name === parameter)
    return (param?.values ?? []).map((v: Osn) => Object.values(v)[0] as string)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
