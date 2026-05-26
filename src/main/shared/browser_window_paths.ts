import fs from 'fs'
import path from 'path'

/** 与 main/index.ts 同目录打包时，preload 位于 out/preload/index.cjs */
export function resolvePreloadPath(): string {
  const base = path.join(__dirname, '../preload/index')
  const candidates = [`${base}.cjs`, `${base}.js`, `${base}.mjs`]
  return path.resolve(candidates.find((p) => fs.existsSync(p)) ?? `${base}.cjs`)
}

export function resolveRendererIndexHtml(): string {
  return path.join(__dirname, '../renderer/index.html')
}
