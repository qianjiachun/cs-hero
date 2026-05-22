import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { log } from '../../shared/logger'

export const CS2_GSI_CFG_FILENAME = 'gamestate_integration_cshero.cfg'

export function buildGsiCfgContent(port: number): string {
  const uri = `http://127.0.0.1:${port}/`
  return `"CS Hero Integration"
{
    "uri"           "${uri}"
    "timeout"       "5.0"
    "buffer"        "0.1"
    "throttle"      "0.05"
    "heartbeat"     "30.0"
    "data"
    {
        "provider"           "1"
        "map"                "1"
        "round"              "1"
        "player_id"          "1"
        "player_state"       "1"
        "player_match_stats" "1"
    }
}
`
}

export function resolveSteamInstallPath(): string | null {
  try {
    const out = execSync('reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath', {
      encoding: 'utf-8',
      windowsHide: true
    })
    const match = out.match(/SteamPath\s+REG_SZ\s+(.+)/i)
    if (match?.[1]) {
      const steamPath = match[1].trim().replace(/\\/g, path.sep)
      if (fs.existsSync(path.join(steamPath, 'steamapps'))) {
        return steamPath
      }
    }
  } catch {
    // registry miss
  }

  const candidates = [
    path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Steam'),
    path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Steam'),
    'C:\\Program Files (x86)\\Steam',
    'D:\\Steam'
  ]

  for (const steamPath of candidates) {
    if (fs.existsSync(path.join(steamPath, 'steamapps'))) {
      return steamPath
    }
  }

  return null
}

export function resolveCs2CfgDir(): string | null {
  const steam = resolveSteamInstallPath()
  if (!steam) return null

  const cfgDir = path.join(
    steam,
    'steamapps',
    'common',
    'Counter-Strike Global Offensive',
    'game',
    'csgo',
    'cfg'
  )
  if (!fs.existsSync(cfgDir)) {
    log('CS2 cfg dir not found', cfgDir)
    return null
  }
  return cfgDir
}

export function getCs2GsiCfgPath(): string | null {
  const cfgDir = resolveCs2CfgDir()
  if (!cfgDir) return null
  return path.join(cfgDir, CS2_GSI_CFG_FILENAME)
}

export function sanitizeMapNameForMatchId(mapName: string): string {
  const base = mapName.replace(/^de_/i, '').trim()
  const safe = base.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()
  return safe || 'unknown'
}
