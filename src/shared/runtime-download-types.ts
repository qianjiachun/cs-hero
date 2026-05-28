export type RuntimeComponent = 'osn' | 'ffmpeg'
export type RuntimeDownloadPhase = 'idle' | 'downloading' | 'extracting' | 'ready' | 'failed'

export interface RuntimeDownloadStatus {
  component: RuntimeComponent
  label: string
  phase: RuntimeDownloadPhase
  message: string
  progress?: number
  bytesReceived?: number
  totalBytes?: number
  error?: string
}
