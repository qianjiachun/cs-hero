import { app } from 'electron'
import { createRequire } from 'module'
import path from 'path'
import fs from 'fs'
import { getAppDataRoot } from './runtime_roots'
import { fixPackagedPath } from './osn_path_utils'
import { OSN_VERSION } from './osn_constants'

export { OSN_VERSION, OSN_DIST, OSN_DOWNLOAD_URLS } from './osn_constants'
export { fixPackagedPath } from './osn_path_utils'

const nodeRequire = createRequire(import.meta.url)

/** obs-studio-node 模块目录（含 libobs 与插件） */
export function getOsnModuleDir(): string {
  if (app.isPackaged) {
    return getOsnRuntimeDir()
  }
  return fixPackagedPath(path.dirname(nodeRequire.resolve('obs-studio-node')))
}

export function getOsnRuntimeDir(): string {
  return path.join(getAppDataRoot(), 'runtime', 'osn-studio-node')
}

/**
 * OBS 配置与日志目录（对标 Envek osn-data / obs-studio-node-docs）
 * 与 libobs 运行时数据分离，放在应用数据根下。
 */
export function getOsnConfigDataPath(): string {
  return path.join(getAppDataRoot(), 'osn-data')
}

export function checkOsnInstalled(): boolean {
  if (app.isPackaged) {
    return isOsnRuntimeReady()
  }
  try {
    const dir = getOsnModuleDir()
    return fs.existsSync(path.join(dir, 'index.js'))
  } catch {
    return false
  }
}

export function isOsnRuntimeReady(): boolean {
  const dir = getOsnRuntimeDir()
  if (!fs.existsSync(path.join(dir, 'index.js'))) return false
  try {
    const marker = fs.readFileSync(path.join(dir, '.cs-hero-osn-version'), 'utf8').trim()
    return marker === OSN_VERSION
  } catch {
    return false
  }
}
