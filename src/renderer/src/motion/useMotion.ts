import { animate, stagger, type AnimationParams, type JSAnimation, type TargetsParam } from 'animejs'
import { onScopeDispose, ref, shallowRef } from 'vue'
import { getPrefersReducedMotion, subscribeReducedMotion } from './preferences'
import { MOTION } from './presets'

export { MOTION }

export function useMotion() {
  const reduced = ref(getPrefersReducedMotion())
  const running = shallowRef<JSAnimation[]>([])

  const unsubMedia = subscribeReducedMotion((value) => {
    reduced.value = value
  })

  function track(anim: JSAnimation): JSAnimation {
    running.value = [...running.value, anim]
    void anim.then(() => {
      running.value = running.value.filter((a) => a !== anim)
    })
    return anim
  }

  function cancelAll(): void {
    for (const anim of running.value) {
      anim.pause()
    }
    running.value = []
  }

  /** 尊重 reduced motion：时长与 delay 归零 */
  function resolveParams(params: AnimationParams): AnimationParams {
    if (!reduced.value) return params
    return {
      ...params,
      duration: 0,
      delay: 0
    }
  }

  function run(
    targets: TargetsParam,
    params: AnimationParams
  ): JSAnimation {
    return track(animate(targets, resolveParams(params)))
  }

  function staggerDelay(ms: number = MOTION.staggerStep) {
    return reduced.value ? stagger(0) : stagger(ms)
  }

  let progressAnim: JSAnimation | null = null

  function animateProgress(
    from: number,
    to: number,
    onUpdate: (value: number) => void
  ): void {
    progressAnim?.pause()
    const clamped = Math.min(100, Math.max(0, to))

    if (reduced.value) {
      onUpdate(clamped)
      return
    }

    const state = { p: from }
    progressAnim = track(
      animate(state, {
        p: clamped,
        duration: MOTION.progress,
        ease: MOTION.ease,
        onUpdate: () => onUpdate(state.p)
      })
    )
  }

  onScopeDispose(() => {
    unsubMedia()
    progressAnim?.pause()
    cancelAll()
  })

  return {
    reduced,
    run,
    staggerDelay,
    animateProgress,
    cancelAll,
    MOTION
  }
}
