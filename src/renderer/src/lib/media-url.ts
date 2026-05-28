/** 与 main/shared/media_protocol.ts 中 toMediaUrl 格式一致 */
const MEDIA_SCHEME = 'cshero-media'

export function toMediaUrl(absolutePath: string): string {
  return `${MEDIA_SCHEME}://local?path=${encodeURIComponent(absolutePath)}`
}

export function joinMatchMediaPath(matchDir: string, relativeFile: string): string {
  const sep = matchDir.includes('\\') ? '\\' : '/'
  const rel = relativeFile.replace(/\//g, sep)
  if (matchDir.endsWith(sep)) return `${matchDir}${rel}`
  return `${matchDir}${sep}${rel}`
}
