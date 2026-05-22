import fs from 'fs'
import path from 'path'
import { paths } from './paths'

function timestamp(): string {
  return new Date().toISOString()
}

function formatArg(arg: unknown): string {
  if (arg === null || arg === undefined) return ''
  if (typeof arg === 'object') {
    try {
      return JSON.stringify(arg)
    } catch {
      return String(arg)
    }
  }
  return String(arg)
}

export function log(message: string, ...args: unknown[]): void {
  const line = `[${timestamp()}] ${message} ${args.map(formatArg).join(' ')}`.trim()
  console.log(line)
  try {
    fs.mkdirSync(paths.logsDir, { recursive: true })
    fs.appendFileSync(path.join(paths.logsDir, 'main.log'), line + '\n', 'utf-8')
  } catch {
    // ignore log write errors
  }
}

export function logError(message: string, err?: unknown): void {
  const detail = err instanceof Error ? err.stack ?? err.message : err ? String(err) : ''
  log(`ERROR: ${message}`, detail)
}
