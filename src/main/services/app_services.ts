import { ObsService } from './obs_service'
import { RecorderService } from './recorder_service'
import { GameIntegrationService } from './game_integration_service'
import { GameDetectionService } from './game_detection_service'

let obsService: ObsService | null = null
let recorderService: RecorderService | null = null
let gameIntegrationService: GameIntegrationService | null = null
let gameDetectionService: GameDetectionService | null = null

export function getObsService(): ObsService {
  if (!obsService) {
    obsService = new ObsService()
  }
  return obsService
}

export function getRecorderService(): RecorderService {
  if (!recorderService) {
    recorderService = new RecorderService(getObsService())
  }
  return recorderService
}

export function getGameIntegrationService(): GameIntegrationService {
  if (!gameIntegrationService) {
    gameIntegrationService = new GameIntegrationService(getRecorderService())
  }
  return gameIntegrationService
}

export function getGameDetectionService(): GameDetectionService {
  if (!gameDetectionService) {
    gameDetectionService = new GameDetectionService(getRecorderService())
  }
  return gameDetectionService
}

export async function startAppServices(
  onCs2StatusChanged?: (status: ReturnType<GameIntegrationService['getStatus']>) => void
): Promise<void> {
  const integration = getGameIntegrationService()
  if (onCs2StatusChanged) {
    integration.setStatusListener(onCs2StatusChanged)
  }
  await integration.start()
  const recorder = getRecorderService()
  recorder.setStatusListener(() => integration.broadcastStatus())
  const detection = getGameDetectionService()
  detection.setOnCs2Started(() => {
    integration.refreshLaunchOptions()
    void recorder.tryActivateManualRecordingIfWaiting()
  })
  detection.start()
}

export async function shutdownAppServices(): Promise<void> {
  getGameDetectionService().stop()
  const recorder = getRecorderService()
  const state = recorder.getState()
  if (state === 'waiting_cs2') {
    recorder.cancelManualSession()
  } else if (state === 'recording') {
    try {
      await recorder.finishMatch('app_exit')
    } catch {
      // best-effort on quit
    }
  }
  await getGameIntegrationService().stop()
}
