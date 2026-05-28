# CS Hero

CS2 自动录像与精彩片段工具（开发中）。

## 快速开始

```bash
pnpm install   # 自动下载 OSN、Electron、FFmpeg（约 300MB+，不进 git）
pnpm dev
```

- **`pnpm dev`**：调试环境，数据写入 `dev/`。
- **`pnpm build`**：打包安装包（体积小，不含 OBS；首次运行自动下载录制组件）。

**平台**：当前仅 **Windows x64**。详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 运行时资源（不进 git）

| 资源 | 安装方式 |
|------|----------|
| obs-studio-node 0.26.22 | `pnpm install` → `scripts/ensure-osn.mjs` → `vendor/` |
| FFmpeg | `pnpm install` → `scripts/ensure-ffmpeg.mjs` → `resources/ffmpeg/ffmpeg.exe` |
| Electron | `pnpm install` → `scripts/ensure-electron.mjs` |

网络失败：`pnpm run setup`。镜像与手动放置见 [CONTRIBUTING.md](CONTRIBUTING.md)、[resources/README.md](resources/README.md)。

## 竖切进度

1. PoC 录制 · 2. Mock GSI 片段 · 3. 真实 CS2 GSI 自动录制（当前）
