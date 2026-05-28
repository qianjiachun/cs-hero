/**
 * 确保 resources/ffmpeg/ffmpeg.exe 存在（不提交 git，install 时自动下载）
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'
import { downloadFirst } from './lib/download.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const sources = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'runtime-sources.json'), 'utf8')
)
const cfg = sources.ffmpeg

const vendorDir = path.join(root, 'vendor')
const downloadDest = path.join(vendorDir, cfg.archive)
const ffmpegDir = path.join(root, 'resources', 'ffmpeg')
const ffmpegExe = path.join(ffmpegDir, 'ffmpeg.exe')

function ffmpegReady() {
  return fs.existsSync(ffmpegExe) && fs.statSync(ffmpegExe).size >= cfg.minBytes
}

function expandZip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true })
  const ps = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`
    ],
    { stdio: 'inherit' }
  )
  if (ps.status !== 0) {
    throw new Error(`解压失败: ${zipPath}`)
  }
}

function collectUrls() {
  const extra = (process.env.FFMPEG_URL || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return [...extra, ...cfg.urls]
}

async function main() {
  if (process.platform !== 'win32') {
    console.warn('[ensure-ffmpeg] 当前仅支持 Windows，已跳过')
    return
  }

  if (ffmpegReady()) {
    const stat = fs.statSync(ffmpegExe)
    console.log(
      `[ensure-ffmpeg] 已存在 ffmpeg.exe (${(stat.size / 1024 / 1024).toFixed(1)} MB)`
    )
    return
  }

  fs.mkdirSync(vendorDir, { recursive: true })
  fs.mkdirSync(ffmpegDir, { recursive: true })

  if (!fs.existsSync(downloadDest) || fs.statSync(downloadDest).size < cfg.minBytes) {
    console.log(`[ensure-ffmpeg] 正在下载 FFmpeg ${cfg.version}…`)
    const { url, size } = await downloadFirst(collectUrls(), downloadDest)
    console.log(`[ensure-ffmpeg] 已保存 ${downloadDest} (${(size / 1024 / 1024).toFixed(1)} MB) ← ${url}`)
  } else {
    console.log(`[ensure-ffmpeg] 使用缓存 ${cfg.archive}`)
  }

  if (cfg.archive.endsWith('.exe')) {
    fs.copyFileSync(downloadDest, ffmpegExe)
    if (!ffmpegReady()) {
      throw new Error('FFmpeg 安装后校验失败')
    }
    console.log(`[ensure-ffmpeg] 完成 → ${ffmpegExe}`)
    return
  }

  const tmpDir = path.join(vendorDir, '_ffmpeg_extract')
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true })

  console.log('[ensure-ffmpeg] 解压中…')
  expandZip(downloadDest, tmpDir)

  const srcExe = path.join(tmpDir, cfg.exeInZip)
  if (!fs.existsSync(srcExe)) {
    throw new Error(`zip 内未找到 ${cfg.exeInZip}，请检查 runtime-sources.json`)
  }

  fs.copyFileSync(srcExe, ffmpegExe)
  fs.rmSync(tmpDir, { recursive: true, force: true })

  if (!ffmpegReady()) {
    throw new Error('FFmpeg 安装后校验失败')
  }
  console.log(`[ensure-ffmpeg] 完成 → ${ffmpegExe}`)
}

main().catch((err) => {
  console.error('[ensure-ffmpeg]', err.message)
  console.error(
    '\n可手动下载 Windows 版 ffmpeg.exe 放到：\n' +
      `  ${ffmpegExe}\n` +
      '或设置环境变量 FFMPEG_URL 指向 exe/zip 直链后执行：\n' +
      '  node scripts/ensure-ffmpeg.mjs'
  )
  process.exit(1)
})
