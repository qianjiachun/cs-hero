/** 桌面壳层微交互时长与缓动（150–300ms） */
export const MOTION = {
  fast: 150,
  normal: 220,
  slow: 280,
  ease: 'outCubic' as const,
  panelEnter: 220,
  listItem: 180,
  staggerStep: 40,
  progress: 280
} as const
