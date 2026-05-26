import fs from 'fs'
import path from 'path'
import type {
  MergeCandidates,
  MergeCreateRequest,
  MergeResult,
  MergeSelectionItem,
  VideoMetadata
} from '../../shared/recording-types'
import { paths } from '../shared/paths'
import { log, logError } from '../shared/logger'
import { ContentService } from './content_service'
import { loadSettings } from './settings_service'
import { getFfmpegService, getRecorderService } from './app_services'

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

function writeMergedVideoField(matchDir: string, fileName: string): void {
  const p = path.join(matchDir, 'match.json')
  if (!fs.existsSync(p)) return
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, unknown>
    raw.merged_video = fileName
    fs.writeFileSync(p, JSON.stringify(raw, null, 2), 'utf-8')
  } catch (err) {
    logError('Failed to update match.json merged_video', err)
  }
}

export class ClipMergeService {
  private readonly content = new ContentService()
  private readonly ffmpeg = getFfmpegService()
  private mergeBusy = false

  isBusy(): boolean {
    return this.mergeBusy
  }

  assertCanMergeMatch(matchId: string): void {
    if (getRecorderService().isBusy()) {
      const activeId = getRecorderService().getActiveMatchId()
      if (!activeId || activeId === matchId) {
        throw new Error('对局录制进行中，请结束后再合并')
      }
    }
  }

  async getMergeCandidates(matchId: string): Promise<MergeCandidates> {
    const detail = this.content.getMatch(matchId)
    if (!detail) {
      throw new Error('对局不存在')
    }

    const mergedPath = path.join(detail.dir, 'merged.mp4')
    const hasMergedVideo = fs.existsSync(mergedPath)
    let metadata: VideoMetadata | undefined

    if (detail.full_match_path && fs.existsSync(detail.full_match_path)) {
      metadata = await this.ffmpeg.probeVideo(detail.full_match_path)
    }

    const clips = await Promise.all(
      detail.clips.map(async (c) => {
        const abs = path.join(detail.dir, c.file)
        let durationSeconds: number | undefined
        if (fs.existsSync(abs)) {
          const meta = await this.ffmpeg.probeVideo(abs)
          durationSeconds = meta.durationSeconds > 0 ? meta.durationSeconds : undefined
        }
        return {
          file: c.file,
          type: c.type,
          time: c.time,
          durationSeconds
        }
      })
    )

    const bookmarks = (detail.bookmarks ?? []).map((b, index) => ({
      index,
      type: b.type,
      time: b.time
    }))

    return {
      matchId,
      hasFullMatch: detail.hasFullMatch,
      hasMergedVideo,
      fullMatchPath: detail.full_match_path,
      clips,
      bookmarks,
      metadata
    }
  }

  async createMergedVideo(request: MergeCreateRequest): Promise<MergeResult> {
    if (this.mergeBusy) {
      throw new Error('合并任务进行中，请稍候')
    }

    const { matchId, selections, exportOnly } = request
    if (!selections || selections.length < 2) {
      throw new Error('请至少选择 2 个片段进行合并')
    }

    this.assertCanMergeMatch(matchId)

    const detail = this.content.getMatch(matchId)
    if (!detail) {
      throw new Error('对局不存在')
    }

    const settings = loadSettings()
    const fullPath = detail.full_match_path
    const jobId = this.ffmpeg.createJob('merge', '准备合并…')
    const jobTempDir = path.join(paths.tempDir, 'merge_jobs', jobId)
    fs.mkdirSync(jobTempDir, { recursive: true })

    this.mergeBusy = true
    let segmentPaths: string[] = []
    const segmentDurations: number[] = []

    try {
      const fullDuration =
        fullPath && fs.existsSync(fullPath)
          ? (await this.ffmpeg.probeVideo(fullPath)).durationSeconds
          : 0

      let segIndex = 0
      for (const sel of selections) {
        const segPath = await this.resolveSelectionToSegment(
          detail.dir,
          fullPath,
          detail.hasFullMatch,
          detail.bookmarks,
          sel,
          settings.clipSecondsBefore,
          settings.clipSecondsAfter,
          jobTempDir,
          segIndex,
          jobId,
          fullDuration
        )
        segmentPaths.push(segPath)
        const meta = await this.ffmpeg.probeVideo(segPath)
        segmentDurations.push(meta.durationSeconds > 0 ? meta.durationSeconds : 1)
        segIndex++
      }

      const ts = formatExportTimestamp(new Date())
      let outputPath: string
      let fileName: string

      if (exportOnly) {
        fs.mkdirSync(paths.exportsDir, { recursive: true })
        fileName = `${matchId}_merged_${ts}.mp4`
        outputPath = path.join(paths.exportsDir, fileName)
      } else {
        fileName = 'merged.mp4'
        outputPath = path.join(detail.dir, 'merged.mp4')
      }

      const finalTmp = `${outputPath}.tmp.mp4`
      const { usedCompatMode } = await this.ffmpeg.concatClips(segmentPaths, finalTmp, {
        jobId,
        segmentDurations
      })
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath)
      }
      fs.renameSync(finalTmp, outputPath)

      if (!exportOnly) {
        writeMergedVideoField(detail.dir, fileName)
      }

      log(exportOnly ? 'Merge exported' : 'Merge created in match dir', outputPath)
      return {
        outputPath,
        fileName,
        durationSeconds: segmentDurations.reduce((a, b) => a + b, 0),
        usedCompatMode
      }
    } catch (err) {
      logError('Merge failed', err)
      throw err
    } finally {
      this.mergeBusy = false
      try {
        fs.rmSync(jobTempDir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  }

  private async resolveSelectionToSegment(
    matchDir: string,
    fullPath: string | undefined,
    hasFullMatch: boolean,
    bookmarks: Array<{ type: string; time: number }>,
    sel: MergeSelectionItem,
    before: number,
    after: number,
    jobTempDir: string,
    segIndex: number,
    jobId: string,
    fullDuration: number
  ): Promise<string> {
    if (sel.kind === 'clip') {
      const normalized = sel.clipFile.replace(/\\/g, '/')
      if (normalized.includes('..') || path.isAbsolute(normalized)) {
        throw new Error('片段路径无效')
      }
      const clipPath = path.join(matchDir, normalized)
      assertUnderDir(path.join(matchDir, 'clips'), clipPath)
      if (!fs.existsSync(clipPath)) {
        throw new Error(`片段不存在：${normalized}`)
      }
      return clipPath
    }

    if (!hasFullMatch || !fullPath || !fs.existsSync(fullPath)) {
      throw new Error('整局录像不存在，无法按事件锚点裁切')
    }

    const bm = bookmarks[sel.bookmarkIndex]
    if (!bm) {
      throw new Error('事件锚点无效')
    }

    const start = Math.max(0, bm.time - before)
    let duration = before + after
    if (fullDuration > 0) {
      duration = Math.min(duration, Math.max(0.1, fullDuration - start))
    }

    const outSeg = path.join(jobTempDir, `segment_${String(segIndex).padStart(3, '0')}.mp4`)
    await this.ffmpeg.cutClip(fullPath, outSeg, start, duration, {
      jobId,
      jobType: 'merge',
      totalDuration: duration
    })
    return outSeg
  }
}
