/** 打包时 asar 内路径替换为 unpacked */
export function fixPackagedPath(p: string): string {
  return p.replace(/app\.asar([/\\])/g, 'app.asar.unpacked$1')
}
