import { app, BrowserWindow } from 'electron'

// 双显卡笔记本：让 Electron 与 OBS 子进程走独显，game_capture 才能与 CS2 共享 D3D 纹理
app.commandLine.appendSwitch('force-high-performance-gpu')
app.commandLine.appendSwitch('ignore-gpu-blocklist')
import { registerIpcHandlers, scheduleObsWarmUp, shutdownServices } from './ipc/handlers'
import { closeEditorWindow } from './windows/editor_window'
import { setMainWindow } from './windows/main_window'
import { resolvePreloadPath, resolveRendererIndexHtml } from './shared/browser_window_paths'
import { setupMediaProtocolHandler } from './shared/media_protocol'
import { ensureRuntimeDirs } from './shared/paths'
import { log, logError } from './shared/logger'
import fs from 'fs'

function createWindow(): BrowserWindow {
  const preloadPath = resolvePreloadPath()
  log('Preload path', preloadPath, 'exists=', fs.existsSync(preloadPath))

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
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
    win.loadFile(resolveRendererIndexHtml())
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

  setMainWindow(win)
  win.on('closed', () => {
    setMainWindow(null)
    closeEditorWindow()
  })

  return win
}

app.whenReady().then(() => {
  setupMediaProtocolHandler()
  ensureRuntimeDirs()
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
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
