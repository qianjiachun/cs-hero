# 参与开发

## 环境要求

| 项目 | 版本 |
|------|------|
| 操作系统 | **Windows 10/11 x64**（录制内核与 OSN 仅 win64） |
| Node.js | **≥ 22.12**（与 Electron 42 一致） |
| pnpm | 9.x 或 11.x |

## 一键安装（推荐）

克隆仓库后只需：

```bash
pnpm install
pnpm dev
```

`pnpm install` 会自动下载（**不进入 git**）：

| 资源 | 脚本 | 缓存位置 |
|------|------|----------|
| obs-studio-node 0.26.22 | `preinstall` → `ensure-osn.mjs` | `vendor/osn-*.tar.gz` |
| Electron 42 | `postinstall` → `ensure-electron.mjs` | `node_modules/electron/dist/` |
| FFmpeg 7.1 | `postinstall` → `ensure-ffmpeg.mjs` | `resources/ffmpeg/ffmpeg.exe` |

首次安装约需下载 **300MB+**，请保证网络畅通。项目根目录 `.npmrc` 已配置 `electron_mirror`（npmmirror）。

## 网络失败时

只重试运行时资源（无需删 `node_modules`）：

```bash
pnpm run setup
```

或分别执行：

```bash
pnpm run download-osn
pnpm run download-ffmpeg
pnpm run download-electron
```

### 自定义镜像 / 直链

| 环境变量 | 作用 |
|----------|------|
| `ELECTRON_MIRROR` | Electron 下载镜像（见 `.npmrc`） |
| `OSN_URL` | OSN tar.gz 直链，多个用逗号分隔，**优先**于 Lunaris / Streamlabs 默认列表 |
| `FFMPEG_URL` | FFmpeg zip 直链，优先于默认 GitHub |

维护者可在 **GitHub Releases** 上传与 `scripts/runtime-sources.json` 同名的文件，然后把 Release 直链写入 `OSN_URL` / `FFMPEG_URL`，方便国内贡献者。

也可直接编辑 `scripts/runtime-sources.json` 的 `urls` 数组，增加备用地址（会按顺序尝试）。

### 完全离线 / 手动放置

1. OSN：`vendor/osn-0.26.22-release-win64.tar.gz`  
   默认：`cdn.lunaris.win` → 失败时回退 Streamlabs S3（见 `scripts/runtime-sources.json`）
2. FFmpeg：`resources/ffmpeg/ffmpeg.exe`  
   来源：<https://github.com/BtbN/FFmpeg-Builds/releases>（win64 gpl zip 内 `bin/ffmpeg.exe`）
3. Electron：执行 `node scripts/ensure-electron.mjs`（需先有 `node_modules/electron`）

## 不提交到 git 的内容

见 `.gitignore`：

- `vendor/` — OSN / FFmpeg 压缩包缓存  
- `resources/ffmpeg/*`（保留 `.gitkeep`）— 解压后的 `ffmpeg.exe`  
- `node_modules/electron/dist/` — Electron 二进制  
- `dev/` — 本地对局与日志  

## 版本锁定

请勿随意升级以下组件，否则录制可能不稳定：

- `obs-studio-node` **0.26.22**（`runtime-sources.json`）
- `Electron`（`package.json`）
- `FFmpeg`（`runtime-sources.json`）

## 许可证说明

- 本仓库应用代码：MIT  
- **obs-studio-node** / **libobs**：遵循 Streamlabs / OBS 上游许可（GPL 生态）  
- **FFmpeg**：使用 BtbN 构建时需遵守 GPL，分发安装包时请保留相应说明  
