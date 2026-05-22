import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { checkOsnInstalled, getOsnModuleDir } from './osn_paths'

/** 安装目录 / 开发时仓库根（含 package.json） */
export function getProjectRoot(): string {
  if (app.isPackaged) {
    return path.dirname(process.execPath)
  }
  return app.getAppPath()
}

/** 运行时数据根：dev → {root}/dev/，打包 → 安装根 */
export function getAppDataRoot(): string {
  const root = getProjectRoot()
  return app.isPackaged ? root : path.join(root, 'dev')
}

/** OBS / FFmpeg 等资源根 */
export function getResourcesRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'resources')
  }
  return path.join(getProjectRoot(), 'resources')
}

export const paths = {
  get appDataRoot() {
    return getAppDataRoot()
  },
  get dataDir() {
    return path.join(getAppDataRoot(), 'data')
  },
  get matchesDir() {
    return path.join(getAppDataRoot(), 'data', 'matches')
  },
  get tempDir() {
    return path.join(getAppDataRoot(), 'temp')
  },
  get cacheDir() {
    return path.join(getAppDataRoot(), 'cache')
  },
  get exportsDir() {
    return path.join(getAppDataRoot(), 'exports')
  },
  get logsDir() {
    return path.join(getAppDataRoot(), 'logs')
  },
  get settingsPath() {
    return path.join(getAppDataRoot(), 'settings.json')
  },
  get recordingTmpMkv() {
    return path.join(getAppDataRoot(), 'temp', 'recording_tmp.mkv')
  },
  get resourcesRoot() {
    return getResourcesRoot()
  },
  /** 可选：绿色包内自带的 OBS 数据（若存在则优先于 node_modules 内嵌） */
  get bundledObsDataDir() {
    return path.join(getResourcesRoot(), 'obs', 'data')
  },
  get ffmpegExe() {
    return path.join(getResourcesRoot(), 'ffmpeg', 'ffmpeg.exe')
  }
}

export function ensureRuntimeDirs(): void {
  for (const dir of [
    paths.dataDir,
    paths.matchesDir,
    paths.tempDir,
    paths.cacheDir,
    paths.exportsDir,
    paths.logsDir,
    path.join(getAppDataRoot(), 'osn-data')
  ]) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

export interface ResourcesCheckResult {
  ok: boolean
  missing: string[]
}

export function checkResources(): ResourcesCheckResult {
  const missing: string[] = []

  if (!checkOsnInstalled()) {
    missing.push(
      'obs-studio-node 0.26.22（请执行 pnpm install，从 Streamlabs S3 安装 win64 包）'
    )
  } else {
    try {
      const osnDir = getOsnModuleDir()
      if (!fs.existsSync(osnDir)) {
        missing.push(osnDir)
      }
    } catch {
      missing.push('obs-studio-node 模块路径无法解析')
    }
  }

  if (!fs.existsSync(paths.ffmpegExe)) {
    missing.push(paths.ffmpegExe)
  }

  return { ok: missing.length === 0, missing }
}
