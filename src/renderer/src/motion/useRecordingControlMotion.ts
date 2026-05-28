import { nextTick, onMounted, watch, type Ref } from 'vue'
import { useMotion } from './useMotion'

export interface RecordingControlMotionOptions {
  cardRef: Ref<HTMLElement | null>
  panelRef: Ref<HTMLElement | null>
  ringContentRef: Ref<HTMLElement | null>
  statusListRef: Ref<HTMLElement | null>
  modeToggleRef: Ref<HTMLElement | null>
  ringContentKey: Ref<string>
  statusKey: Ref<string>
}

/**
 * 录制控制卡片：入场、圆环文案切换、状态列表、模式切换反馈
 */
export function useRecordingControlMotion(opts: RecordingControlMotionOptions) {
  const { run, staggerDelay, MOTION, reduced } = useMotion()

  onMounted(async () => {
    await nextTick()
    const card = opts.cardRef.value
    if (!card || reduced.value) return

    run(card, {
      opacity: [0, 1],
      translateY: [8, 0],
      duration: MOTION.panelEnter,
      ease: MOTION.ease
    })

    const panel = opts.panelRef.value
    if (panel) {
      run(panel, {
        opacity: [0, 1],
        translateY: [6, 0],
        duration: MOTION.slow,
        delay: 50,
        ease: MOTION.ease
      })
    }

    const rows = opts.statusListRef.value?.querySelectorAll<HTMLElement>('.status-row')
    if (rows?.length) {
      run(rows, {
        opacity: [0, 1],
        translateX: [-8, 0],
        delay: staggerDelay(48),
        duration: MOTION.listItem,
        ease: MOTION.ease
      })
    }
  })

  watch(
    opts.ringContentKey,
    async () => {
      await nextTick()
      const el = opts.ringContentRef.value
      if (!el || reduced.value) return
      run(el, {
        opacity: [0.5, 1],
        scale: [0.96, 1],
        duration: MOTION.slow,
        ease: MOTION.ease
      })
    }
  )

  watch(
    opts.statusKey,
    async () => {
      await nextTick()
      const list = opts.statusListRef.value
      if (!list || reduced.value) return
      const rows = list.querySelectorAll<HTMLElement>('.status-row')
      if (!rows.length) return
      run(rows, {
        opacity: [0, 1],
        translateX: [-6, 0],
        delay: staggerDelay(40),
        duration: MOTION.listItem,
        ease: MOTION.ease
      })
    }
  )

  function pulseModeToggle(): void {
    const el = opts.modeToggleRef.value
    if (!el || reduced.value) return
    run(el, {
      scale: [1, 1.04, 1],
      duration: 320,
      ease: 'outCubic'
    })
  }

  function pulseRingContent(): void {
    const el = opts.ringContentRef.value
    if (!el || reduced.value) return
    run(el, {
      scale: [0.94, 1],
      opacity: [0.7, 1],
      duration: 260,
      ease: 'outCubic'
    })
  }

  return { pulseModeToggle, pulseRingContent }
}
