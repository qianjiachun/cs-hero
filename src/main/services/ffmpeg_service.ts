import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { paths } from '../shared/paths'
import { log, logError } from '../shared/logger'

export class FfmpegService {
  assertAvailable(): void {
    if (!fs.existsSync(paths.ffmpegExe)) {
      throw new Error(`未找到 FFmpeg：${paths.ffmpegExe}`)
    }
  }

  remuxMkvToMp4(inputMkv: string, outputMp4: string): Promise<void> {
    this.assertAvailable()
    if (!fs.existsSync(inputMkv)) {
      throw new Error(`源文件不存在：${inputMkv}`)
    }

    fs.mkdirSync(path.dirname(outputMp4), { recursive: true })

    return new Promise((resolve, reject) => {
      const args = ['-y', '-i', inputMkv, '-c', 'copy', outputMp4]
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
        if (code === 0 && fs.existsSync(outputMp4)) {
          log('FFmpeg remux done', outputMp4)
          resolve()
        } else {
          reject(new Error(`FFmpeg 退出码 ${code}：${stderr.slice(-500)}`))
        }
      })
    })
  }

  cutClip(
    inputMp4: string,
    outputMp4: string,
    startSeconds: number,
    durationSeconds: number
  ): Promise<void> {
    this.assertAvailable()
    if (!fs.existsSync(inputMp4)) {
      throw new Error(`源文件不存在：${inputMp4}`)
    }

    const start = Math.max(0, startSeconds)
    const duration = Math.max(0.1, durationSeconds)

    fs.mkdirSync(path.dirname(outputMp4), { recursive: true })

    return new Promise((resolve, reject) => {
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
      log('FFmpeg clip', paths.ffmpegExe, args.join(' '))

      const proc = spawn(paths.ffmpegExe, args, { windowsHide: true })
      let stderr = ''

      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })

      proc.on('error', (err) => {
        logError('FFmpeg clip spawn failed', err)
        reject(err)
      })

      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(outputMp4)) {
          log('FFmpeg clip done', outputMp4)
          resolve()
        } else {
          reject(new Error(`FFmpeg clip 退出码 ${code}：${stderr.slice(-500)}`))
        }
      })
    })
  }
}
