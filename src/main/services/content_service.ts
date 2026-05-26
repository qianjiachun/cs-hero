import fs from 'fs'
import path from 'path'
import type {
  ContentListMatchesResult,
  ContentMatchDetail,
  ContentMatchSummary,
  MatchJson
} from '../../shared/recording-types'
import { resolveMatchDisplayMap } from '../../shared/match-display'
import { paths } from '../shared/paths'
import { log } from '../shared/logger'
import { countClipsInMatchDir, scanClipsInMatchDir } from './clips_scan'

const DEFAULT_PAGE_SIZE = 20

interface MatchDirEntry {
  id: string
  dir: string
  sortKey: number
}

function parseMatchJson(filePath: string): { data?: MatchJson; error?: string } {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as MatchJson
    return { data: raw }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { error: msg }
  }
}

function listSortedMatchDirs(): MatchDirEntry[] {
  const matchesDir = paths.matchesDir
  if (!fs.existsSync(matchesDir)) return []

  const entries: MatchDirEntry[] = []
  for (const ent of fs.readdirSync(matchesDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue
    const dir = path.join(matchesDir, ent.name)
    let sortKey = 0
    try {
      sortKey = fs.statSync(dir).mtimeMs
    } catch {
      sortKey = 0
    }
    entries.push({ id: ent.name, dir, sortKey })
  }

  entries.sort((a, b) => b.sortKey - a.sortKey)
  return entries
}

function summarizeMatch(entry: MatchDirEntry): ContentMatchSummary {
  const { id, dir } = entry
  const matchJsonPath = path.join(dir, 'match.json')
  const fullMatchPath = path.join(dir, 'full_match.mp4')
  const clipCount = countClipsInMatchDir(dir)
  const hasFullMatch = fs.existsSync(fullMatchPath)

  if (!fs.existsSync(matchJsonPath)) {
    return {
      id,
      dir,
      map: resolveMatchDisplayMap(id),
      start_time: '',
      duration: 0,
      status: 'unknown',
      bookmarkCount: 0,
      clipCount,
      hasFullMatch,
      parseError: '缺少 match.json'
    }
  }

  const { data, error } = parseMatchJson(matchJsonPath)
  if (!data) {
    return {
      id,
      dir,
      map: resolveMatchDisplayMap(id),
      start_time: '',
      duration: 0,
      status: 'unknown',
      bookmarkCount: 0,
      clipCount,
      hasFullMatch,
      parseError: error
    }
  }

  return {
    id: data.id ?? id,
    dir,
    map: resolveMatchDisplayMap(data.id ?? id, data.map, data.source),
    start_time: data.start_time ?? '',
    duration: data.duration ?? 0,
    status: data.status ?? 'unknown',
    source: data.source,
    ended_reason: data.ended_reason,
    capture_method: data.capture_method,
    encoder: data.encoder,
    bookmarkCount: data.bookmarks?.length ?? 0,
    clipCount,
    hasFullMatch
  }
}

export class ContentService {
  /** 轻量指纹：目录 id + clip 数 + 是否有整局（用于文件监视，不读整表 JSON） */
  listMatchesFingerprint(): string {
    const dirs = listSortedMatchDirs()
    return JSON.stringify(
      dirs.map((d) => ({
        id: d.id,
        clipCount: countClipsInMatchDir(d.dir),
        hasFullMatch: fs.existsSync(path.join(d.dir, 'full_match.mp4'))
      }))
    )
  }

  listMatches(offset = 0, limit = DEFAULT_PAGE_SIZE): ContentListMatchesResult {
    const dirs = listSortedMatchDirs()
    const total = dirs.length
    const slice = dirs.slice(offset, offset + limit)
    const items = slice.map((d) => summarizeMatch(d))

    return {
      items,
      total,
      offset,
      limit,
      hasMore: offset + items.length < total
    }
  }

  getMatch(matchId: string): ContentMatchDetail | null {
    const dir = path.join(paths.matchesDir, matchId)
    if (!fs.existsSync(dir)) {
      log('Content getMatch: dir missing', matchId)
      return null
    }

    const matchJsonPath = path.join(dir, 'match.json')
    const fullMatchPath = path.join(dir, 'full_match.mp4')
    const clips = scanClipsInMatchDir(dir)
    const clipCount = clips.length
    const hasFullMatch = fs.existsSync(fullMatchPath)

    if (!fs.existsSync(matchJsonPath)) {
      return {
        id: matchId,
        dir,
        map: resolveMatchDisplayMap(matchId),
        start_time: '',
        duration: 0,
        status: 'unknown',
        bookmarkCount: 0,
        clipCount,
        hasFullMatch,
        parseError: '缺少 match.json',
        clips,
        bookmarks: [],
        match_json_path: matchJsonPath
      }
    }

    const { data, error } = parseMatchJson(matchJsonPath)

    if (!data) {
      return {
        id: matchId,
        dir,
        map: resolveMatchDisplayMap(matchId),
        start_time: '',
        duration: 0,
        status: 'unknown',
        bookmarkCount: 0,
        clipCount,
        hasFullMatch,
        parseError: error,
        clips,
        bookmarks: [],
        match_json_path: matchJsonPath
      }
    }

    return {
      id: data.id ?? matchId,
      dir,
      map: resolveMatchDisplayMap(data.id ?? matchId, data.map, data.source),
      start_time: data.start_time ?? '',
      end_time: data.end_time,
      duration: data.duration ?? 0,
      status: data.status ?? 'unknown',
      source: data.source,
      ended_reason: data.ended_reason,
      capture_method: data.capture_method,
      encoder: data.encoder,
      bookmarkCount: data.bookmarks?.length ?? 0,
      clipCount,
      hasFullMatch,
      clips,
      bookmarks: data.bookmarks ?? [],
      full_match_path: hasFullMatch ? fullMatchPath : undefined,
      match_json_path: matchJsonPath
    }
  }
}
