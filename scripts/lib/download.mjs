/**
 * 轻量 HTTP(S) 下载，供 ensure-*.mjs 共用
 */
import http from 'http'
import https from 'https'
import fs from 'fs'
import path from 'path'

export function fetchBuffer(url, maxRedirects = 8) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('重定向次数过多'))

    const lib = url.startsWith('https') ? https : http
    lib
      .get(url, { rejectUnauthorized: false }, (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode ?? 0)) {
          const loc = res.headers.location
          if (!loc) return reject(new Error(`HTTP ${res.statusCode} 无 Location`))
          const next = loc.startsWith('http') ? loc : new URL(loc, url).href
          res.resume()
          return resolve(fetchBuffer(next, maxRedirects - 1))
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`下载失败 HTTP ${res.statusCode}: ${url}`))
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks)))
      })
      .on('error', reject)
  })
}

export async function downloadToFile(url, destPath) {
  const buf = await fetchBuffer(url)
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  fs.writeFileSync(destPath, buf)
  return buf.length
}

/** 按顺序尝试多个 URL，直到有一个成功 */
export async function downloadFirst(urls, destPath) {
  let lastErr
  for (const url of urls) {
    try {
      const size = await downloadToFile(url, destPath)
      return { url, size }
    } catch (err) {
      lastErr = err
      console.warn(`[download] 失败: ${url} — ${err.message}`)
    }
  }
  throw lastErr ?? new Error('无可用下载地址')
}
