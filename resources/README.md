# CS Hero 运行时资源

本目录**不提交**大型二进制；`pnpm install` 会自动拉取。版本与 URL 以 [`scripts/runtime-sources.json`](../scripts/runtime-sources.json) 为准。

## obs-studio-node 0.26.22

- 安装：`preinstall` → `scripts/ensure-osn.mjs`
- 缓存：`vendor/osn-0.26.22-release-win64.tar.gz`（gitignore）
- 链接：`node_modules/obs-studio-node/`（打包时 `asarUnpack`）
- OBS 配置/日志：`dev/osn-data/`（开发）或安装目录下 `osn-data/`

## FFmpeg

- 安装：`postinstall` → `scripts/ensure-ffmpeg.mjs`
- 目标：`resources/ffmpeg/ffmpeg.exe`（gitignore，仅保留 `.gitkeep`）
- 默认源：BtbN [FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds/releases) win64 gpl zip

手动放置：将 `ffmpeg.exe` 放到 `resources/ffmpeg/` 即可，脚本会跳过下载。

## 重试

```bash
pnpm run setup
# 或
pnpm run download-osn
pnpm run download-ffmpeg
```

## 可选：绿色包内 OBS 数据

若将来在安装包中自带 `resources/obs/data/`，可与 node_modules 内嵌 libobs 并存；当前以 **obs-studio-node 0.26.22 内置运行时** 为准。
