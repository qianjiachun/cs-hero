import { protocol } from 'electron'
import fs from 'fs'
import { Readable } from 'stream'
import path from 'path'
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

function mimeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.mp4') return 'video/mp4'
  if (ext === '.mkv') return 'video/x-matroska'
  if (ext === '.webm') return 'video/webm'
  return 'application/octet-stream'
}

/** 解析 Range: bytes=start-end，无效返回 null */
function parseByteRange(
  rangeHeader: string | null,
  fileSize: number
): { start: number; end: number } | null {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=')) return null

  const spec = rangeHeader.slice(6).trim()
  const dash = spec.indexOf('-')
  if (dash < 0) return null

  const startPart = spec.slice(0, dash)
  const endPart = spec.slice(dash + 1)

  let start: number
  let end: number

  if (startPart === '' && endPart !== '') {
    // suffix: bytes=-500
    const suffix = parseInt(endPart, 10)
    if (!Number.isFinite(suffix) || suffix <= 0) return null
    start = Math.max(0, fileSize - suffix)
    end = fileSize - 1
  } else {
    start = startPart === '' ? 0 : parseInt(startPart, 10)
    end = endPart === '' ? fileSize - 1 : parseInt(endPart, 10)
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  }

  if (start < 0 || end < start || start >= fileSize) return null
  end = Math.min(end, fileSize - 1)
  return { start, end }
}

function streamToWebBody(nodeStream: fs.ReadStream): ReadableStream<Uint8Array> {
  return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>
}

function serveFile(filePath: string, request: Request): Response {
  const stat = fs.statSync(filePath)
  const fileSize = stat.size
  const contentType = mimeForPath(filePath)
  const range = parseByteRange(request.headers.get('range'), fileSize)

  if (request.headers.get('range') && !range) {
    return new Response(null, {
      status: 416,
      headers: {
        'Content-Range': `bytes */${fileSize}`
      }
    })
  }

  if (range) {
    const { start, end } = range
    const chunkSize = end - start + 1
    const stream = fs.createReadStream(filePath, { start, end })
    log('Media protocol 206', filePath, `bytes ${start}-${end}/${fileSize}`)

    return new Response(streamToWebBody(stream), {
      status: 206,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(chunkSize),
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${fileSize}`
      }
    })
  }

  const stream = fs.createReadStream(filePath)
  log('Media protocol 200', filePath, `size=${fileSize}`)

  return new Response(streamToWebBody(stream), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(fileSize),
      'Accept-Ranges': 'bytes'
    }
  })
}

/** 在 app.whenReady 内、创建窗口前调用 */
export function setupMediaProtocolHandler(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const filePath = resolveMediaFilePath(request.url)
    if (!filePath) {
      return new Response('Not found', { status: 404 })
    }
    try {
      return serveFile(filePath, request)
    } catch (err) {
      logError('Media protocol serve failed', filePath, err)
      return new Response('Internal error', { status: 500 })
    }
  })
}

/** 供 Renderer <video> 使用；避免 http 页面直接加载 file:// 被拦截 */
export function toMediaUrl(absolutePath: string): string {
  const normalized = path.resolve(absolutePath)
  return `${MEDIA_SCHEME}://local?path=${encodeURIComponent(normalized)}`
}

registerMediaScheme()
