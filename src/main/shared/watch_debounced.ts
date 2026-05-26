import fs from 'fs'
import { log } from './logger'

export interface DebouncedWatcher {
  close: () => void
}

export function createDebouncedWatcher(
  watchPath: string,
  onDebouncedEvent: () => void,
  debounceMs: number,
  options?: { recursive?: boolean }
): DebouncedWatcher | null {
  let timer: ReturnType<typeof setTimeout> | undefined
  let watcher: fs.FSWatcher | null = null

  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      onDebouncedEvent()
    }, debounceMs)
  }

  try {
    watcher = fs.watch(watchPath, { recursive: options?.recursive ?? false }, schedule)
  } catch (err) {
    log('File watcher failed', watchPath, err)
    return null
  }

  return {
    close: () => {
      watcher?.close()
      watcher = null
      if (timer) clearTimeout(timer)
    }
  }
}
