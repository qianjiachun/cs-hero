import { app } from 'electron'
import { createRequire } from 'module'
import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { log, logError } from '../shared/logger'
import { OSN_DOWNLOAD_URLS, OSN_VERSION } from '../shared/osn_constants'
import { fixPackagedPath } from '../shared/osn_path_utils'
import { getAppDataRoot } from '../shared/runtime_roots'
import { getOsnRuntimeDir, isOsnRuntimeReady } from '../shared/osn_paths'
import type { RuntimeDownloadStatus } from '../../shared/runtime-download-types'
import { downloadFirstToFile } from './runtime_downloader'

const nodeRequire = createRequire(import.meta.url)

const OSN_ARCHIVE = `osn-${OSN_VERSION}-release-win64.tar.gz`
const OSN_MIN_BYTES = 1_000_000
const OSN_MAGIC_BYTE = 0x1f

type RuntimeProgressListener = (status: RuntimeDownloadStatus) => void

function getOsnRuntimeCacheDir(): string {
  return path.join(getAppDataRoot(), 'runtime', 'cache')
}

function versionMarkerPath(): string {
  return path.join(getOsnRuntimeDir(), '.cs-hero-osn-version')
}

function collectOsnUrls(): string[] {
  const extra = (process.env.OSN_URL || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return [...extra, ...OSN_DOWNLOAD_URLS]
}

function extractTarGz(archivePath: string, destDir: string): void {
  const tmp = path.join(getOsnRuntimeCacheDir(), 'osn-extract-tmp')
  fs.rmSync(tmp, { recursive: true, force: true })
  fs.mkdirSync(tmp, { recursive: true })

  const result = spawnSync('tar', ['-xzf', archivePath, '-C', tmp], {
    encoding: 'utf8',
    windowsHide: true
  })
  if (result.status !== 0) {
    throw new Error(`解压失败: ${result.stderr || result.stdout || `exit ${result.status}`}`)
  }

  const entries = fs.readdirSync(tmp)
  const root =
    entries.length === 1 && fs.statSync(path.join(tmp, entries[0])).isDirectory()
      ? path.join(tmp, entries[0])
      : tmp

  fs.rmSync(destDir, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(destDir), { recursive: true })
  fs.cpSync(root, destDir, { recursive: true, force: true, dereference: true })
  fs.rmSync(tmp, { recursive: true, force: true })
}

let ensurePromise: Promise<string> | null = null

/**
 * 打包版：将 obs-studio-node 下载到用户数据目录（安装包不包含 ~700MB 运行时）
 */
export async function ensureOsnRuntime(onProgress?: RuntimeProgressListener): Promise<string> {
  if (!app.isPackaged) {
    return fixPackagedPath(path.dirname(nodeRequire.resolve('obs-studio-node/package.json')))
  }

  const destDir = getOsnRuntimeDir()
  if (isOsnRuntimeReady()) {
    return destDir
  }

  if (!ensurePromise) {
    ensurePromise = installOsnRuntime(onProgress)
      .then((dir) => dir)
      .catch((err) => {
        ensurePromise = null
        throw err
      })
  }

  return ensurePromise
}

async function installOsnRuntime(onProgress?: RuntimeProgressListener): Promise<string> {
  const destDir = getOsnRuntimeDir()
  const cacheDir = getOsnRuntimeCacheDir()
  const archivePath = path.join(cacheDir, OSN_ARCHIVE)

  fs.mkdirSync(cacheDir, { recursive: true })

  onProgress?.({
    component: 'osn',
    label: '录制组件',
    phase: 'downloading',
    message: '正在下载录制组件',
    progress: 0
  })
  log('OSN runtime download start', OSN_VERSION)

  let lastProgress = -1
  const { url, size } = await downloadFirstToFile(
    collectOsnUrls(),
    archivePath,
    (_url, p) => {
      const nextProgress = p.progress ?? -1
      if (nextProgress === lastProgress) return
      lastProgress = nextProgress
      onProgress?.({
        component: 'osn',
        label: '录制组件',
        phase: 'downloading',
        message: p.progress !== undefined ? `正在下载录制组件 ${p.progress}%` : '正在下载录制组件',
        progress: p.progress,
        bytesReceived: p.bytesReceived,
        totalBytes: p.totalBytes
      })
    },
    (failedUrl, err) => log('OSN download try failed', failedUrl, err.message)
  )
  log('OSN runtime downloaded', url, `${(size / 1024 / 1024).toFixed(1)} MB`)

  const buf = fs.readFileSync(archivePath)
  if (buf.length < OSN_MIN_BYTES || buf[0] !== OSN_MAGIC_BYTE) {
    fs.unlinkSync(archivePath)
    throw new Error('下载内容无效，请检查网络后重试')
  }

  onProgress?.({
    component: 'osn',
    label: '录制组件',
    phase: 'extracting',
    message: '正在解压录制组件',
    progress: 99
  })
  extractTarGz(archivePath, destDir)

  if (!fs.existsSync(path.join(destDir, 'index.js'))) {
    throw new Error('解压后缺少 index.js，请删除 runtime 目录后重试')
  }

  fs.writeFileSync(versionMarkerPath(), OSN_VERSION, 'utf8')
  log('OSN runtime ready', destDir)
  onProgress?.({
    component: 'osn',
    label: '录制组件',
    phase: 'ready',
    message: '录制组件已就绪',
    progress: 100
  })
  return destDir
}

export function resetOsnRuntimeInstall(): void {
  ensurePromise = null
  const dir = getOsnRuntimeDir()
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch (err) {
    logError('Failed to remove OSN runtime dir', err)
  }
}
