import { net, protocol } from 'electron'
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { getAppDataRoot } from './paths'
import { log, logError } from './logger'

export const MEDIA_SCHEME = 'cshero-media'

/** 须在 app.ready 之前调用 */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
        bypassCSP: true
      }
    }
  ])
}

function resolveMediaFilePath(requestUrl: string): string | null {
  try {
    const url = new URL(requestUrl)
    if (url.protocol !== `${MEDIA_SCHEME}:`) return null

    const encoded = url.searchParams.get('path')
    if (!encoded) return null

    const filePath = path.resolve(decodeURIComponent(encoded))
    const dataRoot = path.resolve(getAppDataRoot())

    if (filePath !== dataRoot && !filePath.startsWith(dataRoot + path.sep)) {
      logError('Media protocol blocked path outside app data', filePath)
      return null
    }

    if (!fs.existsSync(filePath)) {
      logError('Media protocol file not found', filePath)
      return null
    }

    return filePath
  } catch (err) {
    logError('Media protocol parse failed', err)
    return null
  }
}

/** 在 app.whenReady 内、创建窗口前调用 */
export function setupMediaProtocolHandler(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const filePath = resolveMediaFilePath(request.url)
    if (!filePath) {
      return new Response('Not found', { status: 404 })
    }
    log('Media protocol serve', filePath)
    return net.fetch(pathToFileURL(filePath).href)
  })
}

/** 供 Renderer <video> 使用；避免 http 页面直接加载 file:// 被拦截 */
export function toMediaUrl(absolutePath: string): string {
  const normalized = path.resolve(absolutePath)
  return `${MEDIA_SCHEME}://local?path=${encodeURIComponent(normalized)}`
}

registerMediaScheme()
