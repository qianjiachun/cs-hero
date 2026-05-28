import { nextTick, onMounted, onUnmounted, type Ref } from 'vue'

const CARD_SELECTOR = '.recording-card, .overview-card'
const MOBILE_MQ = '(max-width: 960px)'

/**
 * 强制同一容器内多张卡片保持相同外框高度（用于主页顶栏）。
 * 桌面端：取各卡实际高度最大值并设为 min-height；窄屏堆叠时清除。
 */
export function useEqualRowHeight(containerRef: Ref<HTMLElement | null>) {
  let observer: ResizeObserver | undefined
  let mq: MediaQueryList | undefined
  let raf = 0

  function clearHeights(root: HTMLElement): void {
    root.querySelectorAll<HTMLElement>(CARD_SELECTOR).forEach((el) => {
      el.style.minHeight = ''
    })
  }

  function sync(): void {
    const root = containerRef.value
    if (!root) return

    if (mq?.matches) {
      clearHeights(root)
      return
    }

    const cards = Array.from(root.querySelectorAll<HTMLElement>(CARD_SELECTOR))
    if (cards.length < 2) return

    cards.forEach((el) => {
      el.style.minHeight = ''
    })

    const maxH = Math.max(...cards.map((el) => el.getBoundingClientRect().height))
    if (maxH <= 0) return

    const px = `${Math.ceil(maxH)}px`
    cards.forEach((el) => {
      el.style.minHeight = px
    })
  }

  function scheduleSync(): void {
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => {
      void nextTick(sync)
    })
  }

  onMounted(() => {
    mq = window.matchMedia(MOBILE_MQ)
    mq.addEventListener('change', scheduleSync)

    const root = containerRef.value
    if (!root) return

    observer = new ResizeObserver(scheduleSync)
    root.querySelectorAll(CARD_SELECTOR).forEach((el) => observer!.observe(el))
    observer.observe(root)

    scheduleSync()
    window.addEventListener('resize', scheduleSync)
  })

  onUnmounted(() => {
    cancelAnimationFrame(raf)
    mq?.removeEventListener('change', scheduleSync)
    window.removeEventListener('resize', scheduleSync)
    observer?.disconnect()
    const root = containerRef.value
    if (root) clearHeights(root)
  })

  return { scheduleSync }
}
