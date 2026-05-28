/** 与 package.json / vendor 发行包一致 */
export const OSN_VERSION = '0.26.22'

/** 按优先级：Lunaris CDN → Streamlabs 官方回退 */
export const OSN_DOWNLOAD_URLS = [
  `https://cdn.lunaris.win/qianjiachun/cs-hero/osn-${OSN_VERSION}-release-win64.tar.gz`,
  `https://s3-us-west-2.amazonaws.com/obsstudionodes3.streamlabs.com/osn-${OSN_VERSION}-release-win64.tar.gz`
] as const

/** 首选下载地址（兼容旧引用） */
export const OSN_DIST = {
  win64: OSN_DOWNLOAD_URLS[0]
} as const
