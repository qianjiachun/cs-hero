import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { randomUUID } from 'crypto'
import type { ObsDisplayConfig, ObsInitPayload, ObsPathsConfig } from './obs_ipc'
import { getCs2WindowFallbacks, resolveCs2Window, type Cs2WindowInfo } from './cs2_window'

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
  private initialized = false
  private scene: Osn | null = null
  private video: Osn | null = null
  private paths: ObsPathsConfig | null = null
  private display: ObsDisplayConfig | null = null
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
      this.osn = nodeRequire('obs-studio-node')
    }
    return this.osn
  }

  initialize(payload: ObsInitPayload): void {
    if (this.initialized) return

    this.paths = payload.paths
    this.display = payload.display

    const osn = this.loadOsn()
    const { osnModuleDir, paths: p, osnVersion } = payload

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
    osn.Global.setOutputSource(0, this.scene)

    this.initialized = true
    this.log('OBS initialized')
  }

  private initVideo(osn: Osn): void {
    const d = this.display!
    this.video = osn.VideoFactory.create()
    this.video.video = {
      fpsNum: 60,
      fpsDen: 1,
      baseWidth: d.outputWidth,
      baseHeight: d.outputHeight,
      outputWidth: d.outputWidth,
      outputHeight: d.outputHeight,
      outputFormat: osn.EVideoFormat?.NV12 ?? 0,
      colorspace: osn.EColorSpace?.CS709 ?? osn.EColorSpace?.['709'] ?? 1,
      range: osn.ERangeType?.Partial ?? 1,
      scaleType: osn.EScaleType?.Bilinear ?? 3,
      fpsType: osn.EFPSType?.Common ?? 0
    }
    this.log('OBS video', JSON.stringify({ w: d.outputWidth, h: d.outputHeight }))
  }

  private configureOutput(osn: Osn): void {
    const p = this.paths!
    this.setSetting(osn, 'Output', 'Mode', 'Advanced')
    const encoders = this.getAvailableValues(osn, 'Output', 'Recording', 'RecEncoder')
    const preferred = ['obs_x264', 'x264', 'jim_nvenc', 'ffmpeg_nvenc']
    const encoder =
      preferred.find((e) => encoders.includes(e)) ?? encoders[encoders.length - 1] ?? 'obs_x264'

    this.setSetting(osn, 'Output', 'RecEncoder', encoder)
    this.setSetting(osn, 'Output', 'RecFilePath', p.tempDir)
    this.setSetting(osn, 'Output', 'RecFormat', 'mkv')
    this.setSetting(osn, 'Output', 'VBitrate', 10000)
    this.setSetting(osn, 'Video', 'FPSCommon', 60)
    this.trySetVideoAdapter(osn, 0)
    this.log('OBS output configured', JSON.stringify({ encoder, recDir: p.tempDir }))
  }

  private setupScene(osn: Osn): Osn {
    return this.setupMonitorScene(osn)
  }

  private setupMonitorScene(osn: Osn): Osn {
    const d = this.display!
    const physicalWidth = Math.round(d.logicalWidth * d.scaleFactor)
    const physicalHeight = Math.round(d.logicalHeight * d.scaleFactor)

    const videoSource = osn.InputFactory.create('monitor_capture', 'desktop-video')
    const settings = videoSource.settings
    settings.width = physicalWidth
    settings.height = physicalHeight
    settings.monitor = 0
    videoSource.update(settings)
    videoSource.save()

    const scene = osn.SceneFactory.create('cs-hero-desktop')
    const item = scene.add(videoSource)
    const scale = physicalWidth / d.outputWidth
    item.scale = { x: 1 / scale, y: 1 / scale }

    return scene
  }

  private static readonly CAPTURE_HOOK_WARMUP_MS = 3000
  private static readonly MIN_CAPTURE_WIDTH = 320
  private static readonly MIN_CAPTURE_HEIGHT = 240

  private applyGameCaptureSettings(
    settings: Osn,
    captureMode: 'window' | 'any_fullscreen',
    window?: string
  ): void {
    settings.capture_mode = captureMode
    settings.capture_cursor = true
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

  private getCanvasSize(): { width: number; height: number } {
    const d = this.display!
    return { width: d.outputWidth, height: d.outputHeight }
  }

  /** 将场景项拉伸铺满画布（避免只录到左上角一块） */
  private fitSceneItemToCanvas(item: Osn, sourceWidth: number, sourceHeight: number): void {
    const { width: cw, height: ch } = this.getCanvasSize()
    const sw = sourceWidth > 0 ? sourceWidth : cw
    const sh = sourceHeight > 0 ? sourceHeight : ch

    const scaleX = cw / sw
    const scaleY = ch / sh
    item.scale = { x: scaleX, y: scaleY }
    if ('position' in item) {
      item.position = { x: 0, y: 0 }
    }
    this.log(
      'OBS fit scene item',
      JSON.stringify({ canvas: `${cw}x${ch}`, source: `${sw}x${sh}`, scale: { x: scaleX, y: scaleY } })
    )
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
    const guessW = cs2Info?.width || this.getCanvasSize().width
    const guessH = cs2Info?.height || this.getCanvasSize().height
    this.fitSceneItemToCanvas(item, guessW, guessH)
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

    const dims = this.readSourceDimensions(item)
    const nativeW = dims.width > 0 ? dims.width : cs2Info?.width || this.getCanvasSize().width
    const nativeH = dims.height > 0 ? dims.height : cs2Info?.height || this.getCanvasSize().height
    this.fitSceneItemToCanvas(item, nativeW, nativeH)

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
      return scene
    }

    await sleep(1500)
    this.refreshGameCaptureSource(item)
    const dims = this.readSourceDimensions(item)
    this.fitSceneItemToCanvas(
      item,
      dims.width > 0 ? dims.width : cs2Info?.width || this.getCanvasSize().width,
      dims.height > 0 ? dims.height : cs2Info?.height || this.getCanvasSize().height
    )

    if (await this.verifyCaptureActive(item)) {
      return scene
    }

    // window 模式必须验证出帧；全屏 hook 在部分 OSN 上不回报尺寸，允许在已解析到 CS2 窗口时放行
    if (
      captureMode === 'any_fullscreen' &&
      cs2Info?.isFullscreenLikely &&
      cs2Info.width >= ObsEngine.MIN_CAPTURE_WIDTH
    ) {
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
    if ('method' in settings) {
      settings.method = 2
    }
    videoSource.update(settings)
    videoSource.save()

    const scene = osn.SceneFactory.create('cs-hero-cs2-window')
    const item = scene.add(videoSource)
    const guessW = cs2Info?.width || this.getCanvasSize().width
    const guessH = cs2Info?.height || this.getCanvasSize().height
    this.fitSceneItemToCanvas(item, guessW, guessH)
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
    osn.Global.setOutputSource(0, scene)
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
        fullscreen: cs2Info?.isFullscreenLikely ?? 'unknown'
      })
    )

    const strategies = this.buildCaptureStrategies(cs2Info, windowIds)

    for (const strategy of strategies) {
      try {
        await this.tryGameCaptureStrategy(
          osn,
          strategy.mode,
          strategy.window,
          cs2Info
        )
        const label =
          strategy.mode === 'any_fullscreen'
            ? 'game_capture (any_fullscreen)'
            : `game_capture (window) ${strategy.window}`
        this.log('OBS match capture', label)
        return 'game_capture'
      } catch (err) {
        this.log(
          'OBS game_capture try failed',
          `${strategy.mode}${strategy.window ? ` ${strategy.window}` : ''}: ${String(err)}`
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
          this.log('OBS match capture fallback', `window_capture ${window}`)
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
      this.osn.NodeObs.OBS_service_removeCallback()
      this.osn.NodeObs.IPC.disconnect()
    } catch (err) {
      this.logError('OBS shutdown error', String(err))
    }
    this.initialized = false
    this.scene = null
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
  private trySetVideoAdapter(osn: Osn, index: number): void {
    try {
      this.setSetting(osn, 'Video', 'Adapter', index)
      this.log('OBS video adapter', String(index))
    } catch {
      // 部分 OSN 构建无 Adapter 项
    }
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
