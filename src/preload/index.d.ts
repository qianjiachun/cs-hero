import type { Cs2IntegrationStatus, MockMatchStatus, RecordingPocStatus } from '../shared/recording-types'

export interface CsHeroApi {
  runRecordingPoc: () => Promise<RecordingPocStatus>
  getRecordingStatus: () => Promise<RecordingPocStatus>
  onRecordingStatusChanged: (callback: (status: RecordingPocStatus) => void) => () => void
  runMockMatch: () => Promise<MockMatchStatus>
  getMockMatchStatus: () => Promise<MockMatchStatus>
  onMockMatchStatusChanged: (callback: (status: MockMatchStatus) => void) => () => void
  getCs2IntegrationStatus: () => Promise<Cs2IntegrationStatus>
  onCs2IntegrationStatusChanged: (callback: (status: Cs2IntegrationStatus) => void) => () => void
}

declare global {
  interface Window {
    csHero: CsHeroApi
  }
}

export {}
