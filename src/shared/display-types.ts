/** 可供用户选择的显示器（来自 Electron screen API） */
export interface DisplayInfo {
  id: number
  label: string
  /** Electron DIP 逻辑宽度 */
  logicalWidth: number
  /** Electron DIP 逻辑高度 */
  logicalHeight: number
  /** 物理像素宽度（logical × scaleFactor） */
  physicalWidth: number
  /** 物理像素高度 */
  physicalHeight: number
  scaleFactor: number
  isPrimary: boolean
  /** 对应 OBS monitor_capture 的 monitor 索引 */
  monitorIndex: number
  /** @deprecated 使用 logicalWidth */
  width: number
  /** @deprecated 使用 logicalHeight */
  height: number
}
