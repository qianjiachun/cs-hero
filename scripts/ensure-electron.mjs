/**
 * 确保 electron 可执行文件已下载（pnpm install 若网络失败会缺 dist/）
 * 使用项目 .npmrc 中的 electron_mirror
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const electronDir = path.join(root, 'node_modules', 'electron')
const pathFile = path.join(electronDir, 'path.txt')
const distExe = path.join(electronDir, 'dist', 'electron.exe')

function electronReady() {
  if (!fs.existsSync(pathFile)) return false
  const name = fs.readFileSync(pathFile, 'utf8').trim()
  return fs.existsSync(path.join(electronDir, 'dist', name))
}

async function main() {
  if (electronReady()) {
    console.log('[ensure-electron] 已就绪')
    return
  }

  const installJs = path.join(electronDir, 'install.js')
  if (!fs.existsSync(installJs)) {
    console.warn('[ensure-electron] 跳过：未找到 node_modules/electron，请先 pnpm install')
    return
  }

  const npmrc = path.join(root, '.npmrc')
  let mirror = process.env.ELECTRON_MIRROR || ''
  if (!mirror && fs.existsSync(npmrc)) {
    const m = fs.readFileSync(npmrc, 'utf8').match(/^\s*electron_mirror\s*=\s*(.+)\s*$/m)
    if (m) mirror = m[1].trim()
  }
  if (mirror) {
    process.env.ELECTRON_MIRROR = mirror
    console.log(`[ensure-electron] 使用镜像 ${mirror}`)
  }

  console.log('[ensure-electron] 正在下载 Electron 二进制…')
  const r = spawnSync(process.execPath, [installJs], {
    cwd: root,
    stdio: 'inherit',
    env: process.env
  })

  if (r.status !== 0 || !electronReady()) {
    throw new Error(
      'Electron 二进制未安装成功。请检查网络/代理，或设置 ELECTRON_MIRROR 后重试：\n' +
        '  node scripts/ensure-electron.mjs'
    )
  }
  console.log('[ensure-electron] 完成', distExe)
}

main().catch((err) => {
  console.error('[ensure-electron]', err.message)
  process.exit(1)
})
