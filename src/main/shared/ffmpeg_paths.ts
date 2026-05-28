import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { getAppDataRoot, getResourcesRoot } from './runtime_roots'

export function getFfmpegRuntimeDir(): string {
  return path.join(getAppDataRoot(), 'runtime', 'ffmpeg')
}

export function getFfmpegExePath(): string {
  if (app.isPackaged) {
    return path.join(getFfmpegRuntimeDir(), 'ffmpeg.exe')
  }
  return path.join(getResourcesRoot(), 'ffmpeg', 'ffmpeg.exe')
}

export function isFfmpegRuntimeReady(): boolean {
  return fs.existsSync(getFfmpegExePath())
}
