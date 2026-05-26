import fs from 'fs'
import path from 'path'
import { resolveSteamInstallPath } from './cs2_gsi_config'

/** CS2 游戏采集需要此启动项（Source 2 / OBS game capture） */
export const CS2_REQUIRED_LAUNCH_OPTION = '-allow_third_party_software'
export const CS2_STEAM_APP_ID = '730'

export type Cs2LaunchOptionStatus = 'ok' | 'missing' | 'unknown'

export interface Cs2LaunchOptionInspectResult {
  status: Cs2LaunchOptionStatus
  steamPath?: string
  /** 任一 Steam 账号下读到的启动项（用于展示） */
  launchOptions?: string
  accountsChecked: number
  message: string
}

export function launchOptionsIncludeRequiredFlag(options: string): boolean {
  const tokens = options.trim().split(/\s+/).filter(Boolean)
  const required = CS2_REQUIRED_LAUNCH_OPTION.toLowerCase()
  return tokens.some((t) => t.toLowerCase() === required)
}

function listSteamUserIds(steamPath: string): string[] {
  const userdata = path.join(steamPath, 'userdata')
  if (!fs.existsSync(userdata)) return []
  return fs
    .readdirSync(userdata, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d+$/.test(e.name))
    .map((e) => e.name)
}

/** 从 localconfig.vdf 片段中解析指定 App 的 LaunchOptions */
export function parseLaunchOptionsForApp(vdfContent: string, appId: string): string | null {
  const marker = `"${appId}"`
  const idx = vdfContent.indexOf(marker)
  if (idx === -1) return null
  const window = vdfContent.slice(idx, idx + 8192)
  const match = window.match(/"LaunchOptions"\s*"([^"]*)"/i)
  if (!match) return ''
  return match[1] ?? ''
}

export function inspectCs2LaunchOptions(): Cs2LaunchOptionInspectResult {
  const steamPath = resolveSteamInstallPath()
  if (!steamPath) {
    return {
      status: 'unknown',
      accountsChecked: 0,
      message: '未找到 Steam 安装路径，无法检测 CS2 启动项。'
    }
  }

  const userIds = listSteamUserIds(steamPath)
  if (userIds.length === 0) {
    return {
      status: 'unknown',
      steamPath,
      accountsChecked: 0,
      message: '未找到 Steam userdata，请先在 Steam 中登录并启动过一次 CS2。'
    }
  }

  let anyAccountHasApp = false
  let anyOk = false
  let sampleOptions: string | undefined

  for (const userId of userIds) {
    const vdfPath = path.join(steamPath, 'userdata', userId, 'config', 'localconfig.vdf')
    if (!fs.existsSync(vdfPath)) continue

    let content: string
    try {
      content = fs.readFileSync(vdfPath, 'utf-8')
    } catch {
      continue
    }

    const options = parseLaunchOptionsForApp(content, CS2_STEAM_APP_ID)
    if (options === null) continue

    anyAccountHasApp = true
    sampleOptions = options
    if (launchOptionsIncludeRequiredFlag(options)) {
      anyOk = true
      break
    }
  }

  if (anyOk) {
    return {
      status: 'ok',
      steamPath,
      launchOptions: sampleOptions,
      accountsChecked: userIds.length,
      message: '已检测到 CS2 启动项包含 -allow_third_party_software。'
    }
  }

  if (anyAccountHasApp) {
    return {
      status: 'missing',
      steamPath,
      launchOptions: sampleOptions,
      accountsChecked: userIds.length,
      message:
        'CS2 启动项缺少 -allow_third_party_software，游戏采集/录制可能黑屏或失败。请添加后重启 CS2。'
    }
  }

  return {
    status: 'missing',
    steamPath,
    accountsChecked: userIds.length,
    message:
      'Steam 中尚未记录 CS2 启动项配置。请为 CS2 添加 -allow_third_party_software 后重启游戏。'
  }
}
