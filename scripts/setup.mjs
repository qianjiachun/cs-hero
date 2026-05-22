/**
 * 一键拉取全部运行时二进制（OSN / Electron / FFmpeg）
 * 等价于 pnpm install 中的 preinstall + postinstall 资源步骤，便于网络失败后重试
 */
import { spawnSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

function run(script) {
  console.log(`\n=== ${script} ===\n`)
  const r = spawnSync(process.execPath, [path.join(__dirname, script)], {
    cwd: root,
    stdio: 'inherit',
    env: process.env
  })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

run('ensure-osn.mjs')
run('ensure-ffmpeg.mjs')
run('ensure-electron.mjs')
console.log('\n[setup] 全部运行时资源已就绪。接下来可执行: pnpm dev\n')
