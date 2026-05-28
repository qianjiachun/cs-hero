export interface KillClipView {
  file: string
  mediaUrl: string
}

/** 与 .clip-thumb 宽度一致（4:3 预览） */
export const KILL_CLIP_THUMB_WIDTH_PX = 76
/** 与 .clip-strip gap 一致 */
export const KILL_CLIP_STRIP_GAP_PX = 8

export interface KillClipStripLayout {
  visible: KillClipView[]
  /** 蒙层格背景预览（第一条未完整展示的片段） */
  overflow: KillClipView | null
  /** 蒙层 +N */
  extraCount: number
  showMask: boolean
}

export function slotCountFromStripWidth(widthPx: number): number {
  if (widthPx <= 0) return 1
  const unit = KILL_CLIP_THUMB_WIDTH_PX + KILL_CLIP_STRIP_GAP_PX
  return Math.max(1, Math.floor((widthPx + KILL_CLIP_STRIP_GAP_PX) / unit))
}

/** 最后一格固定为蒙层；前面格数由容器宽度决定 */
export function layoutKillClipStrip(
  clips: KillClipView[],
  stripWidthPx: number
): KillClipStripLayout {
  const total = clips.length
  if (total === 0) {
    return { visible: [], overflow: null, extraCount: 0, showMask: false }
  }

  const slotCount = slotCountFromStripWidth(stripWidthPx)
  const fullSlots = Math.max(0, slotCount - 1)

  if (total <= fullSlots) {
    return {
      visible: clips,
      overflow: null,
      extraCount: 0,
      showMask: false
    }
  }

  const visible = clips.slice(0, fullSlots)
  const overflow = clips[fullSlots] ?? clips[clips.length - 1] ?? null
  const extraCount = total - fullSlots

  return {
    visible,
    overflow,
    extraCount,
    showMask: true
  }
}
