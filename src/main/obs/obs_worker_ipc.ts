/** Utility / fork 子进程通用 IPC（兼容 parentPort 与 process.send） */

export type IpcMessenger = {
  onMessage: (handler: (data: unknown) => void) => void
  post: (data: unknown) => void
}

export function createWorkerMessenger(): IpcMessenger {
  if (typeof process.send === 'function') {
    return {
      onMessage: (handler) => {
        process.on('message', (data) => handler(data))
      },
      post: (data) => {
        process.send!(data)
      }
    }
  }

  const parentPort = process.parentPort
  if (parentPort) {
    return {
      onMessage: (handler) => {
        parentPort.on('message', (event: unknown) => {
          const data =
            event && typeof event === 'object' && 'data' in event
              ? (event as { data: unknown }).data
              : event
          handler(data)
        })
      },
      post: (data) => {
        parentPort.postMessage(data)
      }
    }
  }

  throw new Error('OBS worker: 无可用 IPC（需要 fork ipc 或 utilityProcess parentPort）')
}
