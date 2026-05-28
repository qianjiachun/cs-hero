import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { FFMPEG_DOWNLOAD_URLS, FFMPEG_MIN_BYTES, FFMPEG_VERSION } from '../shared/ffmpeg_constants'
import { getFfmpegExePath, getFfmpegRuntimeDir, isFfmpegRuntimeReady } from '../shared/ffmpeg_paths'
import { log, logError } from '../shared/logger'
import type { RuntimeDownloadStatus } from '../../shared/runtime-download-types'
import { downloadFirstToFile } from './runtime_downloader'

type RuntimeProgressListener = (status: RuntimeDownloadStatus) => void

function collectFfmpegUrls(): string[] {
  const extra = (process.env.FFMPEG_URL || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return [...extra, ...FFMPEG_DOWNLOAD_URLS]
}

let ensurePromise: Promise<string> | null = null

export async function ensureFfmpegRuntime(onProgress?: RuntimeProgressListener): Promise<string> {
  if (isFfmpegRuntimeReady()) {
    return getFfmpegExePath()
  }

  if (!app.isPackaged) {
    throw new Error(`未找到 FFmpeg：${getFfmpegExePath()}`)
  }

  if (!ensurePromise) {
    ensurePromise = installFfmpegRuntime(onProgress).catch((err) => {
      ensurePromise = null
      throw err
    })
  }

  return ensurePromise
}

async function installFfmpegRuntime(onProgress?: RuntimeProgressListener): Promise<string> {
  const exePath = getFfmpegExePath()
  const cachePath = path.join(getFfmpegRuntimeDir(), `ffmpeg-${FFMPEG_VERSION}.exe`)

  onProgress?.({
    component: 'ffmpeg',
    label: '视频处理组件',
    phase: 'downloading',
    message: '正在下载视频处理组件',
    progress: 0
  })
  log('FFmpeg runtime download start', FFMPEG_VERSION)

  let lastProgress = -1
  const { url, size } = await downloadFirstToFile(
    collectFfmpegUrls(),
    cachePath,
    (_url, p) => {
      const nextProgress = p.progress ?? -1
      if (nextProgress === lastProgress) return
      lastProgress = nextProgress
      onProgress?.({
        component: 'ffmpeg',
        label: '视频处理组件',
        phase: 'downloading',
        message: p.progress !== undefined ? `正在下载视频处理组件 ${p.progress}%` : '正在下载视频处理组件',
        progress: p.progress,
        bytesReceived: p.bytesReceived,
        totalBytes: p.totalBytes
      })
    },
    (failedUrl, err) => log('FFmpeg download try failed', failedUrl, err.message)
  )
  log('FFmpeg runtime downloaded', url, `${(size / 1024 / 1024).toFixed(1)} MB`)

  if (size < FFMPEG_MIN_BYTES) {
    fs.rmSync(cachePath, { force: true })
    throw new Error('FFmpeg 下载内容无效，请检查网络后重试')
  }

  fs.mkdirSync(path.dirname(exePath), { recursive: true })
  fs.copyFileSync(cachePath, exePath)
  onProgress?.({
    component: 'ffmpeg',
    label: '视频处理组件',
    phase: 'ready',
    message: '视频处理组件已就绪',
    progress: 100
  })
  return exePath
}

export function resetFfmpegRuntimeInstall(): void {
  ensurePromise = null
  try {
    fs.rmSync(getFfmpegRuntimeDir(), { recursive: true, force: true })
  } catch (err) {
    logError('Failed to remove FFmpeg runtime dir', err)
  }
}
