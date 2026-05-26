/**
 * 录制编码器选择：NVENC → AMF → QSV → x264
 */
const PREFERRED_ORDER = [
  'jim_nvenc',
  'ffmpeg_nvenc',
  'obs_nvenc',
  'nvenc',
  'jim_amf',
  'ffmpeg_amf',
  'amf',
  'obs_qsv',
  'ffmpeg_qsv',
  'qsv',
  'obs_x264',
  'x264'
] as const

const DISPLAY_NAMES: Record<string, string> = {
  jim_nvenc: 'nvenc',
  ffmpeg_nvenc: 'nvenc',
  obs_nvenc: 'nvenc',
  nvenc: 'nvenc',
  jim_amf: 'amf',
  ffmpeg_amf: 'amf',
  amf: 'amf',
  obs_qsv: 'qsv',
  ffmpeg_qsv: 'qsv',
  qsv: 'qsv',
  obs_x264: 'x264',
  x264: 'x264'
}

export function pickRecordingEncoder(available: string[]): {
  selected: string
  displayName: string
  fallbackReason?: string
} {
  const normalized = available.map((e) => e.toLowerCase())
  for (const pref of PREFERRED_ORDER) {
    const idx = normalized.findIndex((e) => e === pref || e.includes(pref.replace('obs_', '')))
    if (idx >= 0) {
      const raw = available[idx]
      return {
        selected: raw,
        displayName: DISPLAY_NAMES[pref] ?? raw
      }
    }
  }
  const last = available[available.length - 1]
  if (last) {
    return {
      selected: last,
      displayName: DISPLAY_NAMES[last.toLowerCase()] ?? last,
      fallbackReason: 'no preferred encoder, using last available'
    }
  }
  return { selected: 'obs_x264', displayName: 'x264', fallbackReason: 'no encoders reported' }
}

export function encoderDisplayName(encoderId: string): string {
  const lower = encoderId.toLowerCase()
  if (lower.includes('nvenc')) return 'nvenc'
  if (lower.includes('amf')) return 'amf'
  if (lower.includes('qsv')) return 'qsv'
  if (lower.includes('x264')) return 'x264'
  return encoderId || 'unknown'
}
