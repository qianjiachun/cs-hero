import { BrowserWindow } from 'electron'
import fs from 'fs'
import type { EditorOpenRequest } from '../../shared/recording-types'
import { resolvePreloadPath, resolveRendererIndexHtml } from '../shared/browser_window_paths'
import { log, logError } from '../shared/logger'
import { getMainWindow } from './main_window'

let editorWindow: BrowserWindow | null = null
let pendingRequest: EditorOpenRequest | null = null

function buildEditorLoadOptions(req: EditorOpenRequest): {
  devUrl?: string
  fileOptions?: { query: Record<string, string> }
} {
  const query: Record<string, string> = {
    window: 'editor',
    matchId: req.matchId,
    source: req.source
  }
  if (req.clipFile) {
    query.clipFile = req.clipFile
  }

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    const url = new URL(devUrl)
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v)
    }
    return { devUrl: url.toString() }
  }

  return { fileOptions: { query } }
}

async function loadEditorContent(win: BrowserWindow, req: EditorOpenRequest): Promise<void> {
  const { devUrl, fileOptions } = buildEditorLoadOptions(req)

  if (devUrl) {
    await win.loadURL(devUrl)
    return
  }

  await win.loadFile(resolveRendererIndexHtml(), fileOptions)
}

function createEditorWindow(): BrowserWindow {
  const preloadPath = resolvePreloadPath()
  const parent = getMainWindow()
  log('Editor window preload', preloadPath, 'exists=', fs.existsSync(preloadPath))

  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 560,
    show: false,
    title: 'CS Hero · 剪辑',
    parent: parent ?? undefined,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.webContents.on('preload-error', (_event, failedPath, error) => {
    logError('Editor preload error', `${failedPath}: ${error?.message ?? error}`)
  })

  win.webContents.on('did-finish-load', () => {
    win.webContents
      .executeJavaScript('typeof window.csHero')
      .then((t) => log('Editor bridge check: typeof window.csHero =', t))
      .catch((err) => logError('Editor bridge check failed', err))
  })

  win.on('closed', () => {
    if (editorWindow === win) {
      editorWindow = null
      pendingRequest = null
    }
  })

  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })

  return win
}

/** 打开或聚焦剪辑窗口；若已存在则切换会话参数并重新加载。 */
export async function openEditorWindow(req: EditorOpenRequest): Promise<void> {
  pendingRequest = req

  if (editorWindow && !editorWindow.isDestroyed()) {
    editorWindow.focus()
    await loadEditorContent(editorWindow, req)
    return
  }

  editorWindow = createEditorWindow()
  await loadEditorContent(editorWindow, req)
}

export function getPendingEditorRequest(): EditorOpenRequest | null {
  return pendingRequest
}

export function closeEditorWindow(): void {
  if (editorWindow && !editorWindow.isDestroyed()) {
    editorWindow.close()
  }
  editorWindow = null
  pendingRequest = null
}
