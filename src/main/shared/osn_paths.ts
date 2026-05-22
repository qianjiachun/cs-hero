import { createRequire } from 'module'
import path from 'path'
import fs from 'fs'
import { getAppDataRoot } from './paths'

const nodeRequire = createRequire(import.meta.url)

/** 与 package.json / Streamlabs S3 发行包一致 */
export const OSN_VERSION = '0.26.22'

export const OSN_DIST = {
  win64: `https://s3-us-west-2.amazonaws.com/obsstudionodes3.streamlabs.com/osn-${OSN_VERSION}-release-win64.tar.gz`
} as const

/** 打包时 asar 内路径替换为 unpacked */
export function fixPackagedPath(p: string): string {
  return p.replace(/app\.asar([/\\])/g, 'app.asar.unpacked$1')
}

/** obs-studio-node 模块目录（含 libobs 与插件） */
export function getOsnModuleDir(): string {
  return fixPackagedPath(path.dirname(nodeRequire.resolve('obs-studio-node')))
}

/**
 * OBS 配置与日志目录（对标 Envek osn-data / obs-studio-node-docs）
 * 与 libobs 运行时数据分离，放在应用数据根下。
 */
export function getOsnConfigDataPath(): string {
  return path.join(getAppDataRoot(), 'osn-data')
}

export function checkOsnInstalled(): boolean {
  try {
    const dir = getOsnModuleDir()
    return fs.existsSync(dir)
  } catch {
    return false
  }
}
