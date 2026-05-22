/**
 * preinstall：确保 vendor 内存在 obs-studio-node win64 包（不提交 git）
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { downloadFirst } from './lib/download.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const sources = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'runtime-sources.json'), 'utf8')
)
const cfg = sources.osn

const vendorDir = path.join(root, 'vendor')
const dest = path.join(vendorDir, cfg.archive)

function collectUrls() {
  const extra = (process.env.OSN_URL || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return [...extra, ...cfg.urls]
}

async function main() {
  if (fs.existsSync(dest)) {
    const stat = fs.statSync(dest)
    if (stat.size >= cfg.minBytes) {
      console.log(`[ensure-osn] 已存在 ${cfg.archive} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`)
      return
    }
    console.warn('[ensure-osn] 已有文件过小，重新下载…')
    fs.unlinkSync(dest)
  }

  fs.mkdirSync(vendorDir, { recursive: true })
  console.log(`[ensure-osn] 正在下载 obs-studio-node ${cfg.version}…`)

  const { url, size } = await downloadFirst(collectUrls(), dest)
  const buf = fs.readFileSync(dest)
  if (buf.length < cfg.minBytes || buf[0] !== cfg.magicByte) {
    fs.unlinkSync(dest)
    const preview = buf.slice(0, 120).toString('utf8')
    throw new Error(
      `下载内容不像 tar.gz（${buf.length} 字节）。可能被网络拦截。\n预览: ${preview}`
    )
  }

  console.log(`[ensure-osn] 已保存 ${dest} (${(size / 1024 / 1024).toFixed(1)} MB) ← ${url}`)
}

main().catch((err) => {
  console.error('[ensure-osn]', err.message)
  console.error(
    '\n请手动下载后放到 vendor/，或设置 OSN_URL 为直链后重试：\n' +
      collectUrls()
        .map((u) => `  ${u}`)
        .join('\n') +
      `\n  → vendor/${cfg.archive}\n` +
      '然后执行: pnpm install  或  pnpm run setup'
  )
  process.exit(1)
})
