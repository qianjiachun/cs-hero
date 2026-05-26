import type { DisplayInfo } from '../shared/display-types'
import type { AppSettings } from '../shared/settings'
import type {
  ContentListMatchesOptions,
  ContentListMatchesResult,
  ContentMatchDetail,
  ContentMatchSummary,
  Cs2IntegrationStatus,
  EditorExportTrimRequest,
  EditorExportTrimResult,
  EditorOpenRequest,
  EditorSession,
  FfmpegJobStatus,
  MergeCandidates,
  MergeCreateRequest,
  MergeResult,
  MockMatchStatus,
  ObsRuntimeInfo,
  RecordingPocStatus
} from '../shared/recording-types'

export interface CsHeroApi {
  runRecordingPoc: () => Promise<RecordingPocStatus>
  getRecordingStatus: () => Promise<RecordingPocStatus>
  onRecordingStatusChanged: (callback: (status: RecordingPocStatus) => void) => () => void
  runMockMatch: () => Promise<MockMatchStatus>
  getMockMatchStatus: () => Promise<MockMatchStatus>
  onMockMatchStatusChanged: (callback: (status: MockMatchStatus) => void) => () => void
  getCs2IntegrationStatus: () => Promise<Cs2IntegrationStatus>
  refreshCs2LaunchOption: () => Promise<Cs2IntegrationStatus>
  openCs2InSteam: () => Promise<boolean>
  startManualRecording: () => Promise<Cs2IntegrationStatus>
  stopManualRecording: () => Promise<Cs2IntegrationStatus>
  onCs2IntegrationStatusChanged: (callback: (status: Cs2IntegrationStatus) => void) => () => void
  getSettings: () => Promise<AppSettings>
  updateSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>
  onSettingsChanged: (callback: (settings: AppSettings) => void) => () => void
  getObsRuntimeInfo: () => Promise<ObsRuntimeInfo | null>
  onObsRuntimeChanged: (callback: (info: ObsRuntimeInfo | null) => void) => () => void
  listMatches: (options?: ContentListMatchesOptions) => Promise<ContentListMatchesResult>
  onMatchesChanged: (callback: () => void) => () => void
  getMatch: (matchId: string) => Promise<ContentMatchDetail | null>
  openPath: (targetPath: string) => Promise<boolean>
  listDisplays: () => Promise<DisplayInfo[]>
  openEditor: (req: EditorOpenRequest) => Promise<boolean>
  getEditorSession: (req: EditorOpenRequest) => Promise<EditorSession>
  exportTrim: (request: EditorExportTrimRequest) => Promise<EditorExportTrimResult>
  deleteClip: (matchId: string, clipFile: string) => Promise<boolean>
  openExportsDir: () => Promise<boolean>
  getFfmpegJobStatus: (jobId: string) => Promise<FfmpegJobStatus | null>
  cancelFfmpegJob: (jobId: string) => Promise<boolean>
  onFfmpegJobStatusChanged: (callback: (status: FfmpegJobStatus) => void) => () => void
  getMergeCandidates: (matchId: string) => Promise<MergeCandidates>
  createMergedVideo: (request: MergeCreateRequest) => Promise<MergeResult>
  exportMergedVideo: (request: MergeCreateRequest) => Promise<MergeResult>
}

declare global {
  interface Window {
    csHero: CsHeroApi
  }
}

export {}
