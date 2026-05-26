import fs from 'fs'
import path from 'path'
import type { ContentMatchDetail, ContentMatchSummary, MatchJson } from '../../shared/recording-types'
import { resolveMatchDisplayMap } from '../../shared/match-display'
import { paths } from '../shared/paths'
import { log } from '../shared/logger'

function parseMatchJson(filePath: string): { data?: MatchJson; error?: string } {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as MatchJson
    return { data: raw }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { error: msg }
  }
}

function dirSortKey(dirPath: string, matchJson?: MatchJson): number {
  if (matchJson?.start_time) {
    const t = Date.parse(matchJson.start_time)
    if (!Number.isNaN(t)) return t
  }
  try {
    return fs.statSync(dirPath).mtimeMs
  } catch {
    return 0
  }
}

export class ContentService {
  listMatches(limit = 50): ContentMatchSummary[] {
    const matchesDir = paths.matchesDir
    if (!fs.existsSync(matchesDir)) return []

    const entries = fs.readdirSync(matchesDir, { withFileTypes: true })
    const summaries: Array<ContentMatchSummary & { _sort: number }> = []

    for (const ent of entries) {
      if (!ent.isDirectory()) continue
      const dir = path.join(matchesDir, ent.name)
      const matchJsonPath = path.join(dir, 'match.json')
      const fullMatchPath = path.join(dir, 'full_match.mp4')

      if (!fs.existsSync(matchJsonPath)) {
        summaries.push({
          id: ent.name,
          dir,
          map: resolveMatchDisplayMap(ent.name),
          start_time: '',
          duration: 0,
          status: 'unknown',
          bookmarkCount: 0,
          clipCount: 0,
          hasFullMatch: fs.existsSync(fullMatchPath),
          parseError: '缺少 match.json',
          _sort: dirSortKey(dir)
        })
        continue
      }

      const { data, error } = parseMatchJson(matchJsonPath)
      if (!data) {
        summaries.push({
          id: ent.name,
          dir,
          map: resolveMatchDisplayMap(ent.name, undefined, undefined),
          start_time: '',
          duration: 0,
          status: 'unknown',
          bookmarkCount: 0,
          clipCount: 0,
          hasFullMatch: fs.existsSync(fullMatchPath),
          parseError: error,
          _sort: dirSortKey(dir)
        })
        continue
      }

      summaries.push({
        id: data.id ?? ent.name,
        dir,
        map: resolveMatchDisplayMap(data.id ?? ent.name, data.map, data.source),
        start_time: data.start_time ?? '',
        duration: data.duration ?? 0,
        status: data.status ?? 'unknown',
        source: data.source,
        ended_reason: data.ended_reason,
        capture_method: data.capture_method,
        encoder: data.encoder,
        bookmarkCount: data.bookmarks?.length ?? 0,
        clipCount: data.clips?.length ?? 0,
        hasFullMatch: fs.existsSync(fullMatchPath),
        _sort: dirSortKey(dir, data)
      })
    }

    summaries.sort((a, b) => b._sort - a._sort)
    return summaries.slice(0, limit).map(({ _sort: _, ...rest }) => rest)
  }

  getMatch(matchId: string): ContentMatchDetail | null {
    const dir = path.join(paths.matchesDir, matchId)
    const matchJsonPath = path.join(dir, 'match.json')
    if (!fs.existsSync(matchJsonPath)) {
      log('Content getMatch: no match.json', matchId)
      return null
    }

    const { data, error } = parseMatchJson(matchJsonPath)
    const fullMatchPath = path.join(dir, 'full_match.mp4')

    if (!data) {
      return {
        id: matchId,
        dir,
        map: resolveMatchDisplayMap(matchId),
        start_time: '',
        duration: 0,
        status: 'unknown',
        bookmarkCount: 0,
        clipCount: 0,
        hasFullMatch: fs.existsSync(fullMatchPath),
        parseError: error,
        clips: [],
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
      clipCount: data.clips?.length ?? 0,
      hasFullMatch: fs.existsSync(fullMatchPath),
      clips: data.clips ?? [],
      bookmarks: data.bookmarks ?? [],
      full_match_path: fs.existsSync(fullMatchPath) ? fullMatchPath : undefined,
      match_json_path: matchJsonPath
    }
  }
}
