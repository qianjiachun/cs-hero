import { spawn, type ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import type { FfmpegJobPhase, FfmpegJobStatus, FfmpegJobType, VideoMetadata } from '../../shared/recording-types'
import { paths } from '../shared/paths'
import { log, logError } from '../shared/logger'

type JobProgressListener = (status: FfmpegJobStatus) => void

interface InternalJob {
  status: FfmpegJobStatus
  proc: ChildProcess | null
  tempDir?: string
}

function parseDurationFromFfmpegStderr(stderr: string): number | undefined {
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (!m) return undefined
  const h = Number(m[1])
  const min = Number(m[2])
  const sec = Number(m[3])
  if (!Number.isFinite(h + min + sec)) return undefined
  return h * 3600 + min * 60 + sec
}

function parseTimeProgress(stderr: string): number | undefined {
  const m = stderr.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (!m) return undefined
  const h = Number(m[1])
  const min = Number(m[2])
  const sec = Number(m[3])
  if (!Number.isFinite(h + min + sec)) return undefined
  return h * 3600 + min * 60 + sec
}

export class FfmpegService {
  private readonly jobs = new Map<string, InternalJob>()
  private onJobStatusChanged: JobProgressListener | undefined

  setOnJobStatusChanged(listener: JobProgressListener | undefined): void {
    this.onJobStatusChanged = listener
  }

  getJobStatus(jobId: string): FfmpegJobStatus | null {
    return this.jobs.get(jobId)?.status ?? null
  }

  cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId)
    if (!job) return false
    if (job.proc && !job.proc.killed) {
      job.proc.kill('SIGTERM')
    }
    job.status = {
      ...job.status,
      phase: 'cancelled',
      message: '已取消',
      progress: job.status.progress
    }
    this.emitJob(job.status)
    this.cleanupJobTemp(job)
    return true
  }

  private emitJob(status: FfmpegJobStatus): void {
    this.onJobStatusChanged?.({ ...status })
  }

  private cleanupJobTemp(job: InternalJob): void {
    if (!job.tempDir) return
    try {
      fs.rmSync(job.tempDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    job.tempDir = undefined
  }

  assertAvailable(): void {
    if (!fs.existsSync(paths.ffmpegExe)) {
      throw new Error(`未找到 FFmpeg：${paths.ffmpegExe}`)
    }
  }

  async probeVideo(filePath: string): Promise<VideoMetadata> {
    this.assertAvailable()
    if (!fs.existsSync(filePath)) {
      return { durationSeconds: 0, probeError: '源文件不存在' }
    }

    return new Promise((resolve) => {
      const args = ['-hide_banner', '-i', filePath]
      const proc = spawn(paths.ffmpegExe, args, { windowsHide: true })
      let stderr = ''

      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })

      proc.on('close', () => {
        const durationSeconds = parseDurationFromFfmpegStderr(stderr) ?? 0
        const videoLine = stderr.match(/Video:\s*(\w+)/)
        const res = stderr.match(/,\s*(\d{2,5})x(\d{2,5})/)
        const fpsMatch = stderr.match(/(\d+(?:\.\d+)?)\s*fps/)
        const meta: VideoMetadata = {
          durationSeconds,
          codec: videoLine?.[1],
          width: res ? Number(res[1]) : undefined,
          height: res ? Number(res[2]) : undefined,
          fps: fpsMatch ? Number(fpsMatch[1]) : undefined
        }
        if (durationSeconds <= 0) {
          meta.probeError = '无法解析视频时长'
        }
        resolve(meta)
      })

      proc.on('error', (err) => {
        resolve({ durationSeconds: 0, probeError: err.message })
      })
    })
  }

  remuxMkvToMp4(inputMkv: string, outputMp4: string): Promise<void> {
    return this.runSimple([
      '-y',
      '-i',
      inputMkv,
      '-c',
      'copy',
      outputMp4
    ])
  }

  cutClip(
    inputMp4: string,
    outputMp4: string,
    startSeconds: number,
    durationSeconds: number,
    options?: { jobId?: string; jobType?: FfmpegJobType; totalDuration?: number }
  ): Promise<void> {
    const start = Math.max(0, startSeconds)
    const duration = Math.max(0.1, durationSeconds)
    const args = [
      '-y',
      '-ss',
      String(start),
      '-t',
      String(duration),
      '-i',
      inputMp4,
      '-c',
      'copy',
      '-avoid_negative_ts',
      'make_zero',
      outputMp4
    ]

    if (options?.jobId) {
      return this.runFfmpegJob({
        jobId: options.jobId,
        type: options.jobType ?? 'trim',
        args,
        outputPath: outputMp4,
        progressTotalSeconds: options.totalDuration ?? duration
      })
    }

    return this.runSimple(args)
  }

  concatClips(
    inputFiles: string[],
    outputMp4: string,
    options?: { jobId?: string; segmentDurations?: number[] }
  ): Promise<{ usedCompatMode: boolean }> {
    if (inputFiles.length === 0) {
      throw new Error('没有可合并的片段')
    }
    if (inputFiles.length === 1) {
      fs.mkdirSync(path.dirname(outputMp4), { recursive: true })
      fs.copyFileSync(inputFiles[0], outputMp4)
      return Promise.resolve({ usedCompatMode: false })
    }

    const jobId = options?.jobId ?? randomUUID()
    const tempDir = path.join(paths.tempDir, 'merge_jobs', jobId)
    fs.mkdirSync(tempDir, { recursive: true })

    const listPath = path.join(tempDir, 'concat_list.txt')
    const listBody = inputFiles
      .map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
      .join('\n')
    fs.writeFileSync(listPath, listBody, 'utf-8')

    const tmpOut = `${outputMp4}.tmp.mp4`

    const runCopy = (): Promise<void> =>
      this.runFfmpegJob({
        jobId,
        type: 'merge',
        args: [
          '-y',
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          listPath,
          '-c',
          'copy',
          '-movflags',
          '+faststart',
          tmpOut
        ],
        outputPath: tmpOut,
        progressTotalSeconds: options?.segmentDurations?.reduce((a, b) => a + b, 0),
        tempDir
      })

    return runCopy()
      .then(() => {
        fs.renameSync(tmpOut, outputMp4)
        return { usedCompatMode: false }
      })
      .catch(async (err) => {
        log('FFmpeg concat copy failed, trying compat re-encode', err)
        if (fs.existsSync(tmpOut)) {
          try {
            fs.unlinkSync(tmpOut)
          } catch {
            /* ignore */
          }
        }
        await this.runFfmpegJob({
          jobId,
          type: 'merge',
          args: [
            '-y',
            '-f',
            'concat',
            '-safe',
            '0',
            '-i',
            listPath,
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '23',
            '-c:a',
            'aac',
            '-movflags',
            '+faststart',
            tmpOut
          ],
          outputPath: tmpOut,
          progressTotalSeconds: options?.segmentDurations?.reduce((a, b) => a + b, 0),
          tempDir
        })
        fs.renameSync(tmpOut, outputMp4)
        return { usedCompatMode: true }
      })
  }

  private runSimple(args: string[]): Promise<void> {
    this.assertAvailable()
    return new Promise((resolve, reject) => {
      log('FFmpeg', paths.ffmpegExe, args.join(' '))
      const proc = spawn(paths.ffmpegExe, args, { windowsHide: true })
      let stderr = ''

      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })

      proc.on('error', (err) => {
        logError('FFmpeg spawn failed', err)
        reject(err)
      })

      proc.on('close', (code) => {
        const out = args[args.length - 1]
        if (code === 0 && fs.existsSync(out)) {
          resolve()
        } else {
          reject(new Error(`FFmpeg 退出码 ${code}：${stderr.slice(-500)}`))
        }
      })
    })
  }

  createJob(type: FfmpegJobType, message = '准备中…'): string {
    const jobId = randomUUID()
    const status: FfmpegJobStatus = {
      jobId,
      type,
      phase: 'pending',
      progress: 0,
      message
    }
    this.jobs.set(jobId, { status, proc: null })
    this.emitJob(status)
    return jobId
  }

  private runFfmpegJob(opts: {
    jobId: string
    type: FfmpegJobType
    args: string[]
    outputPath: string
    progressTotalSeconds?: number
    tempDir?: string
  }): Promise<void> {
    this.assertAvailable()

    let job = this.jobs.get(opts.jobId)
    if (!job) {
      job = {
        status: {
          jobId: opts.jobId,
          type: opts.type,
          phase: 'pending',
          progress: 0,
          message: '准备中…'
        },
        proc: null
      }
      this.jobs.set(opts.jobId, job)
    }

    if (opts.tempDir) {
      job.tempDir = opts.tempDir
    }

    job.status = {
      ...job.status,
      type: opts.type,
      phase: 'running',
      progress: 0,
      message: '处理中…',
      outputPath: opts.outputPath
    }
    this.emitJob(job.status)

    return new Promise((resolve, reject) => {
      log('FFmpeg job', opts.jobId, paths.ffmpegExe, opts.args.join(' '))
      const proc = spawn(paths.ffmpegExe, opts.args, { windowsHide: true })
      job!.proc = proc
      let stderr = ''

      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
        const total = opts.progressTotalSeconds
        const current = parseTimeProgress(stderr)
        if (total && total > 0 && current !== undefined) {
          const progress = Math.min(99, Math.round((current / total) * 100))
          if (progress > job!.status.progress) {
            job!.status = {
              ...job!.status,
              progress,
              message: `处理中… ${progress}%`
            }
            this.emitJob(job!.status)
          }
        }
      })

      proc.on('error', (err) => {
        logError('FFmpeg job spawn failed', err)
        job!.status = {
          ...job!.status,
          phase: 'failed',
          error: err.message,
          message: '失败'
        }
        this.emitJob(job!.status)
        this.cleanupJobTemp(job!)
        reject(err)
      })

      proc.on('close', (code) => {
        job!.proc = null
        if (job!.status.phase === 'cancelled') {
          reject(new Error('已取消'))
          return
        }
        if (code === 0 && fs.existsSync(opts.outputPath)) {
          job!.status = {
            ...job!.status,
            phase: 'completed',
            progress: 100,
            message: '完成',
            outputPath: opts.outputPath
          }
          this.emitJob(job!.status)
          resolve()
        } else {
          const errMsg = `FFmpeg 退出码 ${code}：${stderr.slice(-500)}`
          job!.status = {
            ...job!.status,
            phase: 'failed',
            progress: job!.status.progress,
            error: errMsg,
            message: '失败'
          }
          this.emitJob(job!.status)
          this.cleanupJobTemp(job!)
          reject(new Error(errMsg))
        }
      })
    })
  }
}
