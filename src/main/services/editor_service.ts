import fs from 'fs'
import path from 'path'
import type {
  EditorExportTrimRequest,
  EditorExportTrimResult,
  EditorOpenRequest,
  EditorSession
} from '../../shared/recording-types'
import { toMediaUrl } from '../shared/media_protocol'
import { paths } from '../shared/paths'
import { log, logError } from '../shared/logger'
import { ContentService } from './content_service'
import { FfmpegService } from './ffmpeg_service'

function formatExportTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}

function assertUnderDir(baseDir: string, targetPath: string): void {
  const base = path.resolve(baseDir)
  const resolved = path.resolve(targetPath)
  if (resolved === base) return
  if (!resolved.startsWith(base + path.sep)) {
    throw new Error('路径无效')
  }
}

function resolveSourceVideo(
  matchDir: string,
  req: Pick<EditorOpenRequest, 'source' | 'clipFile'>
): { absolutePath: string; clipFile?: string; displayName: string } {
  if (req.source === 'full_match') {
    const fullPath = path.join(matchDir, 'full_match.mp4')
    if (!fs.existsSync(fullPath)) {
      throw new Error('整局录像不存在，可能已按设置删除')
    }
    return {
      absolutePath: fullPath,
      displayName: '整局录像 full_match.mp4'
    }
  }

  if (!req.clipFile || typeof req.clipFile !== 'string') {
    throw new Error('未指定片段文件')
  }

  const normalized = req.clipFile.replace(/\\/g, '/')
  if (normalized.includes('..') || path.isAbsolute(normalized)) {
    throw new Error('片段路径无效')
  }

  const clipPath = path.join(matchDir, normalized)
  assertUnderDir(path.join(matchDir, 'clips'), clipPath)

  if (!fs.existsSync(clipPath)) {
    throw new Error(`片段不存在：${normalized}`)
  }

  return {
    absolutePath: clipPath,
    clipFile: normalized,
    displayName: path.basename(normalized)
  }
}

export class EditorService {
  private readonly content = new ContentService()
  private readonly ffmpeg = new FfmpegService()
  private exportBusy = false

  getSession(req: EditorOpenRequest): EditorSession {
    const detail = this.content.getMatch(req.matchId)
    if (!detail) {
      throw new Error('对局不存在')
    }
    if (detail.parseError && !detail.clips.length && !detail.hasFullMatch) {
      throw new Error(`对局信息异常：${detail.parseError}`)
    }

    const matchDir = detail.dir
    const resolved = resolveSourceVideo(matchDir, req)

    return {
      matchId: req.matchId,
      map: detail.map,
      source: req.source,
      clipFile: resolved.clipFile,
      sourceVideoPath: resolved.absolutePath,
      sourceVideoUrl: toMediaUrl(resolved.absolutePath),
      displayName: resolved.displayName,
      matchDir,
      canDelete: req.source === 'clip' && !!resolved.clipFile
    }
  }

  async exportTrim(request: EditorExportTrimRequest): Promise<EditorExportTrimResult> {
    if (this.exportBusy) {
      throw new Error('导出进行中，请稍候')
    }

    const start = Number(request.startSeconds)
    const end = Number(request.endSeconds)
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      throw new Error('起止时间无效')
    }
    if (start < 0) {
      throw new Error('起点不能小于 0')
    }
    if (end <= start) {
      throw new Error('终点必须大于起点')
    }

    const duration = end - start
    if (duration < 0.1) {
      throw new Error('片段时长过短')
    }

    const openReq: EditorOpenRequest = {
      matchId: request.matchId,
      source: request.source,
      clipFile: request.clipFile
    }

    const session = this.getSession(openReq)
    if (!fs.existsSync(session.sourceVideoPath)) {
      throw new Error('源文件不存在')
    }

    fs.mkdirSync(paths.exportsDir, { recursive: true })

    const ts = formatExportTimestamp(new Date())
    let fileName: string
    if (request.source === 'clip' && request.clipFile) {
      const base = path.basename(request.clipFile, path.extname(request.clipFile))
      const safeBase = base.replace(/[^\w.-]+/g, '_')
      fileName = `${request.matchId}_${safeBase}_export_${ts}.mp4`
    } else {
      fileName = `${request.matchId}_clip_${ts}.mp4`
    }

    const outputPath = path.join(paths.exportsDir, fileName)

    this.exportBusy = true
    try {
      await this.ffmpeg.cutClip(session.sourceVideoPath, outputPath, start, duration)
      log('Editor export done', outputPath, `start=${start}`, `duration=${duration}`)
      return {
        outputPath,
        fileName,
        durationSeconds: duration
      }
    } catch (err) {
      logError('Editor export failed', err)
      throw err
    } finally {
      this.exportBusy = false
    }
  }

  deleteClip(matchId: string, clipFile: string): void {
    if (!clipFile || typeof clipFile !== 'string') {
      throw new Error('未指定片段文件')
    }

    const detail = this.content.getMatch(matchId)
    if (!detail) {
      throw new Error('对局不存在')
    }

    const normalized = clipFile.replace(/\\/g, '/')
    if (normalized.includes('..') || path.isAbsolute(normalized)) {
      throw new Error('片段路径无效')
    }

    const clipPath = path.join(detail.dir, normalized)
    assertUnderDir(path.join(detail.dir, 'clips'), clipPath)

    if (!fs.existsSync(clipPath)) {
      throw new Error('片段不存在')
    }

    fs.unlinkSync(clipPath)
    log('Editor deleted clip file', clipPath)
  }
}
