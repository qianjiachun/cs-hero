import { app } from 'electron'
import path from 'path'

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
