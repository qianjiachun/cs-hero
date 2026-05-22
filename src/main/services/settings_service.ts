import fs from 'fs'
import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/settings'
import { paths } from '../shared/paths'
import { log } from '../shared/logger'

export function loadSettings(): AppSettings {
  try {
    if (fs.existsSync(paths.settingsPath)) {
      const raw = JSON.parse(fs.readFileSync(paths.settingsPath, 'utf-8')) as Partial<AppSettings>
      return { ...DEFAULT_SETTINGS, ...raw }
    }
  } catch (err) {
    log('Failed to load settings, using defaults', err)
  }
  saveSettings(DEFAULT_SETTINGS)
  return { ...DEFAULT_SETTINGS }
}

export function saveSettings(settings: AppSettings): void {
  fs.mkdirSync(paths.appDataRoot, { recursive: true })
  fs.writeFileSync(paths.settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
  log('Settings saved', paths.settingsPath)
}
