const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

export function getPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

export function subscribeReducedMotion(onChange: (reduced: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => undefined

  const mq = window.matchMedia(REDUCED_MOTION_QUERY)
  const handler = (e: MediaQueryListEvent): void => onChange(e.matches)
  onChange(mq.matches)
  mq.addEventListener('change', handler)
  return () => mq.removeEventListener('change', handler)
}
