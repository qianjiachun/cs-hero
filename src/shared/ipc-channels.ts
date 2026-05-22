export const IPC = {
  RECORDING_RUN_POC: 'recording:run-poc',
  RECORDING_GET_STATUS: 'recording:get-status',
  RECORDING_STATUS_EVENT: 'recording:status-changed',
  MOCK_MATCH_RUN: 'mock-match:run',
  MOCK_MATCH_GET_STATUS: 'mock-match:get-status',
  MOCK_MATCH_STATUS_EVENT: 'mock-match:status-changed',
  CS2_INTEGRATION_GET_STATUS: 'cs2-integration:get-status',
  CS2_INTEGRATION_STATUS_EVENT: 'cs2-integration:status-changed'
} as const
