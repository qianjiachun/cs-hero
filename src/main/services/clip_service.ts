import fs from 'fs'
import path from 'path'
import type { Bookmark, ClipInfo } from '../../shared/recording-types'
import type { AppSettings } from '../../shared/settings'
import { log, logError } from '../shared/logger'
import { FfmpegService } from './ffmpeg_service'

export interface ClipSegment {
  bookmark: Bookmark
  startSeconds: number
  durationSeconds: number
  outputPath: string
  relativeFile: string
}

/** 将 kill Bookmark 转为 FFmpeg 切片区间（预留重叠合并扩展点） */
export function buildClipSegments(
  killBookmarks: Bookmark[],
  fullMatchMp4: string,
  clipsDir: string,
  settings: Pick<AppSettings, 'clipSecondsBefore' | 'clipSecondsAfter'>
): ClipSegment[] {
  const segments: ClipSegment[] = []

  for (const bookmark of killBookmarks) {
    const occurred = new Date(bookmark.occurredAt)
    const fileName = formatKillClipName(occurred)
    const outputPath = path.join(clipsDir, fileName)
    const startSeconds = Math.max(0, bookmark.time - settings.clipSecondsBefore)
    const durationSeconds = settings.clipSecondsBefore + settings.clipSecondsAfter

    segments.push({
      bookmark,
      startSeconds,
      durationSeconds,
      outputPath,
      relativeFile: path.join('clips', fileName).replace(/\\/g, '/')
    })
  }

  return segments
}

function formatKillClipName(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `kill_${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}.mp4`
}

export class ClipService {
  constructor(private readonly ffmpeg = new FfmpegService()) {}

  async generateKillClips(
    fullMatchMp4: string,
    clipsDir: string,
    killBookmarks: Bookmark[],
    settings: Pick<AppSettings, 'clipSecondsBefore' | 'clipSecondsAfter'>
  ): Promise<{ clips: ClipInfo[]; errors: string[] }> {
    fs.mkdirSync(clipsDir, { recursive: true })

    const segments = buildClipSegments(killBookmarks, fullMatchMp4, clipsDir, settings)
    const clips: ClipInfo[] = []
    const errors: string[] = []

    for (const seg of segments) {
      try {
        await this.ffmpeg.cutClip(
          fullMatchMp4,
          seg.outputPath,
          seg.startSeconds,
          seg.durationSeconds
        )
        clips.push({
          type: 'kill',
          time: seg.bookmark.time,
          file: seg.relativeFile
        })
        log('Clip created', seg.relativeFile)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(`${seg.relativeFile}: ${msg}`)
        logError('Clip failed', seg.relativeFile, err)
      }
    }

    return { clips, errors }
  }
}
