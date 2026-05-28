import fs from 'fs'
import http from 'http'
import https from 'https'
import path from 'path'

export type DownloadProgress = {
  bytesReceived: number
  totalBytes?: number
  progress?: number
}

export type DownloadProgressListener = (progress: DownloadProgress) => void

function requestToFile(
  url: string,
  destPath: string,
  onProgress?: DownloadProgressListener,
  maxRedirects = 8
): Promise<number> {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      reject(new Error('重定向次数过多'))
      return
    }

    const lib = url.startsWith('https') ? https : http
    const req = lib.get(url, { rejectUnauthorized: false }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode ?? 0)) {
        const loc = res.headers.location
        if (!loc) {
          reject(new Error(`HTTP ${res.statusCode} 无 Location`))
          return
        }
        const next = loc.startsWith('http') ? loc : new URL(loc, url).href
        res.resume()
        requestToFile(next, destPath, onProgress, maxRedirects - 1).then(resolve, reject)
        return
      }

      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error(`下载失败 HTTP ${res.statusCode}`))
        return
      }

      fs.mkdirSync(path.dirname(destPath), { recursive: true })
      const tmpPath = `${destPath}.download`
      const out = fs.createWriteStream(tmpPath)
      const totalBytes = Number(res.headers['content-length']) || undefined
      let bytesReceived = 0

      res.on('data', (chunk: Buffer) => {
        bytesReceived += chunk.length
        onProgress?.({
          bytesReceived,
          totalBytes,
          progress: totalBytes ? Math.min(99, Math.round((bytesReceived / totalBytes) * 100)) : undefined
        })
      })

      res.pipe(out)
      out.on('finish', () => {
        out.close(() => {
          fs.renameSync(tmpPath, destPath)
          resolve(bytesReceived)
        })
      })
      out.on('error', (err) => {
        res.destroy()
        try {
          fs.rmSync(tmpPath, { force: true })
        } catch {
          // ignore cleanup errors
        }
        reject(err)
      })
    })

    req.on('error', reject)
  })
}

/** 按顺序尝试多个 URL，直到有一个成功。 */
export async function downloadFirstToFile(
  urls: string[],
  destPath: string,
  onProgress?: (url: string, progress: DownloadProgress) => void,
  onFailedAttempt?: (url: string, err: Error) => void
): Promise<{ url: string; size: number }> {
  let lastErr: Error | undefined
  for (const url of urls) {
    try {
      const size = await requestToFile(url, destPath, (p) => onProgress?.(url, p))
      return { url, size }
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
      onFailedAttempt?.(url, lastErr)
    }
  }
  throw lastErr ?? new Error('无可用下载地址')
}
