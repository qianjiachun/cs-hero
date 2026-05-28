import { animate, type JSAnimation } from 'animejs'
import { nextTick, onScopeDispose, watch, type Ref } from 'vue'
import { getPrefersReducedMotion } from './preferences'

/**
 * 录制中圆环外圈涟漪 + 轻微呼吸缩放（animejs）
 */
export function useRecordingRingRipple(
  active: Ref<boolean>,
  ringEl: Ref<HTMLElement | null>,
  rippleEls: Ref<(HTMLElement | null)[]>
) {
  let rippleAnims: JSAnimation[] = []
  let ringAnim: JSAnimation | null = null

  function resetRippleStyles(): void {
    for (const el of rippleEls.value) {
      if (!el) continue
      el.style.opacity = '0'
      el.style.transform = 'scale(1)'
    }
  }

  function resetRingStyle(): void {
    const ring = ringEl.value
    if (!ring) return
    ring.style.transform = ''
  }

  function stop(): void {
    for (const anim of rippleAnims) anim.pause()
    rippleAnims = []
    ringAnim?.pause()
    ringAnim = null
    resetRippleStyles()
    resetRingStyle()
  }

  function start(): void {
    stop()
    if (!active.value || getPrefersReducedMotion()) return

    const ripples = rippleEls.value.filter((el): el is HTMLElement => el != null)
    const ring = ringEl.value
    if (!ring || ripples.length === 0) return

    const rippleDuration = 2600
    const rippleStagger = rippleDuration / ripples.length

    ripples.forEach((el, index) => {
      rippleAnims.push(
        animate(el, {
          scale: [1, 1.32],
          opacity: [0.48, 0],
          duration: rippleDuration,
          delay: index * rippleStagger,
          ease: 'outCubic',
          loop: true
        })
      )
    })

    ringAnim = animate(ring, {
      scale: [1, 1.01, 1],
      duration: 2800,
      ease: 'inOutSine',
      loop: true
    })
  }

  watch(
    active,
    async (on) => {
      if (!on) {
        stop()
        return
      }
      await nextTick()
      start()
    },
    { immediate: true }
  )

  watch(rippleEls, async () => {
    if (!active.value) return
    await nextTick()
    start()
  })

  onScopeDispose(stop)

  return { stop, restart: start }
}
