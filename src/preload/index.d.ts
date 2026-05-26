import type { DisplayInfo } from '../shared/display-types'
import type { AppSettings } from '../shared/settings'
import type {
  ContentMatchDetail,
  ContentMatchSummary,
  Cs2IntegrationStatus,
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
  listMatches: () => Promise<ContentMatchSummary[]>
  onMatchesChanged: (callback: (matches: ContentMatchSummary[]) => void) => () => void
  getMatch: (matchId: string) => Promise<ContentMatchDetail | null>
  openPath: (targetPath: string) => Promise<boolean>
  listDisplays: () => Promise<DisplayInfo[]>
}

declare global {
  interface Window {
    csHero: CsHeroApi
  }
}

export {}
