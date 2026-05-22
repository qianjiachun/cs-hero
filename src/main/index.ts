import { app, BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'

// 双显卡笔记本：让 Electron 与 OBS 子进程走独显，game_capture 才能与 CS2 共享 D3D 纹理
app.commandLine.appendSwitch('force-high-performance-gpu')
app.commandLine.appendSwitch('ignore-gpu-blocklist')
import { registerIpcHandlers, scheduleObsWarmUp, shutdownServices } from './ipc/handlers'
import { ensureRuntimeDirs } from './shared/paths'
import { log, logError } from './shared/logger'

function resolvePreloadPath(): string {
  const base = path.join(__dirname, '../preload/index')
  const candidates = [`${base}.cjs`, `${base}.js`, `${base}.mjs`]
  const chosen = candidates.find((p) => fs.existsSync(p)) ?? `${base}.cjs`
  return path.resolve(chosen)
}

function createWindow(): BrowserWindow {
  const preloadPath = resolvePreloadPath()
  log('Preload path', preloadPath, 'exists=', fs.existsSync(preloadPath))

  const win = new BrowserWindow({
    width: 720,
    height: 680,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.webContents.on('preload-error', (_event, failedPath, error) => {
    logError('Preload error', `${failedPath}: ${error?.message ?? error}`)
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    win.loadURL(devUrl)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  let windowShown = false
  let pageLoaded = false

  const tryScheduleObsWarmUp = (): void => {
    if (!windowShown || !pageLoaded) return
    scheduleObsWarmUp()
  }

  win.webContents.on('did-finish-load', () => {
    pageLoaded = true
    tryScheduleObsWarmUp()
    win.webContents
      .executeJavaScript('typeof window.csHero')
      .then((t) => log('Renderer bridge check: typeof window.csHero =', t))
      .catch((err) => logError('Bridge check failed', err))
  })

  win.once('ready-to-show', () => {
    win.show()
    windowShown = true
    tryScheduleObsWarmUp()
  })
  return win
}

app.whenReady().then(() => {
  ensureRuntimeDirs()
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let isShuttingDown = false
app.on('before-quit', (event) => {
  if (isShuttingDown) return
  event.preventDefault()
  isShuttingDown = true
  void shutdownServices().finally(() => app.quit())
})

process.on('uncaughtException', (err) => {
  log('uncaughtException', err)
})
