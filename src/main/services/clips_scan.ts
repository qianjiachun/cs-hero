import fs from 'fs'
import path from 'path'
import type { BookmarkType, ClipInfo } from '../../shared/recording-types'

/** 统计对局 clips 目录下 mp4 数量（不读 match.json） */
export function countClipsInMatchDir(matchDir: string): number {
  return scanClipsInMatchDir(matchDir).length
}

/**
 * 扫描 clips/*.mp4 作为片段列表真相源。
 * time 无法从文件名可靠还原时填 0；详情页可用 bookmarks 辅助展示。
 */
export function scanClipsInMatchDir(matchDir: string): ClipInfo[] {
  const clipsDir = path.join(matchDir, 'clips')
  if (!fs.existsSync(clipsDir)) return []

  const names = fs
    .readdirSync(clipsDir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.mp4$/i.test(e.name))
    .map((e) => e.name)
    .sort()

  return names.map((name) => {
    const type: BookmarkType = name.startsWith('death_') ? 'death' : 'kill'
    return {
      type,
      time: 0,
      file: path.join('clips', name).replace(/\\/g, '/')
    }
  })
}
