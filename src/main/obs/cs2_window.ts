import { execSync } from 'child_process'

/** OBS game_capture / window_capture 的 window 字段：标题:类名:进程名 */
export interface Cs2WindowInfo {
  /** OBS 格式，如 Counter-Strike 2:SDL_app:cs2.exe */
  obsWindowId: string
  title: string
  className: string
  width: number
  height: number
  /** 窗口矩形接近整屏时视为全屏/无边框全屏 */
  isFullscreenLikely: boolean
}

const PS_RESOLVE = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class CsHeroWin32 {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")]
  public static extern int GetSystemMetrics(int nIndex);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
$proc = Get-Process -Name cs2 -ErrorAction Stop | Select-Object -First 1
if ($proc.MainWindowHandle -eq 0) { throw 'no main window' }
$hwnd = $proc.MainWindowHandle
$title = if ($proc.MainWindowTitle) { $proc.MainWindowTitle } else { 'Counter-Strike 2' }
$sb = New-Object System.Text.StringBuilder 256
[void][CsHeroWin32]::GetClassName($hwnd, $sb, 256)
$class = $sb.ToString()
if (-not $class) { $class = 'SDL_app' }
$r = New-Object CsHeroWin32+RECT
[void][CsHeroWin32]::GetWindowRect($hwnd, [ref]$r)
$w = [Math]::Max(0, $r.Right - $r.Left)
$h = [Math]::Max(0, $r.Bottom - $r.Top)
$sw = [CsHeroWin32]::GetSystemMetrics(0)
$sh = [CsHeroWin32]::GetSystemMetrics(1)
$fs = ($sw -gt 0 -and $sh -gt 0 -and $w -ge [int]($sw * 0.9) -and $h -ge [int]($sh * 0.9))
@{ title=$title; class=$class; width=$w; height=$h; fullscreen=$fs } | ConvertTo-Json -Compress
`

function runPowerShell(script: string): string {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return execSync(`powershell -NoProfile -EncodedCommand ${encoded}`, {
    encoding: 'utf-8',
    windowsHide: true,
    timeout: 10000
  }).trim()
}

function buildObsWindowId(title: string, className: string): string {
  const safeTitle = title.replace(/:/g, ' ')
  return `${safeTitle}:${className}:cs2.exe`
}

export function isCs2ProcessRunning(): boolean {
  if (process.platform !== 'win32') return false
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq cs2.exe" /NH', {
      encoding: 'utf-8',
      windowsHide: true
    })
    return out.toLowerCase().includes('cs2.exe')
  } catch {
    return false
  }
}

/** 进程在且主窗口可解析时，才适合启动 game_capture */
export function isCs2CaptureReady(): boolean {
  return isCs2ProcessRunning() && resolveCs2Window() !== null
}

/** 通过 Win32 枚举 CS2 主窗口（仅 Windows） */
export function resolveCs2Window(): Cs2WindowInfo | null {
  if (process.platform !== 'win32') {
    return null
  }

  try {
    const raw = runPowerShell(PS_RESOLVE)
    if (!raw) return null

    const data = JSON.parse(raw) as {
      title?: string
      class?: string
      width?: number
      height?: number
      fullscreen?: boolean
    }

    const title = String(data.title ?? 'Counter-Strike 2').trim() || 'Counter-Strike 2'
    const className = String(data.class ?? 'SDL_app').trim() || 'SDL_app'
    const width = Number(data.width) || 0
    const height = Number(data.height) || 0

    return {
      obsWindowId: buildObsWindowId(title, className),
      title,
      className,
      width,
      height,
      isFullscreenLikely: Boolean(data.fullscreen)
    }
  } catch {
    return null
  }
}

/** OBS window 字段回退列表（正确顺序：标题:类名:exe） */
export function getCs2WindowFallbacks(resolved: Cs2WindowInfo | null): string[] {
  const list: string[] = []
  if (resolved?.obsWindowId) {
    list.push(resolved.obsWindowId)
  }
  const defaults = [
    'Counter-Strike 2:SDL_app:cs2.exe',
    'Counter-Strike:SDL_app:cs2.exe',
    'Counter-Strike 2:SDL_app:cs2',
    '*:SDL_app:cs2.exe'
  ]
  for (const id of defaults) {
    if (!list.includes(id)) list.push(id)
  }
  return list
}
