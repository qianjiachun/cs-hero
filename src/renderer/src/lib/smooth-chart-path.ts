export interface ChartPathPoint {
  x: number
  y: number
  v: number
}

/** Fritsch–Carlson 单调切线（x 严格递增），在数值空间插值避免跌破 0 */
function monotoneTangents(xs: number[], vs: number[]): number[] {
  const n = xs.length
  const m = new Array<number>(n)
  const delta = new Array<number>(n - 1)

  for (let i = 0; i < n - 1; i++) {
    const h = xs[i + 1] - xs[i]
    delta[i] = h !== 0 ? (vs[i + 1] - vs[i]) / h : 0
  }

  m[0] = delta[0]
  m[n - 1] = delta[n - 2]

  for (let i = 1; i < n - 1; i++) {
    if (delta[i - 1] * delta[i] <= 0) {
      m[i] = 0
    } else {
      m[i] = (delta[i - 1] + delta[i]) / 2
      const a = m[i] / delta[i - 1]
      const b = m[i] / delta[i]
      const s = a * a + b * b
      if (s > 9) {
        const t = 3 / Math.sqrt(s)
        m[i] = t * Math.sign(delta[i]) * Math.min(Math.abs(delta[i - 1]), Math.abs(delta[i]))
      }
    }
  }

  if (delta[0] !== 0) {
    const a = m[0] / delta[0]
    if (a < 0) m[0] = 0
    else if (a * a > 9) m[0] = 3 * delta[0]
  }
  if (delta[n - 2] !== 0) {
    const a = m[n - 1] / delta[n - 2]
    if (a < 0) m[n - 1] = 0
    else if (a * a > 9) m[n - 1] = 3 * delta[n - 2]
  }

  return m
}

/**
 * 在数值 v 上做单调三次 Hermite，再映射到图表 y；保证 v ≥ 0 且相邻点间不 overshoot。
 */
export function buildMonotoneSmoothPath(
  pts: ChartPathPoint[],
  vToY: (v: number) => number
): string {
  const n = pts.length
  if (n === 0) return ''
  if (n === 1) return `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`
  if (n === 2) {
    return `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)} L ${pts[1].x.toFixed(2)} ${pts[1].y.toFixed(2)}`
  }

  const xs = pts.map((p) => p.x)
  const vs = pts.map((p) => Math.max(0, p.v))
  const tangents = monotoneTangents(xs, vs)

  const f = (num: number) => num.toFixed(2)
  let d = `M ${f(pts[0].x)} ${f(pts[0].y)}`

  for (let i = 0; i < n - 1; i++) {
    const x0 = xs[i]
    const x1 = xs[i + 1]
    const v0 = vs[i]
    const v1 = vs[i + 1]
    const h = (x1 - x0) / 3

    let cp1v = v0 + tangents[i] * h
    let cp2v = v1 - tangents[i + 1] * h

    const vLo = Math.min(v0, v1)
    const vHi = Math.max(v0, v1)
    cp1v = Math.max(0, Math.min(vHi, Math.max(vLo, cp1v)))
    cp2v = Math.max(0, Math.min(vHi, Math.max(vLo, cp2v)))

    const cp1x = x0 + h
    const cp2x = x1 - h
    const y1 = vToY(cp1v)
    const y2 = vToY(cp2v)
    const yEnd = vToY(v1)

    d += ` C ${f(cp1x)} ${f(y1)}, ${f(cp2x)} ${f(y2)}, ${f(x1)} ${f(yEnd)}`
  }

  return d
}
